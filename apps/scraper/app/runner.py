import argparse
import asyncio
import json
import logging
import sys

from playwright.async_api import async_playwright

from .scraper import scrape_product


async def _main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--css-selector")
    parser.add_argument("--element-fingerprint")
    args = parser.parse_args()

    logging.disable(logging.CRITICAL)

    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(headless=True)
    try:
        result = await scrape_product(
            args.url,
            browser,
            args.css_selector,
            args.element_fingerprint,
        )
        sys.stdout.write(json.dumps(result))
        return 0
    finally:
        await browser.close()
        await playwright.stop()


def main() -> int:
    return asyncio.run(_main())


if __name__ == "__main__":
    raise SystemExit(main())
