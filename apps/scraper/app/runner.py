import argparse
import json
import logging
import sys

from .scraper import scrape_product


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--css-selector")
    parser.add_argument("--element-fingerprint")
    args = parser.parse_args()

    logging.disable(logging.CRITICAL)

    result = scrape_product(
        args.url,
        args.css_selector,
        args.element_fingerprint,
    )
    sys.stdout.write(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
