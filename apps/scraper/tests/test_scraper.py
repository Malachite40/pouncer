from app import scraper


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

    try:
        scraper._fetch_dynamic_page("https://example.com/product")
    except RuntimeError as exc:
        assert str(exc) == "boom"
    else:
        raise AssertionError("Expected dynamic fetch to raise")

    assert cleaned_dirs == ["/tmp/pounce-profile-1"]
