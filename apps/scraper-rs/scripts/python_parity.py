import json
import sys

from app.scraper import _extract_from_html


def main() -> int:
    payload = json.loads(sys.stdin.read())
    result = _extract_from_html(
        payload["html"],
        payload["url"],
        payload.get("css_selector"),
        payload.get("element_fingerprint"),
    )
    print(
        json.dumps(
            {
                "price": result.get("price"),
                "stock_status": result.get("stock_status"),
                "error": result.get("error"),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
