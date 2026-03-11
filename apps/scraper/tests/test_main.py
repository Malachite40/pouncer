import asyncio
import json

import pytest
from fastapi import HTTPException

from app.config import settings
from app.main import _health_payload, _run_scrape_subprocess, app, check, health
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


def test_run_scrape_subprocess_times_out_and_kills_process(monkeypatch):
    class FakeProcess:
        def __init__(self):
            self.returncode = None
            self.killed = False

        async def communicate(self):
            await asyncio.sleep(1)
            return (b"", b"")

        def kill(self):
            self.killed = True
            self.returncode = -9

        async def wait(self):
            return self.returncode

    process = FakeProcess()

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return process

    monkeypatch.setattr(
        "app.main.asyncio.create_subprocess_exec",
        fake_create_subprocess_exec,
    )
    monkeypatch.setattr("app.main.settings.scrape_job_timeout_ms", 10)

    result = asyncio.run(_run_scrape_subprocess("https://example.com/product"))

    assert result["error"] == "Scrape timed out"
    assert process.killed is True


def test_health_reports_stuck_workers(monkeypatch):
    queue = asyncio.Queue(maxsize=4)
    app.state.scrape_queue = queue
    app.state.in_flight_jobs = {0: 10.0}
    monkeypatch.setattr("app.main.time.monotonic", lambda: 70.0)
    monkeypatch.setattr("app.main.settings.scrape_job_timeout_ms", 45_000)
    monkeypatch.setattr("app.main.settings.health_stuck_grace_ms", 5_000)

    payload = _health_payload()

    assert payload["status"] == "degraded"
    assert payload["in_flight"] == 1
    assert payload["oldest_in_flight_ms"] == 60_000
    assert payload["stuck_workers"] == 1

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(health())

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["stuck_workers"] == 1


def test_run_scrape_subprocess_parses_runner_output(monkeypatch):
    class FakeProcess:
        def __init__(self):
            self.returncode = 0

        async def communicate(self):
            return (
                json.dumps(
                    {
                        "price": 42.5,
                        "stock_status": "in_stock",
                        "raw_content": "ok",
                        "error": None,
                    }
                ).encode(),
                b"",
            )

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeProcess()

    monkeypatch.setattr(
        "app.main.asyncio.create_subprocess_exec",
        fake_create_subprocess_exec,
    )

    result = asyncio.run(_run_scrape_subprocess("https://example.com/product"))

    assert result["price"] == 42.5
    assert result["stock_status"] == "in_stock"
