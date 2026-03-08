import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .models import CheckRequest, CheckResponse
from .scraper import scrape_product

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Pounce Scraper")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/check", response_model=CheckResponse)
def check(request: CheckRequest):
    logger.info("Check request: url=%r, css_selector=%r", request.url, request.css_selector)
    result = scrape_product(request.url, request.css_selector)
    logger.info("Result: price=%s, stock=%s, error=%s", result["price"], result["stock_status"], result["error"])
    return CheckResponse(**result)
