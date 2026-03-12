from app import scraper


def test_scrape_product_reports_dynamic_fetch_error_after_empty_extraction(monkeypatch):
    monkeypatch.setattr(
        scraper,
        "_fetch_static_page",
        lambda _url: {"html": "<html><body><div>No price here</div></body></html>"},
    )
    monkeypatch.setattr(
        scraper,
        "_fetch_dynamic_page",
        lambda _url, _css_selector=None: scraper._error_result("browser has been closed"),
    )

    result = scraper.scrape_product("https://example.com/product")

    assert result["price"] is None
    assert result["stock_status"] is None
    assert (
        result["error"]
        == "Dynamic fetch failed after empty extraction: browser has been closed"
    )
    assert "[scrapling-dynamic] error=browser has been closed" in (
        result["raw_content"] or ""
    )


def test_scrape_product_reports_no_product_data_when_fetches_succeed_without_matches(
    monkeypatch,
):
    monkeypatch.setattr(
        scraper,
        "_fetch_static_page",
        lambda _url: {"html": "<html><body><div>Nothing useful</div></body></html>"},
    )
    monkeypatch.setattr(
        scraper,
        "_fetch_dynamic_page",
        lambda _url, _css_selector=None: {
            "html": "<html><body><div>Still nothing useful</div></body></html>"
        },
    )

    result = scraper.scrape_product("https://example.com/product")

    assert result["price"] is None
    assert result["stock_status"] is None
    assert result["error"] == "No product data extracted from page"
    assert "[source] scrapling-static" in (result["raw_content"] or "")
    assert "[source] scrapling-dynamic" in (result["raw_content"] or "")


def test_scrape_product_keeps_successful_extraction_error_free(monkeypatch):
    monkeypatch.setattr(
        scraper,
        "_fetch_static_page",
        lambda _url: {
            "html": """
            <html><body>
                <span class="price">$84.76</span>
                <div class="stock">In Stock</div>
            </body></html>
            """
        },
    )

    result = scraper.scrape_product("https://example.com/product")

    assert result["price"] == 84.76
    assert result["stock_status"] == "in_stock"
    assert result["error"] is None


def test_dynamic_fetch_uses_request_scoped_session_and_cleans_profile(monkeypatch):
    cleaned_dirs: list[str] = []

    class FakeSession:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def fetch(self, url):
            class Response:
                status = 200
                reason = "OK"
                body = "<html><body>ok</body></html>"
                encoding = "utf-8"

            return Response()

    monkeypatch.setattr(scraper, "_create_dynamic_profile_dir", lambda: "/tmp/pounce-profile-1")
    monkeypatch.setattr(scraper, "_cleanup_profile_dir", lambda path: cleaned_dirs.append(path))
    monkeypatch.setattr(scraper, "DynamicSession", FakeSession)
    monkeypatch.setattr(scraper.settings, "dynamic_use_persistent_context", True)

    result = scraper._fetch_dynamic_page("https://example.com/product")

    assert result == {"html": "<html><body>ok</body></html>"}
    assert cleaned_dirs == ["/tmp/pounce-profile-1"]


def test_dynamic_fetch_retries_transient_target_closed_with_fresh_session(monkeypatch):
    profile_dirs = iter(["/tmp/pounce-profile-1", "/tmp/pounce-profile-2"])
    cleaned_dirs: list[str] = []
    session_profile_dirs: list[str] = []
    fetch_calls: list[str] = []

    class FakeSession:
        def __init__(self, **kwargs):
            session_profile_dirs.append(kwargs["user_data_dir"])
            self.profile_dir = kwargs["user_data_dir"]

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def fetch(self, url):
            fetch_calls.append(self.profile_dir)
            if len(fetch_calls) == 1:
                raise RuntimeError("Target page, context or browser has been closed")

            class Response:
                status = 200
                reason = "OK"
                body = "<html><body>ok</body></html>"
                encoding = "utf-8"

            return Response()

    monkeypatch.setattr(scraper, "_create_dynamic_profile_dir", lambda: next(profile_dirs))
    monkeypatch.setattr(scraper, "_cleanup_profile_dir", lambda path: cleaned_dirs.append(path))
    monkeypatch.setattr(scraper, "DynamicSession", FakeSession)
    monkeypatch.setattr(scraper.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(scraper.settings, "dynamic_use_persistent_context", True)

    result = scraper._fetch_dynamic_page("https://example.com/product")

    assert result == {"html": "<html><body>ok</body></html>"}
    assert session_profile_dirs == ["/tmp/pounce-profile-1", "/tmp/pounce-profile-2"]
    assert fetch_calls == ["/tmp/pounce-profile-1", "/tmp/pounce-profile-2"]
    assert cleaned_dirs == ["/tmp/pounce-profile-1", "/tmp/pounce-profile-2"]


def test_dynamic_fetch_cleans_profile_when_session_raises(monkeypatch):
    cleaned_dirs: list[str] = []

    class FakeSession:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def __enter__(self):
            raise RuntimeError("boom")

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(scraper, "_create_dynamic_profile_dir", lambda: "/tmp/pounce-profile-1")
    monkeypatch.setattr(scraper, "_cleanup_profile_dir", lambda path: cleaned_dirs.append(path))
    monkeypatch.setattr(scraper, "DynamicSession", FakeSession)
    monkeypatch.setattr(scraper.settings, "dynamic_use_persistent_context", True)

    try:
        scraper._fetch_dynamic_page("https://example.com/product")
    except RuntimeError as exc:
        assert str(exc) == "boom"
    else:
        raise AssertionError("Expected dynamic fetch to raise")

    assert cleaned_dirs == ["/tmp/pounce-profile-1"]


def test_dynamic_fetch_avoids_persistent_context_by_default(monkeypatch):
    captured_kwargs: dict | None = None

    class FakeSession:
        def __init__(self, **kwargs):
            nonlocal captured_kwargs
            captured_kwargs = kwargs

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def fetch(self, url):
            class Response:
                status = 200
                reason = "OK"
                body = "<html><body>ok</body></html>"
                encoding = "utf-8"

            return Response()

    monkeypatch.setattr(scraper, "DynamicSession", FakeSession)
    monkeypatch.setattr(scraper.settings, "dynamic_use_persistent_context", False)

    result = scraper._fetch_dynamic_page("https://example.com/product")

    assert result == {"html": "<html><body>ok</body></html>"}
    assert captured_kwargs is not None
    assert "user_data_dir" not in captured_kwargs


def test_dynamic_fetch_reports_resource_exhaustion_as_overload(monkeypatch):
    class FakeSession:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def __enter__(self):
            raise RuntimeError("BrowserType.launch_persistent_context: Connection closed while reading from the driver")

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(scraper, "DynamicSession", FakeSession)

    result = scraper._fetch_dynamic_page("https://example.com/product")

    assert result == scraper._error_result(
        "Scraper overloaded: browser launch failed due to resource exhaustion"
    )
