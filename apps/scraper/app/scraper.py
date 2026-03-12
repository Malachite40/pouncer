import asyncio
import contextlib
import logging
import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from playwright.async_api import Browser, Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from scrapling.fetchers import Fetcher

from .config import settings
from .hosts import _extract_host_specific
from .json_ld import _extract_json_ld
from .parsing import ScrapeResult, _error_result, _validate_price
from .strategies import (
    _extract_common_selectors,
    _extract_css_selector,
    _extract_fingerprint,
    _extract_meta_price,
    _extract_title_window,
)

logger = logging.getLogger(__name__)


_STOCK_SOURCE_PRIORITIES = {
    "css_selector": 100,
    "fingerprint": 95,
    "host": 90,
    "json-ld": 80,
    "selectors": 70,
    "title-window": 50,
    "meta": 10,
}

class ScrapeTimeoutError(RuntimeError):
    pass


class BrowserSessionError(RuntimeError):
    pass


def _is_timeout_error(exc: Exception) -> bool:
    return "timeout" in str(exc).lower() or isinstance(exc, PlaywrightTimeoutError)


def _is_browser_restartable_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(
        marker in message
        for marker in (
            "target page, context or browser has been closed",
            "browser has been closed",
            "page crashed",
            "connection closed while reading from the driver",
        )
    )


async def scrape_product(
    url: str,
    browser: Browser,
    css_selector: str | None = None,
    element_fingerprint: str | None = None,
) -> ScrapeResult:
    """Scrape a product page for price and stock information."""
    try:
        logger.info("--- Scraping %s (css_selector=%r, has_fingerprint=%s) ---", url, css_selector, element_fingerprint is not None)
        effective_css_selector = _normalize_css_selector(url, css_selector)
        if effective_css_selector != css_selector:
            logger.info(
                "Normalized css selector for %s from %r to %r",
                url,
                css_selector,
                effective_css_selector,
            )

        dynamic_attempted = False
        dynamic_error: str | None = None

        static_result = await _fetch_static_page(url)
        if static_result.get("error"):
            logger.info("Static fetch failed: %s", static_result["error"])
            return static_result

        html = static_result["html"]
        logger.info("Static fetch OK: %d chars of HTML", len(html))

        result = _extract_from_html(
            html=html,
            url=url,
            css_selector=effective_css_selector,
            element_fingerprint=element_fingerprint,
            source_label="scrapling-static",
        )
        logger.info(
            "Static extraction: price=%s, stock=%s",
            result["price"], result["stock_status"],
        )

        should_try_dynamic = (
            result["price"] is None
            or result["stock_status"] is None
            or result["stock_status"] == "out_of_stock"
        )
        if should_try_dynamic:
            dynamic_attempted = True
            logger.info("Static result incomplete or non-buyable — trying dynamic fetch")
            dynamic_result = await _fetch_dynamic_page(browser, url, effective_css_selector)
            if dynamic_result.get("error") is None:
                dyn_html = dynamic_result["html"]
                logger.info("Dynamic fetch OK: %d chars of HTML", len(dyn_html))

                dynamic_extraction = _extract_from_html(
                    html=dyn_html,
                    url=url,
                    css_selector=effective_css_selector,
                    element_fingerprint=element_fingerprint,
                    source_label="scrapling-dynamic",
                )
                logger.info(
                    "Dynamic extraction: price=%s, stock=%s",
                    dynamic_extraction["price"], dynamic_extraction["stock_status"],
                )

                if result["price"] is None and dynamic_extraction["price"] is not None:
                    result["price"] = dynamic_extraction["price"]
                if dynamic_extraction["stock_status"] is not None:
                    result["stock_status"] = dynamic_extraction["stock_status"]

                result["raw_content"] = _join_raw_content(
                    result.get("raw_content"),
                    dynamic_extraction.get("raw_content"),
                )
            else:
                dynamic_error = dynamic_result["error"]
                logger.info("Dynamic fetch failed: %s", dynamic_result["error"])
                result["raw_content"] = _join_raw_content(
                    result.get("raw_content"),
                    f"[scrapling-dynamic] error={dynamic_result['error']}",
                )

        if result["price"] is None and result["stock_status"] is None:
            result["error"] = _resolve_empty_scrape_error(
                dynamic_attempted=dynamic_attempted,
                dynamic_error=dynamic_error,
            )

        logger.info(
            "--- Final result: price=%s, stock=%s, error=%s ---",
            result["price"], result["stock_status"], result.get("error"),
        )
        return result

    except (BrowserSessionError, ScrapeTimeoutError):
        raise
    except Exception as e:
        logger.exception("Unexpected error scraping %s", url)
        return _error_result(f"Scrape failed: {str(e)}")


