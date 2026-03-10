from app import scraper
import threading


def test_dynamic_fetch_crash_triggers_cleanup(monkeypatch):
    removed_dirs: list[str] = []
    chrome_cleanup_calls: list[bool] = []

    glob_results = iter(
        [
            ["/tmp/playwright_chromiumdev_profile-existing"],
            [
                "/tmp/playwright_chromiumdev_profile-existing",
                "/tmp/playwright_chromiumdev_profile-new",
            ],
        ]
    )

    monkeypatch.setattr(scraper._glob, "glob", lambda pattern: next(glob_results))
    monkeypatch.setattr(
        scraper.DynamicFetcher,
        "fetch",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    monkeypatch.setattr(scraper, "kill_all_chrome", lambda: chrome_cleanup_calls.append(True))
    monkeypatch.setattr(
        scraper,
        "_cleanup_profile_dirs",
        lambda dirs: removed_dirs.extend(sorted(dirs)),
    )

    try:
        scraper._fetch_dynamic_page("https://example.com/product")
    except RuntimeError as exc:
        assert str(exc) == "boom"
    else:
        raise AssertionError("Expected dynamic fetch to raise")

    assert chrome_cleanup_calls == [True]
    assert removed_dirs == ["/tmp/playwright_chromiumdev_profile-new"]


def test_kill_all_chrome_skips_when_dynamic_fetch_active(monkeypatch):
    calls: list[tuple[str, tuple[str, ...]]] = []
    entered = threading.Event()
    release = threading.Event()

    monkeypatch.setattr(scraper._glob, "glob", lambda pattern: ["/tmp/playwright_chromiumdev_profile-stale"])
    monkeypatch.setattr(
        scraper.subprocess,
        "run",
        lambda args, **kwargs: calls.append(("run", tuple(args))),
    )
    monkeypatch.setattr(
        scraper,
        "_cleanup_profile_dirs",
        lambda dirs: calls.append(("cleanup", tuple(dirs))),
    )

    def hold_lock():
        with scraper._chrome_lifecycle_lock:
            entered.set()
            release.wait(timeout=2)

    thread = threading.Thread(target=hold_lock)
    thread.start()
    assert entered.wait(timeout=2)
    did_cleanup = scraper.kill_all_chrome(skip_if_busy=True)
    release.set()
    thread.join(timeout=2)

    assert did_cleanup is False
    assert calls == []


def test_dynamic_fetch_retries_transient_target_closed(monkeypatch):
    fetch_calls: list[int] = []
    cleanup_calls: list[bool] = []

    glob_results = iter(
        [
            ["/tmp/playwright_chromiumdev_profile-existing"],
            ["/tmp/playwright_chromiumdev_profile-existing"],
        ]
    )

    def fake_fetch(*args, **kwargs):
        fetch_calls.append(1)
        if len(fetch_calls) == 1:
            raise RuntimeError("Target page, context or browser has been closed")

        class Response:
            status = 200
            reason = "OK"
            body = "<html><body>ok</body></html>"
            encoding = "utf-8"

        return Response()

    monkeypatch.setattr(scraper._glob, "glob", lambda pattern: next(glob_results))
    monkeypatch.setattr(scraper.DynamicFetcher, "fetch", fake_fetch)
    monkeypatch.setattr(scraper, "kill_all_chrome", lambda **kwargs: cleanup_calls.append(True) or True)
    monkeypatch.setattr(scraper.time, "sleep", lambda seconds: None)

    result = scraper._fetch_dynamic_page("https://example.com/product")

    assert result == {"html": "<html><body>ok</body></html>"}
    assert len(fetch_calls) == 2
    assert cleanup_calls == [True]
