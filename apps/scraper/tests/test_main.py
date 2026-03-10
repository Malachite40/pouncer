import asyncio

import pytest
from fastapi import HTTPException

from app.main import app, check
from app.models import CheckRequest


def test_check_rejects_when_queue_is_full():
    queue = asyncio.Queue(maxsize=1)
    queue.put_nowait(object())
    app.state.scrape_queue = queue

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(check(CheckRequest(url="https://example.com/product")))

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "Scraper is at capacity"