# --- Fetch helpers ---


async def _fetch_static_page(url: str) -> dict:
    try:
        response = await asyncio.to_thread(
            Fetcher.get,
            url,
            follow_redirects=True,
            timeout=settings.scrape_timeout * 1000,
            stealthy_headers=True,
            impersonate="chrome",
        )
    except Exception as exc:
        if _is_timeout_error(exc):
            raise ScrapeTimeoutError(f"Static fetch timed out: {exc}") from exc
        raise

    if response.status >= 400:
        return _error_result(f"HTTP {response.status}: {response.reason}")

    return {"html": _decode_response_body(response)}


async def _fetch_dynamic_page(
    browser: Browser,
    url: str,
    css_selector: str | None = None,
) -> dict:
    context = None
    page = None
    try:
        context = await browser.new_context(
            locale="en-US",
            user_agent=settings.browser_user_agent,
            extra_http_headers={
                "accept-language": settings.browser_accept_language,
            },
        )
        page = await context.new_page()

        response = await page.goto(
            url,
            wait_until="domcontentloaded",
            timeout=settings.page_navigation_timeout_ms,
        )
        if response is not None and response.status >= 400:
            return _error_result(f"HTTP {response.status}: {response.status_text}")

        waited_selector = await _wait_for_page_ready(page, url, css_selector)
        logger.info(
            "Dynamic fetch ready for %s using selector=%r",
            url,
            waited_selector,
        )

        if settings.dynamic_wait_ms > 0:
            await page.wait_for_timeout(settings.dynamic_wait_ms)

        return {"html": await page.content()}
    except PlaywrightTimeoutError as exc:
        raise ScrapeTimeoutError(f"Page timeout: {exc}") from exc
    except PlaywrightError as exc:
        if _is_browser_restartable_error(exc):
            raise BrowserSessionError(str(exc)) from exc
        if _is_timeout_error(exc):
            raise ScrapeTimeoutError(f"Page timeout: {exc}") from exc
        raise
    except Exception as exc:
        if _is_browser_restartable_error(exc):
            raise BrowserSessionError(str(exc)) from exc
        if _is_timeout_error(exc):
            raise ScrapeTimeoutError(f"Page timeout: {exc}") from exc
        raise
    finally:
        if page is not None:
            with contextlib.suppress(Exception):
                await page.close()
        if context is not None:
            with contextlib.suppress(Exception):
                await context.close()


async def _wait_for_page_ready(page, url: str, css_selector: str | None = None) -> str:
    last_timeout: PlaywrightTimeoutError | None = None

    for selector in _get_wait_selectors(url, css_selector):
        try:
            await page.locator(selector).first.wait_for(
                state=settings.dynamic_wait_selector_state,
                timeout=settings.page_selector_timeout_ms,
            )
            return selector
        except PlaywrightTimeoutError as exc:
            last_timeout = exc
            logger.info(
                "Selector %r did not become ready for %s within %dms",
                selector,
                url,
                settings.page_selector_timeout_ms,
            )

    if last_timeout is not None:
        raise ScrapeTimeoutError(
            f"Timed out waiting for page readiness on {url}: {last_timeout}"
        ) from last_timeout

    raise ScrapeTimeoutError(f"Timed out waiting for page readiness on {url}")


def _decode_response_body(response) -> str:
    body = response.body
    if isinstance(body, bytes):
        encoding = getattr(response, "encoding", None) or "utf-8"
        return body.decode(encoding, errors="replace")
    return str(body)


