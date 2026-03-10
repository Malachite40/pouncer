import asyncio
import contextlib
import logging
import sys
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pythonjsonlogger.json import JsonFormatter

from .config import settings
from .models import CheckRequest, CheckResponse
from .scraper import kill_all_chrome, scrape_product

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
    app.state.executor = ThreadPoolExecutor(
        max_workers=settings.scrape_workers,
        thread_name_prefix="pounce-scrape",
    )
    app.state.worker_tasks = [
        asyncio.create_task(_scrape_worker(index))
        for index in range(settings.scrape_workers)
    ]
    app.state.cleanup_task = asyncio.create_task(_cleanup_loop())
    logger.info(
        "Scraper started with workers=%d queue_size=%d",
        settings.scrape_workers,
        settings.scrape_queue_size,
    )


@app.on_event("shutdown")
async def _shutdown():
    cleanup_task = getattr(app.state, "cleanup_task", None)
    if cleanup_task is not None:
        cleanup_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await cleanup_task

    worker_tasks = getattr(app.state, "worker_tasks", [])
    for task in worker_tasks:
        task.cancel()
    for task in worker_tasks:
        with contextlib.suppress(asyncio.CancelledError):
            await task

    executor = getattr(app.state, "executor", None)
    if executor is not None:
        executor.shutdown(wait=False, cancel_futures=True)

    kill_all_chrome()
    logger.info("Scraper shutdown complete")


async def _cleanup_loop():
    while True:
        await asyncio.sleep(60)
        if kill_all_chrome(skip_if_busy=True):
            logger.info("Periodic chrome cleanup ran")


async def _scrape_worker(index: int):
    queue: asyncio.Queue[ScrapeJob] = app.state.scrape_queue
    executor: ThreadPoolExecutor = app.state.executor
    loop = asyncio.get_running_loop()

    while True:
        job = await queue.get()
        try:
            logger.info(
                "Worker %d processing scrape for url=%r queue_depth=%d",
                index,
                job.request.url,
                queue.qsize(),
            )
            result = await loop.run_in_executor(
                executor,
                scrape_product,
                job.request.url,
                job.request.css_selector,
                job.request.element_fingerprint,
            )
            if not job.future.done():
                job.future.set_result(result)
        except Exception as exc:
            logger.exception("Worker %d failed for url=%r", index, job.request.url)
            if not job.future.done():
                job.future.set_exception(exc)
        finally:
            queue.task_done()


@app.get("/health")
async def health():
    queue: asyncio.Queue[ScrapeJob] | None = getattr(app.state, "scrape_queue", None)
    return {
        "status": "ok",
        "queue_depth": queue.qsize() if queue is not None else 0,
        "queue_capacity": settings.scrape_queue_size,
        "workers": settings.scrape_workers,
    }


@app.post("/check", response_model=CheckResponse)
async def check(request: CheckRequest):
    logger.info(
        "Check request: url=%r, css_selector=%r, has_fingerprint=%s",
        request.url,
        request.css_selector,
        request.element_fingerprint is not None,
    )

    queue: asyncio.Queue[ScrapeJob] = app.state.scrape_queue
    if queue.full():
        logger.warning("Rejecting scrape request because queue is full: url=%r", request.url)
        raise HTTPException(status_code=503, detail="Scraper is at capacity")

    job = ScrapeJob(request)
    try:
        queue.put_nowait(job)
    except asyncio.QueueFull as exc:
        logger.warning("Scrape queue filled before enqueue completed: url=%r", request.url)
        raise HTTPException(status_code=503, detail="Scraper is at capacity") from exc

    result = await job.future
    logger.info(
        "Result: price=%s, stock=%s, error=%s",
        result["price"],
        result["stock_status"],
        result["error"],
    )
    return CheckResponse(**result)
