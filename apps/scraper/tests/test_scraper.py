import pytest
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from app import scraper


class FakeResponse:
    def __init__(self, status: int = 200, status_text: str = "OK"):
        self.status = status
        self.status_text = status_text


class FakeLocator:
    def __init__(self, page, selector: str):
        self.page = page
        self.selector = selector

    @property
    def first(self):
        return self

    async def wait_for(self, state: str, timeout: int):
        self.page.waited_selectors.append((self.selector, state, timeout))
        if self.selector not in self.page.ready_selectors:
            raise PlaywrightTimeoutError(f"{self.selector} not ready")


class FakePage:
    def __init__(
        self,
        *,
        html: str = "<html><body>ok</body></html>",
        ready_selectors: set[str] | None = None,
        goto_result: FakeResponse | None = None,
        goto_exception: Exception | None = None,
    ):
        self.html = html
        self.ready_selectors = ready_selectors or {"body"}
        self.goto_result = goto_result or FakeResponse()
        self.goto_exception = goto_exception
        self.goto_calls: list[tuple[str, str, int]] = []
        self.waited_selectors: list[tuple[str, str, int]] = []
        self.wait_for_timeout_calls: list[int] = []
        self.closed = False

    async def goto(self, url: str, wait_until: str, timeout: int):
        self.goto_calls.append((url, wait_until, timeout))
        if self.goto_exception is not None:
            raise self.goto_exception
        return self.goto_result

    def locator(self, selector: str):
        return FakeLocator(self, selector)

    async def wait_for_timeout(self, timeout_ms: int):
        self.wait_for_timeout_calls.append(timeout_ms)

    async def content(self):
        return self.html

    async def close(self):
        self.closed = True


class FakeContext:
    def __init__(self, page: FakePage, kwargs: dict):
        self.page = page
        self.kwargs = kwargs
        self.closed = False
        self.new_page_calls = 0

    async def new_page(self):
        self.new_page_calls += 1
        return self.page

    async def close(self):
        self.closed = True


class FakeBrowser:
    def __init__(self, pages: list[FakePage]):
        self.pages = list(pages)
        self.contexts: list[FakeContext] = []

    async def new_context(self, **kwargs):
        page = self.pages.pop(0)
        context = FakeContext(page, kwargs)
        self.contexts.append(context)
        return context


@pytest.mark.anyio
async def test_scrape_product_reports_dynamic_fetch_error_after_empty_extraction(
    monkeypatch,
):
    async def fake_static_fetch(_url):
        return {"html": "<html><body><div>No price here</div></body></html>"}

    async def fake_dynamic_fetch(_browser, _url, _css_selector=None):
        return scraper._error_result("browser has been closed")

    monkeypatch.setattr(scraper, "_fetch_static_page", fake_static_fetch)
    monkeypatch.setattr(scraper, "_fetch_dynamic_page", fake_dynamic_fetch)

    result = await scraper.scrape_product("https://example.com/product", FakeBrowser([]))

    assert result["price"] is None
    assert result["stock_status"] is None
    assert (
        result["error"]
        == "Dynamic fetch failed after empty extraction: browser has been closed"
    )
    assert "[scrapling-dynamic] error=browser has been closed" in (
        result["raw_content"] or ""
    )


@pytest.mark.anyio
async def test_scrape_product_reports_no_product_data_when_fetches_succeed_without_matches(
    monkeypatch,
):
    async def fake_static_fetch(_url):
        return {"html": "<html><body><div>Nothing useful</div></body></html>"}

    async def fake_dynamic_fetch(_browser, _url, _css_selector=None):
        return {"html": "<html><body><div>Still nothing useful</div></body></html>"}

    monkeypatch.setattr(scraper, "_fetch_static_page", fake_static_fetch)
    monkeypatch.setattr(scraper, "_fetch_dynamic_page", fake_dynamic_fetch)

    result = await scraper.scrape_product("https://example.com/product", FakeBrowser([]))

    assert result["price"] is None
    assert result["stock_status"] is None
    assert result["error"] == "No product data extracted from page"
    assert "[source] scrapling-static" in (result["raw_content"] or "")
    assert "[source] scrapling-dynamic" in (result["raw_content"] or "")


@pytest.mark.anyio
async def test_scrape_product_keeps_successful_extraction_error_free(monkeypatch):
    async def fake_static_fetch(_url):
        return {
            "html": """
            <html><body>
                <span class="price">$84.76</span>
                <div class="stock">In Stock</div>
            </body></html>
            """
        }

    monkeypatch.setattr(scraper, "_fetch_static_page", fake_static_fetch)

    result = await scraper.scrape_product("https://example.com/product", FakeBrowser([]))

    assert result["price"] == 84.76
    assert result["stock_status"] == "in_stock"
    assert result["error"] is None


