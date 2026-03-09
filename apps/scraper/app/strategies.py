import json
import logging
import re

from bs4 import BeautifulSoup, Tag

from .parsing import (
    ExtractionResult,
    _extract_price_from_text,
    _extract_stock_from_text,
    _is_element_disabled,
    _normalize_text,
    _parse_price_match,
)

logger = logging.getLogger(__name__)


# --- CSS selector extraction ---


_INTERACTIVE_TAGS = {"button", "input", "a"}


def _extract_css_selector(soup: BeautifulSoup, css_selector: str) -> ExtractionResult | None:
    """Extract price/stock from a user-provided CSS selector."""
    elements = soup.select(css_selector)
    if not elements:
        return None
    text = " ".join(el.get_text(strip=True) for el in elements)
    price = _extract_price_from_text(text)
    stock_status = _extract_stock_from_text(text)
    if price is None and stock_status is None:
        return None
    # A disabled interactive element shouldn't imply in_stock
    if stock_status == "in_stock":
        for el in elements:
            is_interactive = (
                el.name in _INTERACTIVE_TAGS
                or el.get("role", "").lower() == "button"
            )
            if is_interactive and _is_element_disabled(el):
                stock_status = None
                break
    return ExtractionResult(price=price, stock_status=stock_status, raw=text)


# --- Title window extraction ---


_NOISE_KEYWORDS = re.compile(
    r"\b(shipping|delivery|handling|tax|estimated|free delivery)\b", re.IGNORECASE
)
_OLD_PRICE_PREFIXES = re.compile(
    r"^\s*(was|original|compare\s+at|reg\.?|msrp|list\s+price|regular\s+price)\s*:?\s*",
    re.IGNORECASE,
)


def _extract_title_window(soup: BeautifulSoup) -> ExtractionResult | None:
    """Inspect visible text around the product title."""
    heading = _find_primary_heading(soup)
    lines = [line.strip() for line in soup.stripped_strings if line and line.strip()]
    if not lines:
        return None

    if heading:
        normalized_heading = _normalize_text(heading)
        start_index = next(
            (
                index
                for index, line in enumerate(lines)
                if normalized_heading and (
                    normalized_heading in _normalize_text(line)
                    or _normalize_text(line) in normalized_heading
                )
            ),
            0,
        )
    else:
        start_index = 0

    window_lines = lines[start_index:start_index + 10]

    filtered = []
    for line in window_lines:
        if _NOISE_KEYWORDS.search(line):
            continue
        if _OLD_PRICE_PREFIXES.match(line):
            continue
        filtered.append(line)

    if not filtered:
        return None

    window_text = " | ".join(filtered)
    price = _extract_price_from_text(window_text)
    stock_status = _extract_stock_from_text(window_text)

    if price is None and stock_status is None:
        return None

    return ExtractionResult(price=price, stock_status=stock_status, raw=window_text[:300])


def _find_primary_heading(soup: BeautifulSoup) -> str | None:
    heading = soup.find("h1")
    if heading:
        text = heading.get_text(strip=True)
        if text:
            return text

    og_title = soup.find("meta", attrs={"property": "og:title"})
    if og_title and og_title.get("content"):
        return og_title["content"]

    if soup.title and soup.title.string:
        return soup.title.string.strip()

    return None


# --- Common CSS selectors ---


def _extract_common_selectors(soup: BeautifulSoup) -> ExtractionResult | None:
    """Try common CSS selectors for price and stock."""
    price, price_raw = _extract_price_selectors(soup)
    stock_status, stock_raw = _extract_stock_selectors(soup)
    if price is None and stock_status is None:
        return None
    raw_parts = [r for r in (price_raw, stock_raw) if r]
    return ExtractionResult(
        price=price,
        stock_status=stock_status,
        raw=", ".join(raw_parts) if raw_parts else None,
    )


def _extract_price_selectors(soup: BeautifulSoup) -> tuple[float | None, str | None]:
    """Try common CSS selectors to find prices."""
    selectors = [
        '[data-price]',
        '[itemprop="price"]',
        '#product .price',
        '.product-detail .price',
        'main .price',
        '[data-product-price]',
        '.product__price',
        '.price__current',
        '.price-current',
        '.product-price',
        '.price .money',
        '.price-box .price',
        '.product-info-price .price',
        '#priceblock_ourprice',
        '#priceblock_dealprice',
        '.a-price .a-offscreen',
        '.price',
    ]
    for selector in selectors:
        elements = soup.select(selector)
        for el in elements:
            data_price = el.get("data-price") or el.get("data-product-price")
            if data_price:
                try:
                    val = float(data_price)
                    if val > 0:
                        return val, f"{selector}: data-price={data_price}"
                except ValueError:
                    pass

            content = el.get("content")
            if content:
                try:
                    val = float(content)
                    if val > 0:
                        return val, f"{selector}: content={content}"
                except ValueError:
                    pass

            text = el.get_text(strip=True)
            if text:
                price = _extract_price_from_text(text)
                if price is not None:
                    return price, f"{selector}: {text}"
    return None, None


