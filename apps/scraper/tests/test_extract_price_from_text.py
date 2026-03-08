import pytest

from app.parsing import _extract_price_from_text, _parse_price_match


class TestParsePriceMatch:
    def test_simple_us(self):
        assert _parse_price_match("29.99") == 29.99

    def test_us_with_thousands(self):
        assert _parse_price_match("1,299.99") == 1299.99

    def test_european_decimal(self):
        assert _parse_price_match("29,99") == 29.99

    def test_european_with_thousands(self):
        assert _parse_price_match("1.299,99") == 1299.99

    def test_european_thousands_no_decimal(self):
        assert _parse_price_match("1.299") == 1299.0

    def test_zero_rejected(self):
        assert _parse_price_match("0.00") is None
        assert _parse_price_match("0") is None

    def test_empty(self):
        assert _parse_price_match("") is None

    def test_currency_symbols_stripped(self):
        assert _parse_price_match("$29.99") == 29.99
        assert _parse_price_match("€1.299,99") == 1299.99

    def test_whitespace(self):
        assert _parse_price_match("  29.99  ") == 29.99


class TestExtractPriceFromText:
    def test_dollar_sign(self):
        assert _extract_price_from_text("$29.99") == 29.99

    def test_euro_sign(self):
        assert _extract_price_from_text("€19.99") == 19.99

    def test_pound_sign(self):
        assert _extract_price_from_text("£49.99") == 49.99

    def test_trailing_currency(self):
        assert _extract_price_from_text("29.99$") == 29.99

    def test_eur_suffix(self):
        assert _extract_price_from_text("29,99 EUR") == 29.99

    def test_usd_suffix(self):
        assert _extract_price_from_text("29.99 USD") == 29.99

    def test_was_now_picks_lower(self):
        assert _extract_price_from_text("Was $39.99 Now $19.99") == 19.99

    def test_sale_keyword_priority(self):
        assert _extract_price_from_text("Regular $39.99 Sale Price $19.99") == 19.99

    def test_now_keyword(self):
        assert _extract_price_from_text("Was $50.00 Now: $25.00") == 25.00

    def test_your_price(self):
        assert _extract_price_from_text("List $99.99 Your Price $79.99") == 79.99

    def test_multiple_prices_returns_min(self):
        assert _extract_price_from_text("$39.99 $29.99 $49.99") == 29.99

    def test_thousands_separator(self):
        assert _extract_price_from_text("$1,299.99") == 1299.99

    def test_european_price(self):
        assert _extract_price_from_text("29,99€") == 29.99

    def test_no_price(self):
        assert _extract_price_from_text("no price here") is None

    def test_empty(self):
        assert _extract_price_from_text("") is None

    def test_space_after_symbol(self):
        assert _extract_price_from_text("$ 29.99") == 29.99
