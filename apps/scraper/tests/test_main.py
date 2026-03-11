import asyncio

import pytest
from fastapi import HTTPException

from app.config import settings
from app.main import app, check
from app.models import CheckRequest


def test_check_rejects_when_queue_is_full():
    queue = asyncio.Queue(maxsize=1)
    queue.put_nowait(object())
    app.state.scrape_queue = queue
    original_wait_ms = settings.scrape_enqueue_wait_ms
    settings.scrape_enqueue_wait_ms = 1

    try:
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(check(CheckRequest(url="https://example.com/product")))
    finally:
        settings.scrape_enqueue_wait_ms = original_wait_ms

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "Scraper is at capacity"


def test_check_waits_for_capacity(monkeypatch):
    queue = asyncio.Queue(maxsize=1)
    app.state.scrape_queue = queue

    async def release_slot():
        await asyncio.sleep(0.01)
        await queue.get()
        queue.task_done()

    async def run_test():
        queue.put_nowait(object())
        monkeypatch.setattr("app.main.settings.scrape_enqueue_wait_ms", 100)
        task = asyncio.create_task(release_slot())
        request = CheckRequest(url="https://example.com/product")

        check_task = asyncio.create_task(check(request))
        await asyncio.sleep(0.02)
        queued_job = await queue.get()
        queue.task_done()
        queued_job.future.set_result(
            {
                "price": None,
                "stock_status": None,
                "raw_content": None,
                "error": None,
            }
        )
        result = await check_task
        await task
        assert result.error is None

    asyncio.run(run_test())