def _extract_stock_selectors(soup: BeautifulSoup) -> tuple[str | None, str | None]:
    """Try to determine stock status from common selectors."""
    selectors = [
        '[itemprop="availability"]',
        '.availability',
        '.stock-status',
        '#availability',
        '.product-availability',
    ]
    for selector in selectors:
        elements = soup.select(selector)
        for el in elements:
            content = (el.get("content") or el.get("href") or "").lower()
            text = el.get_text(strip=True).lower()
            combined = f"{content} {text}"

            # Check schema.org URL patterns directly
            if "instock" in content:
                return "in_stock", f"{selector}: {content}"
            if "outofstock" in content:
                return "out_of_stock", f"{selector}: {content}"

            stock_status = _extract_stock_from_text(combined)
            if stock_status is not None:
                return stock_status, f"{selector}: {text or content}"

    # Generic add-to-cart button detection (late-pipeline fallback)
    add_to_cart_selectors = [
        "button[name='add-to-cart']",
        "[data-testid='add-to-cart']",
        "#addToCart",
        "#add-to-cart",
        ".add-to-cart",
        "button.add-to-cart-button",
        "form[action*='/cart'] button[type='submit']",
    ]
    for selector in add_to_cart_selectors:
        el = soup.select_one(selector)
        if el is not None:
            if _is_element_disabled(el):
                return "out_of_stock", f"{selector}: disabled"
            return "in_stock", f"{selector}: enabled"

    # Text-based button detection as final fallback
    return _extract_stock_from_buttons(soup)


_ADD_TO_CART_TEXTS = {"add to cart", "add to bag", "add to basket", "buy now", "buy it now"}
_OOS_BUTTON_TEXTS = {"sold out", "notify me", "join waitlist", "coming soon"}


def _extract_stock_from_buttons(soup: BeautifulSoup) -> tuple[str | None, str | None]:
    """Detect stock status from button/link visible text (no CSS class needed)."""
    elements = soup.find_all(["button", "input", "a"], limit=50)

    atc_element = None
    oos_element = None

    for el in elements:
        if el.name == "input":
            text = (el.get("value") or "").strip()
        else:
            text = el.get_text(strip=True)

        if not text or len(text) > 80:
            continue

        normalized = text.lower()

        if any(pat in normalized for pat in _ADD_TO_CART_TEXTS):
            atc_element = el
            break  # strongest signal, stop scanning
        if oos_element is None and any(pat in normalized for pat in _OOS_BUTTON_TEXTS):
            oos_element = el

    if atc_element is not None:
        if _is_element_disabled(atc_element):
            return "out_of_stock", f"button text: disabled"
        return "in_stock", f"button text: enabled"

    if oos_element is not None:
        return "out_of_stock", f"button text: oos"

    return None, None


# --- Element fingerprint extraction ---


_STABLE_ATTRS = [
    "data-testid", "data-test-id", "data-qa", "data-cy",
    "data-product-id", "data-price", "data-sku",
    "itemprop", "role", "type", "name", "aria-label",
]

_PRICE_PATTERN = re.compile(r"[\$\€\£¥₹]\s*\d|^\d[\d,]*\.\d{2}$")


def _normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _text_overlaps(stored: str, candidate: str) -> bool:
    """Check if texts overlap meaningfully. For price elements, match on price pattern presence."""
    s = _normalize_ws(stored)
    c = _normalize_ws(candidate)
    if not s or not c:
        return False
    # If stored text looks like a price, just check that candidate also has a price-like pattern
    if _PRICE_PATTERN.search(s):
        return _PRICE_PATTERN.search(c) is not None
    # Otherwise use substring containment
    return s in c or c in s


def _ancestor_tags_score(stored: list[str], candidate_el: Tag) -> int:
    """Score how well the candidate's ancestor chain matches the stored one."""
    ancestors: list[str] = []
    parent = candidate_el.parent
    while parent and parent.name not in ("[document]", "html") and len(ancestors) < 10:
        ancestors.insert(0, parent.name)
        parent = parent.parent
    # Count matching positions from the end (closest ancestors matter most)
    score = 0
    for s, c in zip(reversed(stored), reversed(ancestors)):
        if s == c:
            score += 1
        else:
            break
    return score