def _resolve_empty_scrape_error(
    *,
    dynamic_attempted: bool,
    dynamic_error: str | None,
) -> str:
    if dynamic_attempted and dynamic_error:
        return f"Dynamic fetch failed after empty extraction: {dynamic_error}"
    return "No product data extracted from page"


# --- Main extraction pipeline ---


def _extract_from_html(
    html: str,
    url: str,
    css_selector: str | None = None,
    element_fingerprint: str | None = None,
    source_label: str | None = None,
) -> ScrapeResult:
    soup = BeautifulSoup(html, "lxml")

    price = None
    stock_status = None
    stock_priority = -1
    raw_parts = [f"[source] {source_label}"] if source_label else []
    hostname = urlparse(url).hostname or ""

    page_title = soup.title.string.strip() if soup.title and soup.title.string else "(no title)"
    logger.info("  [%s] Page title: %s", source_label, page_title)

    strategies = []
    if css_selector:
        strategies.append(("css_selector", lambda: _extract_css_selector(soup, css_selector)))
    if element_fingerprint:
        strategies.append(("fingerprint", lambda: _extract_fingerprint(soup, element_fingerprint)))
    strategies.append((f"host:{hostname}", lambda: _extract_host_specific(url, soup)))
    strategies.append(("json-ld", lambda: _extract_json_ld(soup)))
    strategies.append(("title-window", lambda: _extract_title_window(soup)))
    strategies.append(("selectors", lambda: _extract_common_selectors(soup)))
    strategies.append(("meta", lambda: _extract_meta_price(soup)))

    for label, extractor_fn in strategies:
        result = extractor_fn()
        if result is None:
            logger.info("  [%s] %s -> no match", source_label, label)
            continue
        logger.info(
            "  [%s] %s -> price=%s, stock=%s, raw=%.200s",
            source_label, label, result["price"], result["stock_status"], result["raw"],
        )
        if result["price"] is not None and price is None:
            price = result["price"]
        if result["stock_status"] is not None:
            priority_key = label.split(":", 1)[0]
            candidate_priority = _STOCK_SOURCE_PRIORITIES.get(priority_key, 0)
            if candidate_priority > stock_priority:
                stock_status = result["stock_status"]
                stock_priority = candidate_priority
        if result["raw"]:
            raw_parts.append(f"[{label}] {result['raw']}")

    # Validate final price
    price = _validate_price(price)

    raw_content = "\n".join(raw_parts)[:settings.max_content_length] if raw_parts else None
    return ScrapeResult(price=price, stock_status=stock_status, raw_content=raw_content, error=None)


def _join_raw_content(existing: str | None, extra: str | None) -> str | None:
    parts = [part for part in (existing, extra) if part]
    if not parts:
        return None
    return "\n".join(parts)[:settings.max_content_length]


def _get_wait_selectors(url: str, css_selector: str | None = None) -> list[str]:
    selectors: list[str] = []
    if css_selector:
        selectors.append(css_selector)

    hostname = (urlparse(url).hostname or "").lower()
    if "target." in hostname:
        selectors.append("h1")
    elif "amazon." in hostname:
        selectors.append("#ppd")
    elif "walmart." in hostname:
        selectors.append("[data-testid='price-wrap']")
    elif "bestbuy." in hostname:
        selectors.append(".priceView-hero-price")
    elif "costco." in hostname:
        selectors.append("#pull-right-price")
    elif hostname == "store.steampowered.com":
        selectors.append("[class*='SaleSection_'], .game_area_purchase_game")
    elif "tcgplayer.com" in hostname:
        selectors.append("button[id^='btnAddToCart'], .price-points, .product-details")

    selectors.append(settings.dynamic_default_wait_selector)
    deduped_selectors: list[str] = []
    for selector in selectors:
        if selector not in deduped_selectors:
            deduped_selectors.append(selector)
    return deduped_selectors


def _normalize_css_selector(url: str, css_selector: str | None) -> str | None:
    if not css_selector:
        return css_selector

    hostname = (urlparse(url).hostname or "").lower()
    if "tcgplayer.com" in hostname and re.search(r"btnAddToCart", css_selector):
        return "button[id^='btnAddToCart']"

    return css_selector
