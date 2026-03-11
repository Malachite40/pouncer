"""Tests for stock detection with disabled-element awareness."""

from app.parsing import _extract_stock_from_text, _is_element_disabled
from app.strategies import (
    _extract_css_selector,
    _extract_stock_from_buttons,
    _extract_stock_selectors,
)
from app.hosts import _extract_amazon_data, _extract_bestbuy_data, _extract_costco_data


# --- _is_element_disabled ---


class TestIsElementDisabled:
    def test_disabled_attr(self, make_soup):
        soup = make_soup('<button disabled>Add to Cart</button>')
        assert _is_element_disabled(soup.find("button")) is True

    def test_aria_disabled(self, make_soup):
        soup = make_soup('<button aria-disabled="true">Add to Cart</button>')
        assert _is_element_disabled(soup.find("button")) is True

    def test_disabled_class(self, make_soup):
        soup = make_soup('<button class="btn btn-disabled">Add to Cart</button>')
        assert _is_element_disabled(soup.find("button")) is True

    def test_is_disabled_class(self, make_soup):
        soup = make_soup('<button class="is-disabled">Add to Cart</button>')
        assert _is_element_disabled(soup.find("button")) is True

    def test_none_input(self):
        assert _is_element_disabled(None) is False

    def test_enabled_button(self, make_soup):
        soup = make_soup('<button class="btn-primary">Add to Cart</button>')
        assert _is_element_disabled(soup.find("button")) is False


# --- CSS selector: disabled interactive elements ---


class TestCssSelectorDisabled:
    def test_enabled_button_in_stock(self, make_soup):
        soup = make_soup('<button class="buy">Add to Cart</button>')
        result = _extract_css_selector(soup, "button.buy")
        assert result is not None
        assert result["stock_status"] == "in_stock"

    def test_disabled_button_nullifies_stock(self, make_soup):
        soup = make_soup('<button class="buy" disabled>Add to Cart</button>')
        result = _extract_css_selector(soup, "button.buy")
        assert result is not None
        assert result["stock_status"] == "out_of_stock"

    def test_aria_disabled_button_nullifies_stock(self, make_soup):
        soup = make_soup('<button class="buy" aria-disabled="true">Add to Cart</button>')
        result = _extract_css_selector(soup, "button.buy")
        assert result is not None
        assert result["stock_status"] == "out_of_stock"

    def test_non_interactive_element_unaffected(self, make_soup):
        soup = make_soup('<div class="stock">In Stock</div>')
        result = _extract_css_selector(soup, "div.stock")
        assert result is not None
        assert result["stock_status"] == "in_stock"

    def test_role_button_disabled(self, make_soup):
        soup = make_soup('<div role="button" class="buy" disabled>Add to Cart</div>')
        result = _extract_css_selector(soup, 'div.buy')
        assert result is not None
        assert result["stock_status"] == "out_of_stock"

    def test_disabled_non_purchase_button_stays_neutral(self, make_soup):
        soup = make_soup('<button class="buy" disabled>Choose Size</button>')
        result = _extract_css_selector(soup, "button.buy")
        assert result is None


# --- Amazon ---


class TestAmazonDisabled:
    def test_enabled_add_to_cart(self, make_soup):
        html = '<div id="availability"><span>In Stock</span></div>'
        soup = make_soup(html)
        result = _extract_amazon_data(soup)
        assert result is not None
        assert result["stock_status"] == "in_stock"

    def test_add_to_cart_button_enabled(self, make_soup):
        html = '<input id="add-to-cart-button" type="submit" value="Add to Cart">'
        soup = make_soup(html)
        result = _extract_amazon_data(soup)
        assert result is not None
        assert result["stock_status"] == "in_stock"

    def test_add_to_cart_button_disabled(self, make_soup):
        html = '<input id="add-to-cart-button" type="submit" value="Add to Cart" disabled>'
        soup = make_soup(html)
        result = _extract_amazon_data(soup)
        assert result is not None
        assert result["stock_status"] == "out_of_stock"


# --- Best Buy ---


class TestBestBuyDisabled:
    def test_enabled_add_to_cart(self, make_soup):
        html = '<button class="fulfillment-add-to-cart-button">Add to Cart</button>'
        soup = make_soup(html)
        result = _extract_bestbuy_data(soup)
        assert result is not None
        assert result["stock_status"] == "in_stock"

    def test_disabled_add_to_cart(self, make_soup):
        html = '<button class="fulfillment-add-to-cart-button" disabled>Add to Cart</button>'
        soup = make_soup(html)
        result = _extract_bestbuy_data(soup)
        assert result is not None
        assert result["stock_status"] == "out_of_stock"