@pytest.mark.anyio
async def test_dynamic_fetch_uses_domcontentloaded_and_css_selector():
    page = FakePage(ready_selectors={"#cta"})
    browser = FakeBrowser([page])

    result = await scraper._fetch_dynamic_page(
        browser,
        "https://example.com/product",
        "#cta",
    )

    assert result == {"html": "<html><body>ok</body></html>"}
    assert page.goto_calls == [
        ("https://example.com/product", "domcontentloaded", scraper.settings.page_navigation_timeout_ms)
    ]
    assert page.waited_selectors == [
        ("#cta", scraper.settings.dynamic_wait_selector_state, scraper.settings.page_selector_timeout_ms)
    ]
    assert browser.contexts[0].kwargs == {
        "locale": "en-US",
        "user_agent": scraper.settings.browser_user_agent,
        "extra_http_headers": {
            "accept-language": scraper.settings.browser_accept_language,
        },
    }


@pytest.mark.anyio
async def test_dynamic_fetch_falls_back_to_body_when_host_selector_is_not_ready():
    page = FakePage(ready_selectors={"body"})
    browser = FakeBrowser([page])

    result = await scraper._fetch_dynamic_page(
        browser,
        "https://www.tcgplayer.com/product/123",
    )

    assert result == {"html": "<html><body>ok</body></html>"}
    assert [selector for selector, _state, _timeout in page.waited_selectors] == [
        "button[id^='btnAddToCart'], .price-points, .product-details",
        "body",
    ]


@pytest.mark.anyio
async def test_scrape_product_normalizes_tcgplayer_add_to_cart_selector(monkeypatch):
    seen_selectors: list[str | None] = []

    async def fake_static_fetch(_url):
        return {"html": "<html><body><div>loading</div></body></html>"}

    async def fake_dynamic_fetch(_browser, _url, css_selector=None):
        seen_selectors.append(css_selector)
        return {"html": "<html><body><button id='btnAddToCart_FS_1-abc'>Add to Cart</button></body></html>"}

    monkeypatch.setattr(scraper, "_fetch_static_page", fake_static_fetch)
    monkeypatch.setattr(scraper, "_fetch_dynamic_page", fake_dynamic_fetch)

    result = await scraper.scrape_product(
        "https://www.tcgplayer.com/product/123",
        FakeBrowser([]),
        "#btnAddToCart_FS_8925728-ca75c918",
    )

    assert result["stock_status"] == "in_stock"
    assert seen_selectors == ["button[id^='btnAddToCart']"]


@pytest.mark.anyio
async def test_dynamic_fetch_uses_fresh_context_per_call():
    browser = FakeBrowser([FakePage(), FakePage()])

    await scraper._fetch_dynamic_page(browser, "https://example.com/one")
    await scraper._fetch_dynamic_page(browser, "https://example.com/two")

    assert len(browser.contexts) == 2
    assert all(context.closed for context in browser.contexts)
    assert all(context.new_page_calls == 1 for context in browser.contexts)


@pytest.mark.anyio
async def test_dynamic_fetch_raises_browser_session_error_for_closed_browser():
    class ClosedBrowser:
        async def new_context(self, **_kwargs):
            raise PlaywrightError(
                "Target page, context or browser has been closed"
            )

    with pytest.raises(scraper.BrowserSessionError):
        await scraper._fetch_dynamic_page(
            ClosedBrowser(),
            "https://example.com/product",
        )


def test_get_wait_selectors_include_steam_and_tcgplayer_profiles():
    assert scraper._get_wait_selectors("https://store.steampowered.com/steamdeck") == [
        "[class*='SaleSection_'], .game_area_purchase_game",
        "body",
    ]
    assert scraper._get_wait_selectors("https://www.tcgplayer.com/product/123") == [
        "button[id^='btnAddToCart'], .price-points, .product-details",
        "body",
    ]


def test_normalize_css_selector_for_tcgplayer_add_to_cart():
    assert (
        scraper._normalize_css_selector(
            "https://www.tcgplayer.com/product/123",
            "#btnAddToCart_FS_8925728-ca75c918",
        )
        == "button[id^='btnAddToCart']"
    )
    assert (
        scraper._normalize_css_selector(
            "https://example.com/product",
            "#btnAddToCart_FS_8925728-ca75c918",
        )
        == "#btnAddToCart_FS_8925728-ca75c918"
    )
