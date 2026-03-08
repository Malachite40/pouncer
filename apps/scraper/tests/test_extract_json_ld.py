import json

import pytest

from app.json_ld import _extract_json_ld


def _make_soup_with_json_ld(data):
    """Create a BeautifulSoup with a JSON-LD script tag."""
    from bs4 import BeautifulSoup
    html = f'<html><head><script type="application/ld+json">{json.dumps(data)}</script></head><body></body></html>'
    return BeautifulSoup(html, "lxml")


class TestJsonLdSimpleProduct:
    def test_basic_product(self):
        soup = _make_soup_with_json_ld({
            "@type": "Product",
            "offers": {
                "@type": "Offer",
                "price": 29.99,
                "availability": "https://schema.org/InStock",
            },
        })
        result = _extract_json_ld(soup)
        assert result is not None
        assert result["price"] == 29.99
        assert result["stock_status"] == "in_stock"

    def test_price_as_string(self):
        soup = _make_soup_with_json_ld({
            "@type": "Product",
            "offers": {"price": "$29.99", "availability": "InStock"},
        })
        result = _extract_json_ld(soup)
        assert result is not None
        assert result["price"] == 29.99

    def test_out_of_stock(self):
        soup = _make_soup_with_json_ld({
            "@type": "Product",
            "offers": {"price": 10.00, "availability": "https://schema.org/OutOfStock"},
        })
        result = _extract_json_ld(soup)
        assert result["stock_status"] == "out_of_stock"


class TestJsonLdGraph:
    def test_product_in_graph(self):
        soup = _make_soup_with_json_ld({
            "@context": "https://schema.org",
            "@graph": [
                {"@type": "WebPage", "name": "Test"},
                {
                    "@type": "Product",
                    "offers": {"price": 49.99, "availability": "InStock"},
                },
            ],
        })
        result = _extract_json_ld(soup)
        assert result is not None
        assert result["price"] == 49.99

    def test_nested_main_entity(self):
        soup = _make_soup_with_json_ld({
            "@type": "WebPage",
            "mainEntity": {
                "@type": "Product",
                "offers": {"price": 15.00},
            },
        })
        result = _extract_json_ld(soup)
        assert result is not None
        assert result["price"] == 15.00


class TestJsonLdTypeArray:
    def test_type_as_array(self):
        soup = _make_soup_with_json_ld({
            "@type": ["Product", "IndividualProduct"],
            "offers": {"price": 19.99},
        })
        result = _extract_json_ld(soup)
        assert result is not None
        assert result["price"] == 19.99


class TestJsonLdAggregateOffer:
    def test_aggregate_low_price(self):
        soup = _make_soup_with_json_ld({
            "@type": "Product",
            "offers": {
                "@type": "AggregateOffer",
                "lowPrice": 9.99,
                "highPrice": 29.99,
                "availability": "InStock",
            },
        })
        result = _extract_json_ld(soup)
        assert result is not None
        assert result["price"] == 9.99

    def test_aggregate_with_nested_offers(self):
        soup = _make_soup_with_json_ld({
            "@type": "Product",
            "offers": {
                "@type": "AggregateOffer",
                "offers": [
                    {"price": 29.99, "availability": "OutOfStock"},
                    {"price": 19.99, "availability": "InStock"},
                    {"price": 39.99, "availability": "InStock"},
                ],
            },
        })
        result = _extract_json_ld(soup)
        assert result is not None
        assert result["price"] == 19.99
        assert result["stock_status"] == "in_stock"


class TestJsonLdOfferArray:
    def test_multiple_offers_picks_lowest_in_stock(self):
        soup = _make_soup_with_json_ld({
            "@type": "Product",
            "offers": [
                {"price": 50.00, "availability": "InStock"},
                {"price": 30.00, "availability": "InStock"},
                {"price": 20.00, "availability": "OutOfStock"},
            ],
        })
        result = _extract_json_ld(soup)
        assert result is not None
        assert result["price"] == 30.00
        assert result["stock_status"] == "in_stock"

    def test_all_out_of_stock_picks_lowest(self):
        soup = _make_soup_with_json_ld({
            "@type": "Product",
            "offers": [
                {"price": 50.00, "availability": "OutOfStock"},
                {"price": 30.00, "availability": "OutOfStock"},
            ],
        })
        result = _extract_json_ld(soup)
        assert result is not None
        assert result["price"] == 30.00


class TestJsonLdAvailability:
    def test_http_schema(self):
        soup = _make_soup_with_json_ld({
            "@type": "Product",
            "offers": {"price": 10, "availability": "http://schema.org/InStock"},
        })
        result = _extract_json_ld(soup)
        assert result["stock_status"] == "in_stock"

    def test_https_schema(self):
        soup = _make_soup_with_json_ld({
            "@type": "Product",
            "offers": {"price": 10, "availability": "https://schema.org/OutOfStock"},
        })
        result = _extract_json_ld(soup)
        assert result["stock_status"] == "out_of_stock"

    def test_bare_value(self):
        soup = _make_soup_with_json_ld({
            "@type": "Product",
            "offers": {"price": 10, "availability": "InStock"},
        })
        result = _extract_json_ld(soup)
        assert result["stock_status"] == "in_stock"

    def test_preorder(self):
        soup = _make_soup_with_json_ld({
            "@type": "Product",
            "offers": {"price": 10, "availability": "PreOrder"},
        })
        result = _extract_json_ld(soup)
        assert result["stock_status"] == "in_stock"

    def test_discontinued(self):
        soup = _make_soup_with_json_ld({
            "@type": "Product",
            "offers": {"price": 10, "availability": "Discontinued"},
        })
        result = _extract_json_ld(soup)
        assert result["stock_status"] == "out_of_stock"


class TestJsonLdNone:
    def test_no_json_ld(self):
        from bs4 import BeautifulSoup
        soup = BeautifulSoup("<html><body>No data</body></html>", "lxml")
        assert _extract_json_ld(soup) is None

    def test_invalid_json(self):
        from bs4 import BeautifulSoup
        html = '<html><head><script type="application/ld+json">not json</script></head></html>'
        soup = BeautifulSoup(html, "lxml")
        assert _extract_json_ld(soup) is None

    def test_non_product_type(self):
        soup = _make_soup_with_json_ld({"@type": "Organization", "name": "Foo"})
        assert _extract_json_ld(soup) is None
