import asyncio
import logging
import sys

from anyio import CapacityLimiter
from anyio.to_thread import run_sync
from fastapi import FastAPI
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

# Limit concurrent scrape threads to 2 (1 dynamic at a time + 1 static-only)
_scrape_limiter = CapacityLimiter(2)

app = FastAPI(title="Pounce Scraper")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _start_cleanup_loop():
    async def _cleanup():
        while True:
            await asyncio.sleep(60)
            kill_all_chrome()
            logger.info("Periodic chrome cleanup ran")
    asyncio.create_task(_cleanup())


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/check", response_model=CheckResponse)
async def check(request: CheckRequest):
    logger.info("Check request: url=%r, css_selector=%r, has_fingerprint=%s", request.url, request.css_selector, request.element_fingerprint is not None)
    result = await run_sync(
        lambda: scrape_product(request.url, request.css_selector, request.element_fingerprint),
        limiter=_scrape_limiter,
    )
    logger.info("Result: price=%s, stock=%s, error=%s", result["price"], result["stock_status"], result["error"])
    return CheckResponse(**result)
