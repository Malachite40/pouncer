import logging
import re
from typing import TypedDict

logger = logging.getLogger(__name__)

_PURCHASE_CTA_PATTERNS = (
    "add to cart",
    "add to bag",
    "add to basket",
    "buy now",
    "buy it now",
)


# --- Typed data containers ---


class ExtractionResult(TypedDict):
    price: float | None
    stock_status: str | None
    raw: str | None


class ScrapeResult(TypedDict):
    price: float | None
    stock_status: str | None
    raw_content: str | None
    error: str | None


def _error_result(error: str) -> ScrapeResult:
    return ScrapeResult(price=None, stock_status=None, raw_content=None, error=error)


# --- Price extraction helpers ---


def _parse_price_match(raw: str) -> float | None:
    """Parse a raw price string like '1,299.99' or '29,99' (European) into a float."""
    raw = raw.strip()
    if not raw:
        return None

    # Strip currency symbols and whitespace
    raw = re.sub(r"[^\d.,]", "", raw)
    if not raw:
        return None

    # European format: 1.234,56 or 1.234 (dots as thousands, comma as decimal)
    if re.match(r"^\d{1,3}(\.\d{3})+(,\d{1,2})?$", raw):
        raw = raw.replace(".", "").replace(",", ".")
    # US format with thousands: 1,234.56
    elif re.match(r"^\d{1,3}(,\d{3})+(\.\d{1,2})?$", raw):
        raw = raw.replace(",", "")
    # Ambiguous comma — European decimal (29,99) vs thousands-only (1,234)
    elif "," in raw and "." not in raw:
        parts = raw.split(",")
        if len(parts) == 2 and len(parts[1]) <= 2:
            raw = raw.replace(",", ".")
        else:
            raw = raw.replace(",", "")

    try:
        val = float(raw)
        return val if val > 0 else None
    except ValueError:
        return None


def _extract_price_from_text(text: str) -> float | None:
    """Extract a numeric price from text like '$29.99' or '29,99 EUR'.

    Handles sale-price patterns ('Was $39.99 Now $19.99') by preferring
    sale keywords. For multiple prices, returns the minimum positive price.
    """
    # Check for sale-price keywords first
    sale_keywords = [
        r"(?:now|sale\s*price|current\s*price|your\s*price)\s*:?\s*",
    ]
    for kw_pattern in sale_keywords:
        pattern = kw_pattern + r"([\$\£\€]?\s*\d[\d.,]*)"
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            price = _parse_price_match(match.group(1))
            if price is not None:
                return price

    # General price patterns
    price_patterns = [
        r"[\$\£\€]\s*(\d[\d.,]*)",        # $29.99, EUR 1.234,56
        r"(\d[\d.,]*)\s*[\$\£\€]",        # 29.99$
        r"(\d[\d.,]*)\s*(?:EUR|USD|GBP)",  # 29.99 EUR
    ]

    prices: list[float] = []
    for pattern in price_patterns:
        for match in re.finditer(pattern, text):
            price = _parse_price_match(match.group(1))
            if price is not None:
                prices.append(price)

    if not prices:
        return None

    return min(prices)


def _extract_stock_from_text(text: str) -> str | None:
    """Normalize common stock phrases from free text."""
    normalized = re.sub(r"\s+", " ", text).strip().lower()
    if not normalized:
        return None

    in_stock_patterns = [
        "in stock",
        "available for pickup",
        "available for shipping",
        "ready for pickup",
        "ship it",
        "add to cart",
        "add to bag",
        "add to basket",
        "buy now",
        "buy it now",
    ]
    out_of_stock_patterns = [
        "out of stock",
        "sold out",
        "currently unavailable",
        "temporarily unavailable",
        "this item is unavailable",
        "this product is unavailable",
        "not currently available",
        "no longer available",
        "discontinued",
    ]
    soft_out_of_stock_patterns = [
        "notify me",
        "notify when available",
        "join waitlist",
        "waitlist",
        "backorder",
        "coming soon",
        "pre-order",
        "preorder",
        "email me when available",
    ]

    for pattern in out_of_stock_patterns:
        if pattern in normalized:
            return "out_of_stock"

    # Explicit out-of-stock copy should beat generic purchase CTAs when both appear.
    for pattern in in_stock_patterns:
        if pattern in normalized:
            return "in_stock"

    # Soft OOS patterns only match when no in-stock signal is present
    for pattern in soft_out_of_stock_patterns:
        if pattern in normalized:
            return "out_of_stock"

    return None


def _is_purchase_cta_text(text: str) -> bool:
    """Return True when text matches a purchase CTA used as an in-stock signal."""
    normalized = re.sub(r"\s+", " ", text).strip().lower()
    if not normalized:
        return False
    return any(pattern in normalized for pattern in _PURCHASE_CTA_PATTERNS)


# --- Price validation ---


def _validate_price(price: float | None) -> float | None:
    """Reject obviously invalid prices."""
    if price is None:
        return None
    if price <= 0:
        logger.warning("Rejected non-positive price: %s", price)
        return None
    if price > 100_000:
        logger.warning("Rejected implausibly high price: %s", price)
        return None
    return price


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def _is_element_disabled(element) -> bool:
    """Check if a BeautifulSoup element appears disabled."""
    if element is None:
        return False
    if element.has_attr("disabled"):
        return True
    if element.get("aria-disabled", "").lower() == "true":
        return True
    classes = " ".join(element.get("class", []))
    if "disabled" in classes.lower():
        return True
    return False
