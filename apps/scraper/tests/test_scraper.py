from app import scraper


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