def _result_from_element(el: Tag) -> ExtractionResult | None:
    text = el.get_text(strip=True)
    if not text:
        return None
    price = _extract_price_from_text(text)
    stock_status = _extract_stock_from_text(text)
    if price is None and stock_status is None:
        return None
    return ExtractionResult(price=price, stock_status=stock_status, raw=text)


def _extract_fingerprint(soup: BeautifulSoup, fingerprint_json: str) -> ExtractionResult | None:
    """Extract price/stock using an element fingerprint as fallback."""
    try:
        fp = json.loads(fingerprint_json)
    except (json.JSONDecodeError, TypeError):
        return None

    tag_name = fp.get("tagName", "").lower()
    stored_text = fp.get("textContent", "")
    attributes = fp.get("attributes", {})
    ancestor_tags = fp.get("ancestorTags", [])
    nearest_id = fp.get("nearestIdAncestor")
    nearest_heading = fp.get("nearestHeading")

    if not tag_name:
        return None

    # 1. Stable attribute match -- tagName + any stored stable attribute
    for attr in _STABLE_ATTRS:
        val = attributes.get(attr)
        if val:
            candidates = soup.find_all(tag_name, attrs={attr: val})
            if len(candidates) == 1:
                result = _result_from_element(candidates[0])
                if result:
                    logger.info("  [fingerprint] matched via %s=%s", attr, val)
                    return result
            elif candidates:
                # Multiple matches -- try to narrow by text
                for c in candidates:
                    if _text_overlaps(stored_text, c.get_text(strip=True)):
                        result = _result_from_element(c)
                        if result:
                            logger.info("  [fingerprint] matched via %s=%s + text", attr, val)
                            return result

    # 2. ID-anchored text match
    if nearest_id:
        anchor = soup.find(id=nearest_id)
        if anchor:
            descendants = anchor.find_all(tag_name)
            for el in descendants:
                if _text_overlaps(stored_text, el.get_text(strip=True)):
                    result = _result_from_element(el)
                    if result:
                        logger.info("  [fingerprint] matched via id-anchor #%s + text", nearest_id)
                        return result

    # 3. Heading-anchored text match
    if nearest_heading:
        normalized_heading = _normalize_ws(nearest_heading)
        for h_tag in ["h1", "h2", "h3", "h4", "h5", "h6"]:
            for h in soup.find_all(h_tag):
                if normalized_heading in _normalize_ws(h.get_text(strip=True)):
                    # Search siblings and nearby elements
                    parent = h.parent
                    if parent:
                        for el in parent.find_all(tag_name):
                            if _text_overlaps(stored_text, el.get_text(strip=True)):
                                result = _result_from_element(el)
                                if result:
                                    logger.info("  [fingerprint] matched via heading-anchor + text")
                                    return result

    # 4. Global text match -- find all tagName elements with matching text, prefer closest ancestor match
    all_candidates = soup.find_all(tag_name)
    text_matches: list[tuple[int, Tag]] = []
    for el in all_candidates:
        if _text_overlaps(stored_text, el.get_text(strip=True)):
            score = _ancestor_tags_score(ancestor_tags, el) if ancestor_tags else 0
            text_matches.append((score, el))

    if text_matches:
        text_matches.sort(key=lambda x: x[0], reverse=True)
        result = _result_from_element(text_matches[0][1])
        if result:
            logger.info("  [fingerprint] matched via global text (ancestor score=%d)", text_matches[0][0])
            return result

    return None


# --- Meta tag extraction ---


_META_PRICE_PROPERTIES = [
    "product:price:amount",
    "og:price:amount",
    "product:price",
    "og:price",
    "price",
]


def _extract_meta_price(soup: BeautifulSoup) -> ExtractionResult | None:
    """Extract price from meta tags, checked in priority order."""
    for target_prop in _META_PRICE_PROPERTIES:
        for meta in soup.find_all("meta"):
            prop = (meta.get("property", "") or meta.get("name", "")).lower()
            if prop == target_prop:
                content = meta.get("content", "")
                if content:
                    cleaned = re.sub(r"[^\d.,]", "", content)
                    price = _parse_price_match(cleaned)
                    if price is not None and price > 0:
                        return ExtractionResult(price=price, stock_status=None, raw=f"meta[{prop}]={content}")
    return None
