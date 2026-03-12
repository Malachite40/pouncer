import pytest

from app.scraper import _extract_from_html, scrape_product
from app.parsing import _validate_price
from app.strategies import (
    _extract_title_window,
    _extract_price_selectors,
    _extract_stock_selectors,
)
from bs4 import BeautifulSoup


class TestExtractFromHtml:
    def test_json_ld_product(self):
        html = """<html><head>
        <title>Test Product</title>
        <script type="application/ld+json">
        {"@type": "Product", "offers": {"price": 29.99, "availability": "InStock"}}
        </script>
        </head><body></body></html>"""
        result = _extract_from_html(html, "https://example.com/product")
        assert result["price"] == 29.99
        assert result["stock_status"] == "in_stock"
        assert result["error"] is None

    def test_css_selector_override(self):
        html = """<html><head><title>Test</title></head><body>
        <span class="my-price">$49.99</span>
        </body></html>"""
        result = _extract_from_html(html, "https://example.com/p", css_selector=".my-price")
        assert result["price"] == 49.99

    def test_meta_tag_fallback(self):
        html = """<html><head>
        <title>Test Product</title>
        <meta property="product:price:amount" content="19.99">
        </head><body></body></html>"""
        result = _extract_from_html(html, "https://example.com/product")
        assert result["price"] == 19.99

    def test_returns_none_when_no_price(self):
        html = "<html><head><title>No Price</title></head><body><p>Hello world</p></body></html>"
        result = _extract_from_html(html, "https://example.com")
        assert result["price"] is None
        assert result["error"] is None

    def test_stronger_stock_signal_overrides_title_window_guess(self):
        html = """<html><head><title>Test Product</title></head><body>
        <h1>Test Product</h1>
        <p>Add to Cart</p>
        <div class="availability">Out of Stock</div>
        </body></html>"""
        result = _extract_from_html(html, "https://example.com/product")
        assert result["stock_status"] == "out_of_stock"


class TestScrapeProduct:
    @pytest.mark.anyio
    async def test_dynamic_stock_overrides_conflicting_static_stock(self, monkeypatch):
        static_html = """
        <html><body>
        <span class="price">$54.99</span>
        <button disabled>Add to Cart</button>
        </body></html>
        """
        dynamic_html = """
        <html><body>
        <span class="price">$54.99</span>
        <button>Add to Cart</button>
        </body></html>
        """

        async def fake_static_fetch(_url):
            return {"html": static_html}

        async def fake_dynamic_fetch(_browser, _url, _css_selector=None):
            return {"html": dynamic_html}

        monkeypatch.setattr("app.scraper._fetch_static_page", fake_static_fetch)
        monkeypatch.setattr("app.scraper._fetch_dynamic_page", fake_dynamic_fetch)

        result = await scrape_product(
            "https://example.com/product",
            object(),
        )

        assert result["price"] == 54.99
        assert result["stock_status"] == "in_stock"
        assert "[source] scrapling-static" in (result["raw_content"] or "")
        assert "[source] scrapling-dynamic" in (result["raw_content"] or "")


class TestValidatePrice:
    def test_valid_price(self):
        assert _validate_price(29.99) == 29.99

    def test_none(self):
        assert _validate_price(None) is None

    def test_zero_rejected(self):
        assert _validate_price(0.0) is None

    def test_negative_rejected(self):
        assert _validate_price(-5.0) is None

    def test_too_high_rejected(self):
        assert _validate_price(150_000) is None

    def test_boundary_100k(self):
        assert _validate_price(100_000) == 100_000

    def test_just_above_zero(self):
        assert _validate_price(0.01) == 0.01


class TestTitleWindow:
    def test_filters_shipping_lines(self):
        html = """<html><head><title>Product</title></head><body>
        <h1>My Product</h1>
        <p>$29.99</p>
        <p>Free shipping on orders over $50</p>
        </body></html>"""
        soup = BeautifulSoup(html, "lxml")
        result = _extract_title_window(soup)
        assert result is not None
        assert result["price"] == 29.99

    def test_filters_was_lines(self):
        html = """<html><head><title>Product</title></head><body>
        <h1>My Product</h1>
        <p>Was $49.99</p>
        <p>$29.99</p>
        </body></html>"""
        soup = BeautifulSoup(html, "lxml")
        result = _extract_title_window(soup)
        assert result is not None
        assert result["price"] == 29.99


class TestPriceSelectors:
    def test_data_price_attribute(self):
        html = '<html><body><div data-price="29.99">$29.99</div></body></html>'
        soup = BeautifulSoup(html, "lxml")
        price, raw = _extract_price_selectors(soup)
        assert price == 29.99

    def test_itemprop_price(self):
        html = '<html><body><span itemprop="price" content="19.99">$19.99</span></body></html>'
        soup = BeautifulSoup(html, "lxml")
        price, raw = _extract_price_selectors(soup)
        assert price == 19.99

    def test_shopify_data_product_price(self):
        html = '<html><body><span data-product-price="1999">$19.99</span></body></html>'
        soup = BeautifulSoup(html, "lxml")
        price, raw = _extract_price_selectors(soup)
        assert price == 1999.0 or price == 19.99  # data attr or text


class TestStockSelectors:
    def test_itemprop_in_stock(self):
        html = '<html><body><link itemprop="availability" href="https://schema.org/InStock"></body></html>'
        soup = BeautifulSoup(html, "lxml")
        stock, raw = _extract_stock_selectors(soup)
        assert stock == "in_stock"

    def test_availability_text(self):
        html = '<html><body><div class="availability">In Stock</div></body></html>'
        soup = BeautifulSoup(html, "lxml")
        stock, raw = _extract_stock_selectors(soup)
        assert stock == "in_stock"
