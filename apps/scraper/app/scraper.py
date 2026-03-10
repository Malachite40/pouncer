import glob as _glob
import logging
import subprocess
import time
import threading
from collections.abc import Iterable
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from scrapling.fetchers import DynamicFetcher, Fetcher

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


def scrape_product(url: str, css_selector: str | None = None, element_fingerprint: str | None = None) -> ScrapeResult:
    """Scrape a product page for price and stock information."""
    try:
        logger.info("--- Scraping %s (css_selector=%r, has_fingerprint=%s) ---", url, css_selector, element_fingerprint is not None)

        static_result = _fetch_static_page(url)
        if static_result.get("error"):
            logger.info("Static fetch failed: %s", static_result["error"])
            return static_result

        html = static_result["html"]
        logger.info("Static fetch OK: %d chars of HTML", len(html))

        result = _extract_from_html(
            html=html,
            url=url,
            css_selector=css_selector,
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
            logger.info("Static result incomplete or non-buyable — trying dynamic fetch")
            dynamic_result = _fetch_dynamic_page(url, css_selector)
            if dynamic_result.get("error") is None:
                dyn_html = dynamic_result["html"]
                logger.info("Dynamic fetch OK: %d chars of HTML", len(dyn_html))

                dynamic_extraction = _extract_from_html(
                    html=dyn_html,
                    url=url,
                    css_selector=css_selector,
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
                logger.info("Dynamic fetch failed: %s", dynamic_result["error"])
                result["raw_content"] = _join_raw_content(
                    result.get("raw_content"),
                    f"[scrapling-dynamic] error={dynamic_result['error']}",
                )

        logger.info(
            "--- Final result: price=%s, stock=%s, error=%s ---",
            result["price"], result["stock_status"], result.get("error"),
        )
        return result

    except Exception as e:
        logger.exception("Unexpected error scraping %s", url)
        return _error_result(f"Scrape failed: {str(e)}")


# --- Fetch helpers ---


def _fetch_static_page(url: str) -> dict:
    response = Fetcher.get(
        url,
        follow_redirects=True,
        timeout=settings.scrape_timeout * 1000,
        stealthy_headers=True,
        impersonate="chrome",
    )
    if response.status >= 400:
        return _error_result(f"HTTP {response.status}: {response.reason}")

    return {"html": _decode_response_body(response)}


_dynamic_fetch_sem = threading.Semaphore(1)
_chrome_lifecycle_lock = threading.RLock()


def _cleanup_profile_dirs(profile_dirs: Iterable[str]):
    for profile_dir in profile_dirs:
        try:
            subprocess.run(["rm", "-rf", profile_dir], capture_output=True, timeout=5, check=False)
        except Exception:
            logger.warning("Failed to remove Playwright profile dir %s", profile_dir, exc_info=True)


def kill_all_chrome(*, skip_if_busy: bool = False) -> bool:
    """Kill leaked chrome processes and clean up temp profile dirs."""
    acquired = _chrome_lifecycle_lock.acquire(blocking=not skip_if_busy)
    if not acquired:
        logger.info("Skipped chrome cleanup because a dynamic fetch is in flight")
        return False

    try:
        try:
            result = subprocess.run(
                ["pkill", "-9", "-f", "chrome-linux/chrome"],
                capture_output=True,
                timeout=5,
                check=False,
            )
            if result.returncode == 0:
                logger.info("Killed leaked chrome processes")
        except FileNotFoundError:
            logger.warning("Chrome cleanup skipped because pkill is not installed in the container")
        except Exception:
            logger.warning("Failed to kill leaked chrome processes", exc_info=True)

        _cleanup_profile_dirs(_glob.glob("/tmp/playwright_chromiumdev_profile-*"))
        return True
    finally:
        _chrome_lifecycle_lock.release()


def _is_transient_browser_close(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "target page, context or browser has been closed" in message
        or "browsercontext.new_page: target page, context or browser has been closed" in message
    )


def _fetch_dynamic_page(url: str, css_selector: str | None = None) -> dict:
    wait_selector = _get_wait_selector(url, css_selector)

    _dynamic_fetch_sem.acquire()
    response = None
    dirs_before = set(_glob.glob("/tmp/playwright_chromiumdev_profile-*"))
    try:
        with _chrome_lifecycle_lock:
            try:
                for attempt in range(1, settings.dynamic_fetch_retries + 1):
                    try:
                        response = DynamicFetcher.fetch(
                            url,
                            headless=True,
                            timeout=settings.dynamic_timeout_ms,
                            wait=settings.dynamic_wait_ms,
                            wait_selector=wait_selector,
                            wait_selector_state=settings.dynamic_wait_selector_state,
                            disable_resources=False,
                            google_search=True,
                            locale="en-US",
                        )
                        break
                    except Exception as exc:
                        logger.exception("Dynamic fetch crashed for %s on attempt %d", url, attempt)
                        kill_all_chrome()
                        if attempt >= settings.dynamic_fetch_retries or not _is_transient_browser_close(exc):
                            raise
                        backoff_s = settings.dynamic_retry_backoff_ms / 1000
                        logger.warning(
                            "Retrying dynamic fetch for %s after transient browser-close error in %.2fs",
                            url,
                            backoff_s,
                        )
                        time.sleep(backoff_s)
            finally:
                dirs_after = set(_glob.glob("/tmp/playwright_chromiumdev_profile-*"))
                _cleanup_profile_dirs(dirs_after - dirs_before)
    finally:
        _dynamic_fetch_sem.release()

    if response is None:
        return _error_result("Dynamic fetch failed without a response")

    if response.status >= 400:
        return _error_result(f"HTTP {response.status}: {response.reason}")

    return {"html": _decode_response_body(response)}


def _decode_response_body(response) -> str:
    body = response.body
    if isinstance(body, bytes):
        encoding = getattr(response, "encoding", None) or "utf-8"
        return body.decode(encoding, errors="replace")
    return str(body)


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


def _get_wait_selector(url: str, css_selector: str | None = None) -> str | None:
    if css_selector:
        return css_selector

    hostname = (urlparse(url).hostname or "").lower()
    if "target." in hostname:
        return "h1"
    if "amazon." in hostname:
        return "#ppd"
    if "walmart." in hostname:
        return "[data-testid='price-wrap']"
    if "bestbuy." in hostname:
        return ".priceView-hero-price"
    if "costco." in hostname:
        return "#pull-right-price"

    return settings.dynamic_default_wait_selector
