import json
import logging
import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .parsing import ExtractionResult, _extract_price_from_text, _is_element_disabled, _parse_price_match

logger = logging.getLogger(__name__)


def _price_from_selectors(soup: BeautifulSoup, selectors: list[str]) -> tuple[float | None, str | None]:
    """Iterate CSS selectors, return the first price found."""
    for selector in selectors:
        for el in soup.select(selector):
            content = el.get("content")
            if content:
                try:
                    val = float(content)
                    if val > 0:
                        return val, f"price={val} ({selector} content)"
                except ValueError:
                    pass
            text = el.get_text(strip=True)
            extracted = _extract_price_from_text(text)
            if extracted is not None:
                return extracted, f"price={extracted} ({selector})"
    return None, None


def _extract_host_specific(url: str, soup: BeautifulSoup) -> ExtractionResult | None:
    hostname = (urlparse(url).hostname or "").lower()
    if "target." in hostname:
        return _extract_target_data(soup)
    if "amazon." in hostname:
        return _extract_amazon_data(soup)
    if "walmart." in hostname:
        return _extract_walmart_data(soup)
    if "bestbuy." in hostname:
        return _extract_bestbuy_data(soup)
    if "costco." in hostname:
        return _extract_costco_data(soup)
    return None


def _extract_target_data(soup: BeautifulSoup) -> ExtractionResult | None:
    """Extract price and stock from Target hydration/config scripts."""
    price = None
    stock_status = None
    raw_parts: list[str] = []

    price_patterns = [
        r'"formatted_current_price"\s*:\s*"([^"]+)"',
        r'"current_retail"\s*:\s*"?(?P<price>\d+(?:\.\d{1,2})?)"?',
        r'"retail"\s*:\s*"?(?P<price>\d+(?:\.\d{1,2})?)"?',
    ]
    stock_patterns = [
        (r'"availability_status"\s*:\s*"OUT_OF_STOCK"', "out_of_stock", "availability_status=OUT_OF_STOCK"),
        (r'"availability_status"\s*:\s*"IN_STOCK"', "in_stock", "availability_status=IN_STOCK"),
        (r'"is_out_of_stock"\s*:\s*true', "out_of_stock", "is_out_of_stock=true"),
        (r'"is_out_of_stock"\s*:\s*false', "in_stock", "is_out_of_stock=false"),
        (r'"available_to_promise_network"\s*:\s*"NOT_AVAILABLE"', "out_of_stock", "available_to_promise_network=NOT_AVAILABLE"),
        (r'"available_to_promise_network"\s*:\s*"AVAILABLE"', "in_stock", "available_to_promise_network=AVAILABLE"),
    ]

    for script in soup.find_all("script"):
        content = script.string or script.get_text() or ""
        if not content:
            continue
        if not any(
            marker in content
            for marker in (
                "current_retail",
                "formatted_current_price",
                "availability_status",
                "available_to_promise_network",
                "is_out_of_stock",
            )
        ):
            continue

        if price is None:
            for pattern in price_patterns:
                match = re.search(pattern, content)
                if not match:
                    continue

                if "formatted_current_price" in pattern:
                    extracted_price = _extract_price_from_text(match.group(1))
                else:
                    extracted_price = float(match.group("price"))

                if extracted_price is not None:
                    price = extracted_price
                    raw_parts.append(f"price={price}")
                    break

        if stock_status is None:
            for pattern, mapped_value, raw in stock_patterns:
                if re.search(pattern, content):
                    stock_status = mapped_value
                    raw_parts.append(raw)
                    break

        if price is not None and stock_status is not None:
            break

    if price is None and stock_status is None:
        return None

    return ExtractionResult(price=price, stock_status=stock_status, raw=", ".join(raw_parts))


def _extract_amazon_data(soup: BeautifulSoup) -> ExtractionResult | None:
    """Extract price and stock from Amazon product pages."""
    raw_parts: list[str] = []

    price_selectors = [
        "#corePriceDisplay_desktop_feature_div .aok-offscreen",
        ".a-price .a-offscreen",
        "#priceblock_ourprice",
        "#priceblock_dealprice",
        'span.a-price[data-a-color="price"] .a-offscreen',
        "#price_inside_buybox",
        "#newBuyBoxPrice",
    ]
    price, price_raw = _price_from_selectors(soup, price_selectors)
    if price_raw:
        raw_parts.append(price_raw)

    stock_status = None
    availability_el = soup.select_one("#availability")
    if availability_el:
        text = availability_el.get_text(strip=True).lower()
        if "in stock" in text:
            stock_status = "in_stock"
            raw_parts.append("availability=in_stock")
        elif "unavailable" in text or "out of stock" in text:
            stock_status = "out_of_stock"
            raw_parts.append("availability=out_of_stock")

    if stock_status is None:
        add_to_cart = soup.select_one("#add-to-cart-button")
        if add_to_cart and not _is_element_disabled(add_to_cart):
            stock_status = "in_stock"
            raw_parts.append("add-to-cart=present")

    if price is None and stock_status is None:
        return None

    return ExtractionResult(price=price, stock_status=stock_status, raw=", ".join(raw_parts))


