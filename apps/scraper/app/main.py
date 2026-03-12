import logging
import sys

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pythonjsonlogger.json import JsonFormatter

from .config import settings
from .executor import ScrapeExecutor, ScrapeRequestError
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


app = FastAPI(title="Pounce Scraper")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    executor = ScrapeExecutor()
    app.state.scrape_executor = executor
    await executor.start()


@app.on_event("shutdown")
async def _shutdown():
    executor: ScrapeExecutor | None = getattr(app.state, "scrape_executor", None)
    if executor is not None:
        await executor.shutdown()


def _health_payload() -> dict:
    executor: ScrapeExecutor | None = getattr(app.state, "scrape_executor", None)
    if executor is None:
        return {
            "status": "degraded",
            "queue_depth": 0,
            "queue_capacity": settings.scrape_queue_size,
            "enqueue_wait_ms": settings.scrape_enqueue_wait_ms,
            "workers": settings.scrape_workers,
            "in_flight": 0,
            "oldest_in_flight_ms": 0,
            "stuck_workers": 0,
            "browser_workers_total": settings.scrape_workers,
            "browser_workers_ready": 0,
            "browser_restarts": 0,
            "last_launch_error": "scrape_executor_unavailable",
        }
    return executor.health_payload()


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

    executor: ScrapeExecutor | None = getattr(app.state, "scrape_executor", None)
    if executor is None:
        raise HTTPException(
            status_code=503,
            detail={"status": "degraded", "reason": "scrape_executor_unavailable"},
        )
    try:
        job = await executor.enqueue(request)
    except ScrapeRequestError as exc:
        logger.warning(
            "Rejecting scrape request for url=%r detail=%r",
            request.url,
            exc.detail,
        )
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    result = await job.future
    if result.status_code != 200:
        logger.warning(
            "Scrape request failed for url=%r status=%d detail=%r",
            request.url,
            result.status_code,
            result.detail,
        )
        raise HTTPException(status_code=result.status_code, detail=result.detail)

    payload = result.payload or {
        "price": None,
        "stock_status": None,
        "raw_content": None,
        "error": None,
    }
    logger.info(
        "Result: price=%s, stock=%s, error=%s",
        payload["price"],
        payload["stock_status"],
        payload["error"],
    )
    return CheckResponse(**payload)