# --- Costco ---


class TestCostcoDisabled:
    def test_price_alone_no_stock(self, make_soup):
        html = '<span class="value" id="pull-right-price"><span class="value">$29.99</span></span>'
        soup = make_soup(html)
        result = _extract_costco_data(soup)
        assert result is not None
        assert result["stock_status"] is None

    def test_out_of_stock_text(self, make_soup):
        html = '<div>Out of Stock</div><span class="value" id="pull-right-price"><span class="value">$29.99</span></span>'
        soup = make_soup(html)
        result = _extract_costco_data(soup)
        assert result is not None
        assert result["stock_status"] == "out_of_stock"

    def test_enabled_add_to_cart(self, make_soup):
        html = '<button id="add-to-cart-btn">Add to Cart</button>'
        soup = make_soup(html)
        result = _extract_costco_data(soup)
        assert result is not None
        assert result["stock_status"] == "in_stock"

    def test_disabled_add_to_cart(self, make_soup):
        html = '<button id="add-to-cart-btn" disabled>Add to Cart</button>'
        soup = make_soup(html)
        result = _extract_costco_data(soup)
        assert result is not None
        assert result["stock_status"] == "out_of_stock"


# --- Generic add-to-cart selectors ---


class TestGenericAddToCartSelectors:
    def test_add_to_cart_enabled(self, make_soup):
        soup = make_soup('<button id="addToCart">Add to Cart</button>')
        status, raw = _extract_stock_selectors(soup)
        assert status == "in_stock"

    def test_add_to_cart_disabled(self, make_soup):
        soup = make_soup('<button id="addToCart" disabled>Add to Cart</button>')
        status, raw = _extract_stock_selectors(soup)
        assert status == "out_of_stock"

    def test_add_to_cart_aria_disabled(self, make_soup):
        soup = make_soup('<button id="addToCart" aria-disabled="true">Add to Cart</button>')
        status, raw = _extract_stock_selectors(soup)
        assert status == "out_of_stock"

    def test_no_button_returns_none(self, make_soup):
        soup = make_soup('<div>Some content</div>')
        status, raw = _extract_stock_selectors(soup)
        assert status is None


# --- _extract_stock_from_text ---


class TestExtractStockFromText:
    def test_add_to_cart_in_stock(self):
        assert _extract_stock_from_text("Add to Cart") == "in_stock"

    def test_add_to_bag_in_stock(self):
        assert _extract_stock_from_text("Add to Bag") == "in_stock"

    def test_add_to_basket_in_stock(self):
        assert _extract_stock_from_text("Add to Basket") == "in_stock"

    def test_buy_now_in_stock(self):
        assert _extract_stock_from_text("Buy Now") == "in_stock"

    def test_buy_it_now_in_stock(self):
        assert _extract_stock_from_text("Buy It Now") == "in_stock"

    def test_out_of_stock(self):
        assert _extract_stock_from_text("Out of Stock") == "out_of_stock"

    def test_sold_out(self):
        assert _extract_stock_from_text("Sold Out") == "out_of_stock"

    def test_currently_unavailable(self):
        assert _extract_stock_from_text("Currently Unavailable") == "out_of_stock"

    def test_temporarily_unavailable(self):
        assert _extract_stock_from_text("Temporarily unavailable") == "out_of_stock"

    def test_this_item_is_unavailable(self):
        assert _extract_stock_from_text("This item is unavailable") == "out_of_stock"

    def test_no_longer_available(self):
        assert _extract_stock_from_text("No longer available") == "out_of_stock"

    def test_discontinued(self):
        assert _extract_stock_from_text("This product has been discontinued") == "out_of_stock"

    def test_bare_unavailable_no_match(self):
        """Bare 'unavailable' should NOT trigger out_of_stock."""
        assert _extract_stock_from_text("Curbside unavailable") is None

    def test_bare_not_available_no_match(self):
        """Bare 'not available' should NOT trigger out_of_stock."""
        assert _extract_stock_from_text("Size 10 not available") is None

    def test_add_to_cart_wins_over_incidental_unavailable(self):
        """In-stock signal should beat incidental 'unavailable' text."""
        text = "Size 10 unavailable | Add to Cart"
        assert _extract_stock_from_text(text) == "in_stock"

    def test_notify_me_out_of_stock(self):
        assert _extract_stock_from_text("Notify Me When Available") == "out_of_stock"

    def test_explicit_out_of_stock_beats_add_to_cart(self):
        text = "Add to Cart | This item is unavailable"
        assert _extract_stock_from_text(text) == "out_of_stock"

    def test_join_waitlist_out_of_stock(self):
        assert _extract_stock_from_text("Join Waitlist") == "out_of_stock"

    def test_coming_soon_out_of_stock(self):
        assert _extract_stock_from_text("Coming Soon") == "out_of_stock"

    def test_preorder_out_of_stock(self):
        assert _extract_stock_from_text("Pre-order now") == "out_of_stock"

    def test_soft_oos_loses_to_in_stock(self):
        """Soft OOS patterns should not match when in-stock signal present."""
        text = "Add to Cart | Notify me for other sizes"
        assert _extract_stock_from_text(text) == "in_stock"


