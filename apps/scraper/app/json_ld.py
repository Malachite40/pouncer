import json
import logging
import re

from bs4 import BeautifulSoup

from .parsing import ExtractionResult, _parse_price_match

logger = logging.getLogger(__name__)


def _extract_json_ld(soup: BeautifulSoup) -> ExtractionResult | None:
    """Extract price and availability from JSON-LD Product schema."""
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue

        products = _find_json_ld_products(data)
        for product in products:
            result = _extract_from_product_json_ld(product)
            if result is not None:
                return result

    return None


def _find_json_ld_products(data) -> list[dict]:
    """Recursively find all Product objects in JSON-LD data."""
    products = []
    if isinstance(data, list):
        for item in data:
            products.extend(_find_json_ld_products(item))
        return products

    if not isinstance(data, dict):
        return products

    type_val = data.get("@type", "")
    types = type_val if isinstance(type_val, list) else [type_val]
    if "Product" in types:
        products.append(data)

    graph = data.get("@graph")
    if isinstance(graph, list):
        for item in graph:
            products.extend(_find_json_ld_products(item))

    for key in ("mainEntity", "mainEntityOfPage"):
        nested = data.get(key)
        if isinstance(nested, dict):
            products.extend(_find_json_ld_products(nested))

    return products


def _extract_from_product_json_ld(product: dict) -> ExtractionResult | None:
    """Extract price/stock from a single JSON-LD Product object."""
    offers_raw = product.get("offers", {})

    if isinstance(offers_raw, dict):
        offer_type = offers_raw.get("@type", "")
        offer_types = offer_type if isinstance(offer_type, list) else [offer_type]
        if "AggregateOffer" in offer_types:
            return _extract_aggregate_offer(offers_raw)
        offers = [offers_raw]
    elif isinstance(offers_raw, list):
        offers = offers_raw
    else:
        return None

    return _pick_best_offer(offers)


def _extract_aggregate_offer(agg: dict) -> ExtractionResult | None:
    """Extract from AggregateOffer — prefer lowPrice, fall back to nested offers."""
    raw_parts = []
    price = None
    stock_status = None

    for key in ("lowPrice", "price"):
        val = agg.get(key)
        if val is not None:
            price = _parse_json_ld_price(val)
            if price is not None:
                raw_parts.append(f"{key}={price}")
                break

    stock_status = _parse_json_ld_availability(agg.get("availability", ""))
    if stock_status:
        raw_parts.append(f"availability={stock_status}")

    if price is not None or stock_status is not None:
        return ExtractionResult(price=price, stock_status=stock_status, raw=", ".join(raw_parts))

    nested = agg.get("offers")
    if isinstance(nested, list):
        return _pick_best_offer(nested)

    return None


def _pick_best_offer(offers: list[dict]) -> ExtractionResult | None:
    """Pick the best offer: prefer lowest in-stock, fall back to lowest overall."""
    in_stock_prices = []
    all_prices = []

    for offer in offers:
        price = _parse_json_ld_price(offer.get("price"))
        if price is None:
            price = _parse_json_ld_price(offer.get("lowPrice"))
        availability = _parse_json_ld_availability(offer.get("availability", ""))

        if price is not None:
            all_prices.append((price, availability, offer))
            if availability == "in_stock":
                in_stock_prices.append((price, availability, offer))

    chosen = None
    if in_stock_prices:
        chosen = min(in_stock_prices, key=lambda x: x[0])
    elif all_prices:
        chosen = min(all_prices, key=lambda x: x[0])

    if chosen is None:
        if offers:
            avail = _parse_json_ld_availability(offers[0].get("availability", ""))
            if avail:
                return ExtractionResult(price=None, stock_status=avail, raw=f"availability={avail}")
        return None

    price, stock_status, _ = chosen
    raw_parts = [f"price={price}"]
    if stock_status:
        raw_parts.append(f"availability={stock_status}")
    return ExtractionResult(price=price, stock_status=stock_status, raw=", ".join(raw_parts))


def _parse_json_ld_price(val) -> float | None:
    """Parse a JSON-LD price value, stripping currency symbols."""
    if val is None:
        return None
    raw = re.sub(r"[^\d.,]", "", str(val))
    return _parse_price_match(raw)


def _parse_json_ld_availability(val) -> str | None:
    """Map JSON-LD availability to 'in_stock' or 'out_of_stock'."""
    s = str(val).lower()
    if "instock" in s:
        return "in_stock"
    if "outofstock" in s:
        return "out_of_stock"
    if "preorder" in s or "presale" in s:
        return "in_stock"
    if "discontinued" in s or "soldout" in s:
        return "out_of_stock"
    return None
