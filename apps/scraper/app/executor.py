import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from playwright.async_api import Browser, Playwright, async_playwright

from .config import settings
from .models import CheckRequest
from .scraper import BrowserSessionError, ScrapeTimeoutError, scrape_product

logger = logging.getLogger(__name__)

ScrapeFunc = Callable[[str, Browser, str | None, str | None], Awaitable[dict]]


class ScrapeRequestError(RuntimeError):
    def __init__(self, status_code: int, detail: str | dict):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


@dataclass
class ScrapeJobResult:
    status_code: int
    payload: dict | None = None
    detail: str | dict | None = None


@dataclass
class ScrapeJob:
    request: CheckRequest
    enqueued_at: float = field(default_factory=time.monotonic)
    future: asyncio.Future[ScrapeJobResult] = field(init=False)

    def __post_init__(self):
        loop = asyncio.get_running_loop()
        self.future = loop.create_future()


@dataclass
class BrowserWorkerState:
    index: int
    browser: Browser | None = None
    ready: bool = False
    in_flight_started_at: float | None = None
    restart_count: int = 0
    launch_failures: int = 0
    last_launch_error: str | None = None
    last_launch_error_at: float | None = None


class ScrapeExecutor:
    def __init__(
        self,
        scrape_func: ScrapeFunc = scrape_product,
        playwright_factory: Callable[[], Any] = async_playwright,
    ):
        self._scrape_func = scrape_func
        self._playwright_factory = playwright_factory
        self.queue: asyncio.Queue[ScrapeJob] = asyncio.Queue(
            maxsize=settings.scrape_queue_size
        )
        self.worker_states = [
            BrowserWorkerState(index=index) for index in range(settings.scrape_workers)
        ]
        self.worker_tasks: list[asyncio.Task[None]] = []
        self.playwright: Playwright | None = None

    async def start(self):
        self.playwright = await self._playwright_factory().start()
        for worker in self.worker_states:
            await self._ensure_browser(worker)
        self.worker_tasks = [
            asyncio.create_task(self._worker_loop(worker))
            for worker in self.worker_states
        ]
        logger.info(
            "Scraper started configured_workers=%d ready_workers=%d queue_size=%d",
            len(self.worker_states),
            self.ready_worker_count,
            self.queue.maxsize,
        )

    async def shutdown(self):
        for task in self.worker_tasks:
            task.cancel()
        for task in self.worker_tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        for worker in self.worker_states:
            await self._close_browser(worker)
        if self.playwright is not None:
            await self.playwright.stop()
        logger.info("Scraper shutdown complete")

    @property
    def ready_worker_count(self) -> int:
        return sum(1 for worker in self.worker_states if worker.ready)

    def health_payload(self) -> dict:
        now = time.monotonic()
        ages_ms = [
            max(0, int((now - worker.in_flight_started_at) * 1000))
            for worker in self.worker_states
            if worker.in_flight_started_at is not None
        ]
        stuck_threshold_ms = (
            settings.scrape_job_timeout_ms + settings.health_stuck_grace_ms
        )
        stuck_workers = sum(1 for age_ms in ages_ms if age_ms > stuck_threshold_ms)
        last_launch_error = None
        last_launch_error_at = -1.0
        for worker in self.worker_states:
            if (
                worker.last_launch_error is not None
                and worker.last_launch_error_at is not None
                and worker.last_launch_error_at > last_launch_error_at
            ):
                last_launch_error = worker.last_launch_error
                last_launch_error_at = worker.last_launch_error_at

        degraded = (
            self.ready_worker_count < len(self.worker_states) or stuck_workers > 0
        )
        return {
            "status": "degraded" if degraded else "ok",
            "queue_depth": self.queue.qsize(),
            "queue_capacity": self.queue.maxsize,
            "enqueue_wait_ms": settings.scrape_enqueue_wait_ms,
            "workers": len(self.worker_states),
            "in_flight": len(ages_ms),
            "oldest_in_flight_ms": max(ages_ms, default=0),
            "stuck_workers": stuck_workers,
            "browser_workers_total": len(self.worker_states),
            "browser_workers_ready": self.ready_worker_count,
            "browser_restarts": sum(worker.restart_count for worker in self.worker_states),
            "last_launch_error": last_launch_error,
        }

    async def enqueue(self, request: CheckRequest) -> ScrapeJob:
        if self.ready_worker_count == 0:
            raise ScrapeRequestError(
                503,
                self._service_detail("no_browser_workers_ready"),
            )

        job = ScrapeJob(request)
        try:
            await asyncio.wait_for(
                self.queue.put(job),
                timeout=settings.scrape_enqueue_wait_ms / 1000,
            )
        except TimeoutError as exc:
            raise ScrapeRequestError(
                503,
                self._service_detail(
                    "queue_full",
                    url=request.url,
                    queue_depth=self.queue.qsize(),
                ),
            ) from exc
        return job

    async def _worker_loop(self, worker: BrowserWorkerState):
        while True:
            job = await self.queue.get()
            try:
                logger.info(
                    "Worker %d processing scrape for url=%r queue_depth=%d",
                    worker.index,
                    job.request.url,
                    self.queue.qsize(),
                )
                worker.in_flight_started_at = time.monotonic()
                result = await self._process_job(worker, job)
                if not job.future.done():
                    job.future.set_result(result)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception(
                    "Worker %d failed unexpectedly for url=%r",
                    worker.index,
                    job.request.url,
                )
                if not job.future.done():
                    job.future.set_result(
                        ScrapeJobResult(
                            status_code=503,
                            detail=self._service_detail(
                                "worker_crash",
                                url=job.request.url,
                                worker_index=worker.index,
                                error=str(exc),
                            ),
                        )
                    )
            finally:
                worker.in_flight_started_at = None
                self.queue.task_done()

    async def _process_job(
        self,
        worker: BrowserWorkerState,
        job: ScrapeJob,
    ) -> ScrapeJobResult:
        if not await self._ensure_browser(worker):
            return ScrapeJobResult(
                status_code=503,
                detail=self._service_detail(
                    "browser_unavailable",
                    url=job.request.url,
                    worker_index=worker.index,
                ),
            )

        try:
            async with asyncio.timeout(settings.scrape_job_timeout_ms / 1000):
                payload = await self._scrape_func(
                    job.request.url,
                    worker.browser,
                    job.request.css_selector,
                    job.request.element_fingerprint,
                )
            return ScrapeJobResult(status_code=200, payload=payload)
        except TimeoutError:
            await self._restart_browser(worker, "scrape_job_timeout")
            return ScrapeJobResult(
                status_code=504,
                detail=self._timeout_detail(
                    "scrape_job_timeout",
                    job.request.url,
                    worker.index,
                ),
            )
        except ScrapeTimeoutError as exc:
            return ScrapeJobResult(
                status_code=504,
                detail=self._timeout_detail(
                    str(exc),
                    job.request.url,
                    worker.index,
                ),
            )
        except BrowserSessionError as exc:
            await self._restart_browser(worker, str(exc))
            return ScrapeJobResult(
                status_code=503,
                detail=self._service_detail(
                    "browser_restart_required",
                    url=job.request.url,
                    worker_index=worker.index,
                    error=str(exc),
                ),
            )

    async def _ensure_browser(self, worker: BrowserWorkerState) -> bool:
        if worker.ready and worker.browser is not None:
            return True
        if self.playwright is None:
            return False

        for attempt in range(1, settings.browser_restart_attempts + 1):
            try:
                worker.browser = await asyncio.wait_for(
                    self.playwright.chromium.launch(headless=True),
                    timeout=settings.browser_launch_timeout_ms / 1000,
                )
                worker.ready = True
                worker.launch_failures = 0
                worker.last_launch_error = None
                worker.last_launch_error_at = None
                logger.info(
                    "Browser worker %d ready on launch attempt %d",
                    worker.index,
                    attempt,
                )
                return True
            except Exception as exc:
                worker.browser = None
                worker.ready = False
                worker.launch_failures += 1
                worker.last_launch_error = str(exc)
                worker.last_launch_error_at = time.monotonic()
                logger.exception(
                    "Browser worker %d launch failed on attempt %d",
                    worker.index,
                    attempt,
                )
                if attempt < settings.browser_restart_attempts:
                    await asyncio.sleep(settings.browser_restart_backoff_ms / 1000)

        return False

    async def _restart_browser(self, worker: BrowserWorkerState, reason: str):
        worker.restart_count += 1
        logger.warning(
            "Restarting browser worker %d due to %s",
            worker.index,
            reason,
        )
        await self._close_browser(worker)
        await self._ensure_browser(worker)

    async def _close_browser(self, worker: BrowserWorkerState):
        worker.ready = False
        if worker.browser is None:
            return
        with contextlib.suppress(Exception):
            await worker.browser.close()
        worker.browser = None

    def _service_detail(self, reason: str, **extra: Any) -> dict:
        payload = self.health_payload()
        payload.update(
            {
                "reason": reason,
                **extra,
            }
        )
        return payload

    def _timeout_detail(self, reason: str, url: str, worker_index: int) -> dict:
        return {
            "status": "timeout",
            "reason": reason,
            "url": url,
            "worker_index": worker_index,
            "timeout_ms": settings.scrape_job_timeout_ms,
        }