def _extract_walmart_data(soup: BeautifulSoup) -> ExtractionResult | None:
    """Extract price and stock from Walmart product pages."""
    raw_parts: list[str] = []

    price_selectors = [
        '[data-testid="price-wrap"] [itemprop="price"]',
        'span[itemprop="price"]',
        '[data-testid="price-wrap"]',
    ]
    price, price_raw = _price_from_selectors(soup, price_selectors)
    if price_raw:
        raw_parts.append(price_raw)

    # Try __NEXT_DATA__ JSON
    if price is None:
        for script in soup.find_all("script", id="__NEXT_DATA__"):
            try:
                data = json.loads(script.string or "")
                props = data.get("props", {}).get("pageProps", {})
                item = props.get("initialData", {}).get("data", {}).get("product", {})
                price_info = item.get("priceInfo", {}).get("currentPrice", {})
                p = price_info.get("price")
                if p is not None:
                    price = float(p)
                    raw_parts.append(f"price={price} (__NEXT_DATA__)")
            except (json.JSONDecodeError, TypeError, ValueError, AttributeError):
                pass

    stock_status = None
    fulfillment = soup.select_one('[data-testid="fulfillment-badge"]')
    if fulfillment:
        text = fulfillment.get_text(strip=True).lower()
        if "out of stock" in text or "unavailable" in text:
            stock_status = "out_of_stock"
            raw_parts.append("fulfillment=out_of_stock")
        else:
            stock_status = "in_stock"
            raw_parts.append("fulfillment=in_stock")

    if price is None and stock_status is None:
        return None

    return ExtractionResult(price=price, stock_status=stock_status, raw=", ".join(raw_parts))


def _extract_bestbuy_data(soup: BeautifulSoup) -> ExtractionResult | None:
    """Extract price and stock from Best Buy product pages."""
    raw_parts: list[str] = []

    price_selectors = [
        ".priceView-hero-price .priceView-customer-price span:first-child",
        "[data-testid='customer-price'] span",
        ".priceView-hero-price span",
    ]
    price, price_raw = _price_from_selectors(soup, price_selectors)
    if price_raw:
        raw_parts.append(price_raw)

    stock_status = None
    sold_out = soup.select_one("[data-button-state='SOLD_OUT']")
    if sold_out:
        stock_status = "out_of_stock"
        raw_parts.append("button=SOLD_OUT")
    else:
        add_to_cart = soup.select_one(".fulfillment-add-to-cart-button")
        if add_to_cart and not _is_element_disabled(add_to_cart):
            stock_status = "in_stock"
            raw_parts.append("add-to-cart=present")

    if price is None and stock_status is None:
        return None

    return ExtractionResult(price=price, stock_status=stock_status, raw=", ".join(raw_parts))


def _extract_costco_data(soup: BeautifulSoup) -> ExtractionResult | None:
    """Extract price and stock from Costco product pages."""
    raw_parts: list[str] = []

    price_selectors = [
        "#pull-right-price span.value",
        ".your-price .value",
        "[automation-id='productPrice']",
    ]
    price, price_raw = _price_from_selectors(soup, price_selectors)
    if price_raw:
        raw_parts.append(price_raw)

    stock_status = None
    page_text = soup.get_text(strip=True).lower()
    if "out of stock" in page_text:
        stock_status = "out_of_stock"
        raw_parts.append("text=out_of_stock")
    else:
        add_to_cart = soup.select_one("#add-to-cart-btn, #addToCartButton, .add-to-cart-btn")
        if add_to_cart and not _is_element_disabled(add_to_cart):
            stock_status = "in_stock"
            raw_parts.append("add-to-cart=present")

    if price is None and stock_status is None:
        return None

    return ExtractionResult(price=price, stock_status=stock_status, raw=", ".join(raw_parts))
