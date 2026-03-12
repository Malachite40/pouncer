import asyncio

import pytest
from fastapi import HTTPException

from app.executor import ScrapeJobResult, ScrapeRequestError
from app.main import _health_payload, app, check, health
from app.models import CheckRequest


class FakeJob:
    def __init__(self, result: ScrapeJobResult):
        loop = asyncio.get_running_loop()
        self.future = loop.create_future()
        self.future.set_result(result)


class FakeExecutor:
    def __init__(self, payload: dict, job_result: ScrapeJobResult | None = None):
        self._payload = payload
        self._job_result = job_result
        self.enqueue_error: ScrapeRequestError | None = None

    def health_payload(self):
        return self._payload

    async def enqueue(self, _request: CheckRequest):
        if self.enqueue_error is not None:
            raise self.enqueue_error
        return FakeJob(self._job_result or ScrapeJobResult(status_code=200, payload={}))


def test_health_reports_executor_payload():
    app.state.scrape_executor = FakeExecutor(
        {
            "status": "degraded",
            "queue_depth": 1,
            "queue_capacity": 16,
            "enqueue_wait_ms": 3000,
            "workers": 1,
            "in_flight": 1,
            "oldest_in_flight_ms": 60000,
            "stuck_workers": 1,
            "browser_workers_total": 1,
            "browser_workers_ready": 0,
            "browser_restarts": 2,
            "last_launch_error": "boom",
        }
    )

    payload = _health_payload()

    assert payload["status"] == "degraded"
    assert payload["browser_workers_ready"] == 0
    assert payload["last_launch_error"] == "boom"

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(health())

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["browser_workers_ready"] == 0


def test_check_rejects_when_executor_is_unavailable():
    executor = FakeExecutor({"status": "ok"})
    executor.enqueue_error = ScrapeRequestError(
        503,
        {"status": "degraded", "reason": "no_browser_workers_ready"},
    )
    app.state.scrape_executor = executor

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(check(CheckRequest(url="https://example.com/product")))

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["reason"] == "no_browser_workers_ready"


def test_check_propagates_timeout_status():
    app.state.scrape_executor = FakeExecutor(
        {"status": "ok"},
        ScrapeJobResult(
            status_code=504,
            detail={"status": "timeout", "reason": "scrape_job_timeout"},
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(check(CheckRequest(url="https://example.com/product")))

    assert exc_info.value.status_code == 504
    assert exc_info.value.detail["status"] == "timeout"


def test_check_returns_success_payload():
    app.state.scrape_executor = FakeExecutor(
        {"status": "ok"},
        ScrapeJobResult(
            status_code=200,
            payload={
                "price": 42.5,
                "stock_status": "in_stock",
                "raw_content": "ok",
                "error": None,
            },
        ),
    )

    result = asyncio.run(check(CheckRequest(url="https://example.com/product")))

    assert result.price == 42.5
    assert result.stock_status == "in_stock"
