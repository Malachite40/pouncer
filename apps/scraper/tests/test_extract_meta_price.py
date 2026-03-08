import pytest
from bs4 import BeautifulSoup

from app.strategies import _extract_meta_price


def _soup_with_meta(property_name: str, content: str) -> BeautifulSoup:
    html = f'<html><head><meta property="{property_name}" content="{content}"></head><body></body></html>'
    return BeautifulSoup(html, "lxml")


class TestMetaPriceExtraction:
    def test_product_price_amount(self):
        soup = _soup_with_meta("product:price:amount", "29.99")
        result = _extract_meta_price(soup)
        assert result is not None
        assert result["price"] == 29.99

    def test_og_price_amount(self):
        soup = _soup_with_meta("og:price:amount", "19.99")
        result = _extract_meta_price(soup)
        assert result is not None
        assert result["price"] == 19.99

    def test_product_price(self):
        soup = _soup_with_meta("product:price", "49.99")
        result = _extract_meta_price(soup)
        assert result is not None
        assert result["price"] == 49.99

    def test_og_price(self):
        soup = _soup_with_meta("og:price", "9.99")
        result = _extract_meta_price(soup)
        assert result is not None
        assert result["price"] == 9.99

    def test_price_name_attr(self):
        html = '<html><head><meta name="price" content="39.99"></head><body></body></html>'
        soup = BeautifulSoup(html, "lxml")
        result = _extract_meta_price(soup)
        assert result is not None
        assert result["price"] == 39.99

    def test_priority_order(self):
        html = """<html><head>
            <meta property="og:price" content="99.99">
            <meta property="product:price:amount" content="29.99">
        </head><body></body></html>"""
        soup = BeautifulSoup(html, "lxml")
        result = _extract_meta_price(soup)
        assert result is not None
        assert result["price"] == 29.99

    def test_currency_symbol_stripped(self):
        soup = _soup_with_meta("product:price:amount", "$29.99")
        result = _extract_meta_price(soup)
        assert result is not None
        assert result["price"] == 29.99

    def test_zero_rejected(self):
        soup = _soup_with_meta("product:price:amount", "0.00")
        result = _extract_meta_price(soup)
        assert result is None

    def test_no_meta(self):
        soup = BeautifulSoup("<html><body>No meta</body></html>", "lxml")
        result = _extract_meta_price(soup)
        assert result is None

    def test_unrelated_meta_ignored(self):
        html = '<html><head><meta property="og:title" content="My Product"></head><body></body></html>'
        soup = BeautifulSoup(html, "lxml")
        result = _extract_meta_price(soup)
        assert result is None
