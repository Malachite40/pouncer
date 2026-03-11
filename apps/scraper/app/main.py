import asyncio
import contextlib
import json
import logging
import os
import sys
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pythonjsonlogger.json import JsonFormatter

from .config import settings
from .models import CheckRequest, CheckResponse

handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(
    JsonFormatter(
        fmt="%(levelname)s %(name)s %(message)s",
        rename_fields={"levelname": "level", "asctime": "timestamp"},
        timestamp=True,
    )
)
logging.root.addHandler(handler)
logging.root.setLevel(logging.INFO)
logger = logging.getLogger(__name__)


class ScrapeJob:
    def __init__(self, request: CheckRequest):
        self.request = request
        loop = asyncio.get_running_loop()
        self.future: asyncio.Future[dict] = loop.create_future()


app = FastAPI(title="Pounce Scraper")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    app.state.scrape_queue = asyncio.Queue[ScrapeJob](maxsize=settings.scrape_queue_size)
    app.state.in_flight_jobs: dict[int, float] = {}
    app.state.worker_tasks = [
        asyncio.create_task(_scrape_worker(index))
        for index in range(settings.scrape_workers)
    ]
    logger.info(
        "Scraper started with workers=%d queue_size=%d",
        settings.scrape_workers,
        settings.scrape_queue_size,
    )


@app.on_event("shutdown")
async def _shutdown():
    worker_tasks = getattr(app.state, "worker_tasks", [])
    for task in worker_tasks:
        task.cancel()
    for task in worker_tasks:
        with contextlib.suppress(asyncio.CancelledError):
            await task

    logger.info("Scraper shutdown complete")


async def _scrape_worker(index: int):
    queue: asyncio.Queue[ScrapeJob] = app.state.scrape_queue
    in_flight_jobs: dict[int, float] = app.state.in_flight_jobs

    while True:
        job = await queue.get()
        try:
            started_at = time.monotonic()
            in_flight_jobs[index] = started_at
            logger.info(
                "Worker %d processing scrape for url=%r queue_depth=%d",
                index,
                job.request.url,
                queue.qsize(),
            )
            result = await _run_scrape_subprocess(
                job.request.url,
                job.request.css_selector,
                job.request.element_fingerprint,
            )
            if not job.future.done():
                job.future.set_result(result)
        except Exception as exc:
            logger.exception("Worker %d failed for url=%r", index, job.request.url)
            if not job.future.done():
                job.future.set_result(
                    {
                        "price": None,
                        "stock_status": None,
                        "raw_content": None,
                        "error": f"Scrape failed: {exc}",
                    }
                )
        finally:
            in_flight_jobs.pop(index, None)
            queue.task_done()


async def _run_scrape_subprocess(
    url: str,
    css_selector: str | None = None,
    element_fingerprint: str | None = None,
) -> dict:
    command = [
        sys.executable,
        "-m",
        "app.runner",
        "--url",
        url,
    ]
    if css_selector:
        command.extend(["--css-selector", css_selector])
    if element_fingerprint:
        command.extend(["--element-fingerprint", element_fingerprint])

    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=os.path.dirname(os.path.dirname(__file__)),
    )

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=settings.scrape_job_timeout_ms / 1000,
        )
    except asyncio.TimeoutError:
        await _terminate_process(process)
        return {
            "price": None,
            "stock_status": None,
            "raw_content": None,
            "error": "Scrape timed out",
        }
    except asyncio.CancelledError:
        await _terminate_process(process)
        raise

    if process.returncode != 0:
        logger.error(
            "Scrape subprocess failed with code=%s stderr=%r",
            process.returncode,
            stderr.decode(errors="replace"),
        )
        return {
            "price": None,
            "stock_status": None,
            "raw_content": None,
            "error": "Scrape subprocess failed",
        }

    try:
        return json.loads(stdout.decode() or "{}")
    except json.JSONDecodeError:
        logger.error("Failed to decode scraper runner output: %r", stdout[:500])
        return {
            "price": None,
            "stock_status": None,
            "raw_content": None,
            "error": "Scrape subprocess returned invalid JSON",
        }


async def _terminate_process(process: asyncio.subprocess.Process):
    if process.returncode is not None:
        return

    process.kill()
    with contextlib.suppress(ProcessLookupError):
        await process.wait()


def _health_payload() -> dict:
    queue: asyncio.Queue[ScrapeJob] | None = getattr(app.state, "scrape_queue", None)
    in_flight_jobs: dict[int, float] = getattr(app.state, "in_flight_jobs", {})
    now = time.monotonic()
    ages_ms = [
        max(0, int((now - started_at) * 1000))
        for started_at in in_flight_jobs.values()
    ]
    stuck_threshold_ms = (
        settings.scrape_job_timeout_ms + settings.health_stuck_grace_ms
    )
    stuck_workers = sum(1 for age_ms in ages_ms if age_ms > stuck_threshold_ms)
    unhealthy = stuck_workers > 0

    return {
        "status": "degraded" if unhealthy else "ok",
        "queue_depth": queue.qsize() if queue is not None else 0,
        "queue_capacity": settings.scrape_queue_size,
        "enqueue_wait_ms": settings.scrape_enqueue_wait_ms,
        "workers": settings.scrape_workers,
        "in_flight": len(in_flight_jobs),
        "oldest_in_flight_ms": max(ages_ms, default=0),
        "stuck_workers": stuck_workers,
    }


@app.get("/health")
async def health():
    payload = _health_payload()
    if payload["status"] != "ok":
        raise HTTPException(status_code=503, detail=payload)
    return payload


@app.post("/check", response_model=CheckResponse)
async def check(request: CheckRequest):
    logger.info(
        "Check request: url=%r, css_selector=%r, has_fingerprint=%s",
        request.url,
        request.css_selector,
        request.element_fingerprint is not None,
    )

    queue: asyncio.Queue[ScrapeJob] = app.state.scrape_queue
    job = ScrapeJob(request)
    try:
        await asyncio.wait_for(
            queue.put(job),
            timeout=settings.scrape_enqueue_wait_ms / 1000,
        )
    except TimeoutError as exc:
        logger.warning(
            "Rejecting scrape request because queue did not free in time: url=%r queue_depth=%d",
            request.url,
            queue.qsize(),
        )
        raise HTTPException(status_code=503, detail="Scraper is at capacity") from exc

    result = await job.future
    logger.info(
        "Result: price=%s, stock=%s, error=%s",
        result["price"],
        result["stock_status"],
        result["error"],
    )
    return CheckResponse(**result)
