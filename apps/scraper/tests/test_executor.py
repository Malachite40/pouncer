import asyncio

import pytest

from app.executor import (
    BrowserWorkerState,
    ScrapeExecutor,
    ScrapeJobResult,
    ScrapeRequestError,
)
from app.main import app
from app.models import CheckRequest
from app.scraper import BrowserSessionError


class FakeBrowser:
    def __init__(self):
        self.closed = False

    async def close(self):
        self.closed = True


class FakeChromium:
    def __init__(self, launch_results):
        self.launch_results = list(launch_results)
        self.launch_calls = 0

    async def launch(self, **_kwargs):
        self.launch_calls += 1
        result = self.launch_results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class FakePlaywright:
    def __init__(self, chromium: FakeChromium):
        self.chromium = chromium
        self.stopped = False

    async def stop(self):
        self.stopped = True


class FakePlaywrightManager:
    def __init__(self, playwright: FakePlaywright):
        self.playwright = playwright

    async def start(self):
        return self.playwright


def make_playwright_factory(launch_results):
    chromium = FakeChromium(launch_results)
    playwright = FakePlaywright(chromium)

    def factory():
        return FakePlaywrightManager(playwright)

    return factory, chromium, playwright


@pytest.mark.anyio
async def test_executor_health_reports_degraded_workers(monkeypatch):
    monkeypatch.setattr("app.executor.settings.scrape_workers", 1)
    executor = ScrapeExecutor(
        playwright_factory=lambda: FakePlaywrightManager(
            FakePlaywright(FakeChromium([]))
        )
    )
    executor.worker_states = [
        BrowserWorkerState(
            index=0,
            ready=False,
            last_launch_error="boom",
            last_launch_error_at=1.0,
        )
    ]

    payload = executor.health_payload()

    assert payload["status"] == "degraded"
    assert payload["browser_workers_total"] == 1
    assert payload["browser_workers_ready"] == 0
    assert payload["last_launch_error"] == "boom"


@pytest.mark.anyio
async def test_executor_returns_503_when_workers_cannot_launch(monkeypatch):
    monkeypatch.setattr("app.executor.settings.scrape_workers", 1)
    factory, _chromium, playwright = make_playwright_factory(
        [RuntimeError("browser unavailable"), RuntimeError("browser unavailable")]
    )
    executor = ScrapeExecutor(playwright_factory=factory)
    await executor.start()

    with pytest.raises(ScrapeRequestError) as exc_info:
        await executor.enqueue(CheckRequest(url="https://example.com/product"))

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["reason"] == "no_browser_workers_ready"

    await executor.shutdown()
    assert playwright.stopped is True


@pytest.mark.anyio
async def test_executor_returns_504_on_job_timeout(monkeypatch):
    monkeypatch.setattr("app.executor.settings.scrape_workers", 1)
    monkeypatch.setattr("app.executor.settings.scrape_job_timeout_ms", 10)
    monkeypatch.setattr("app.executor.settings.browser_restart_backoff_ms", 0)
    factory, chromium, playwright = make_playwright_factory(
        [FakeBrowser(), FakeBrowser()]
    )

    async def slow_scrape(_url, _browser, _css_selector, _element_fingerprint):
        await asyncio.sleep(0.05)
        return {
            "price": None,
            "stock_status": None,
            "raw_content": None,
            "error": None,
        }

    executor = ScrapeExecutor(scrape_func=slow_scrape, playwright_factory=factory)
    await executor.start()

    job = await executor.enqueue(CheckRequest(url="https://example.com/product"))
    result = await job.future

    assert result.status_code == 504
    assert result.detail["status"] == "timeout"
    assert executor.worker_states[0].restart_count == 1
    assert chromium.launch_calls == 2

    await executor.shutdown()
    assert playwright.stopped is True


@pytest.mark.anyio
async def test_executor_restarts_browser_after_browser_session_error(monkeypatch):
    monkeypatch.setattr("app.executor.settings.scrape_workers", 1)
    monkeypatch.setattr("app.executor.settings.browser_restart_backoff_ms", 0)
    factory, chromium, _playwright = make_playwright_factory(
        [FakeBrowser(), FakeBrowser()]
    )
    calls = 0

    async def flaky_scrape(_url, _browser, _css_selector, _element_fingerprint):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise BrowserSessionError("Target page, context or browser has been closed")
        return {
            "price": 12.5,
            "stock_status": "in_stock",
            "raw_content": "ok",
            "error": None,
        }

    executor = ScrapeExecutor(scrape_func=flaky_scrape, playwright_factory=factory)
    await executor.start()

    first_job = await executor.enqueue(CheckRequest(url="https://example.com/one"))
    first_result = await first_job.future
    second_job = await executor.enqueue(CheckRequest(url="https://example.com/two"))
    second_result = await second_job.future

    assert first_result.status_code == 503
    assert first_result.detail["reason"] == "browser_restart_required"
    assert second_result == ScrapeJobResult(
        status_code=200,
        payload={
            "price": 12.5,
            "stock_status": "in_stock",
            "raw_content": "ok",
            "error": None,
        },
        detail=None,
    )
    assert executor.worker_states[0].restart_count == 1
    assert chromium.launch_calls == 2

    await executor.shutdown()


@pytest.mark.anyio
async def test_executor_overlapping_requests_do_not_use_subprocess(monkeypatch):
    monkeypatch.setattr("app.executor.settings.scrape_workers", 1)
    monkeypatch.setattr("app.executor.settings.scrape_queue_size", 4)
    factory, _chromium, _playwright = make_playwright_factory([FakeBrowser()])
    started = asyncio.Event()
    release = asyncio.Event()

    async def scrape_once(_url, _browser, _css_selector, _element_fingerprint):
        if not started.is_set():
            started.set()
            await release.wait()
        return {
            "price": None,
            "stock_status": None,
            "raw_content": None,
            "error": None,
        }

    async def fail_if_called(*_args, **_kwargs):
        raise AssertionError("subprocess path should not be used")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fail_if_called)

    executor = ScrapeExecutor(scrape_func=scrape_once, playwright_factory=factory)
    await executor.start()
    app.state.scrape_executor = executor

    first_job = await executor.enqueue(CheckRequest(url="https://example.com/one"))
    await started.wait()
    second_job = await executor.enqueue(CheckRequest(url="https://example.com/two"))
    release.set()

    assert (await first_job.future).status_code == 200
    assert (await second_job.future).status_code == 200

    await executor.shutdown()