# --- _extract_stock_from_buttons (text-based) ---


class TestTextBasedButtonDetection:
    def test_button_add_to_cart_enabled(self, make_soup):
        soup = make_soup('<button class="btn-primary">Add to Cart</button>')
        status, _ = _extract_stock_from_buttons(soup)
        assert status == "in_stock"

    def test_button_add_to_cart_disabled(self, make_soup):
        soup = make_soup('<button class="btn-primary" disabled>Add to Cart</button>')
        status, _ = _extract_stock_from_buttons(soup)
        assert status == "out_of_stock"

    def test_anchor_buy_now(self, make_soup):
        soup = make_soup('<a href="/checkout" class="cta">Buy Now</a>')
        status, _ = _extract_stock_from_buttons(soup)
        assert status == "in_stock"

    def test_input_submit_add_to_cart(self, make_soup):
        soup = make_soup('<input type="submit" value="Add to Cart">')
        status, _ = _extract_stock_from_buttons(soup)
        assert status == "in_stock"

    def test_input_submit_disabled(self, make_soup):
        soup = make_soup('<input type="submit" value="Add to Cart" disabled>')
        status, _ = _extract_stock_from_buttons(soup)
        assert status == "out_of_stock"

    def test_notify_me_button_oos(self, make_soup):
        soup = make_soup('<button class="btn-secondary">Notify Me</button>')
        status, _ = _extract_stock_from_buttons(soup)
        assert status == "out_of_stock"

    def test_add_to_cart_overrides_notify_me(self, make_soup):
        soup = make_soup(
            '<button class="btn-primary">Add to Cart</button>'
            '<button class="btn-secondary">Notify Me</button>'
        )
        status, _ = _extract_stock_from_buttons(soup)
        assert status == "in_stock"

    def test_long_text_skipped(self, make_soup):
        long_text = "x" * 81
        soup = make_soup(f'<a href="/">{long_text}</a>')
        status, _ = _extract_stock_from_buttons(soup)
        assert status is None

    def test_no_buttons_returns_none(self, make_soup):
        soup = make_soup('<div>Just text</div>')
        status, _ = _extract_stock_from_buttons(soup)
        assert status is None

    def test_add_to_bag_button(self, make_soup):
        soup = make_soup('<button>Add to Bag</button>')
        status, _ = _extract_stock_from_buttons(soup)
        assert status == "in_stock"


# --- Integration: full HTML ---


class TestStockDetectionIntegration:
    def test_add_to_cart_button_with_incidental_unavailable(self, make_soup):
        """A page with 'Add to Cart' button and incidental 'unavailable' text should be in_stock."""
        html = """
        <html><body>
            <h1>Cool Product</h1>
            <p>Size 10 unavailable</p>
            <span class="price">$49.99</span>
            <button class="btn-primary">Add to Cart</button>
        </body></html>
        """
        soup = make_soup(html)
        status, _ = _extract_stock_selectors(soup)
        assert status == "in_stock"

    def test_sold_out_button_oos(self, make_soup):
        html = """
        <html><body>
            <h1>Cool Product</h1>
            <button class="btn-primary" disabled>Sold Out</button>
        </body></html>
        """
        soup = make_soup(html)
        status, _ = _extract_stock_selectors(soup)
        assert status == "out_of_stock"
