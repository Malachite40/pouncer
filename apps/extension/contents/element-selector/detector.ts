import { getElementText } from './selector-generator';

const PRICE_REGEX = /[$\u20AC\u00A3\u00A5]\s*\d+[.,]?\d*/;
const STOCK_PATTERNS =
    /\b(add to cart|buy now|in stock|out of stock|sold out|notify me|unavailable|available|add to bag|pre-order)\b/i;

export function detectCheckType(
    element: Element,
): 'price' | 'stock' | 'both' {
    const text = getElementText(element);
    const hasPrice = PRICE_REGEX.test(text);
    const hasStock = STOCK_PATTERNS.test(text);

    if (hasPrice && hasStock) return 'both';
    if (hasPrice) return 'price';
    if (hasStock) return 'stock';

    // Check nearby context — walk up a few levels
    let parent = element.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
        const parentText = getElementText(parent);
        const parentHasPrice = PRICE_REGEX.test(parentText);
        const parentHasStock = STOCK_PATTERNS.test(parentText);
        if (parentHasPrice) return 'price';
        if (parentHasStock) return 'stock';
        parent = parent.parentElement;
    }

    return 'both';
}

export function detectName(): string {
    // Try Open Graph title
    const ogTitle = document.querySelector<HTMLMetaElement>(
        'meta[property="og:title"]',
    );
    if (ogTitle?.content) return cleanTitle(ogTitle.content);

    // Try Twitter title
    const twitterTitle = document.querySelector<HTMLMetaElement>(
        'meta[name="twitter:title"]',
    );
    if (twitterTitle?.content) return cleanTitle(twitterTitle.content);

    // Fallback to document.title
    return cleanTitle(document.title);
}

export function detectPrice(element: Element): string | null {
    const text = getElementText(element);
    const match = text.match(PRICE_REGEX);
    return match ? match[0] : null;
}

function cleanTitle(title: string): string {
    // Remove common site name suffixes like " - Amazon.com", " | eBay"
    return title
        .replace(/\s*[\-|:]\s*[^-|:]+\.(com|co|net|org|io).*$/i, '')
        .replace(/\s*[\-|]\s*$/, '')
        .trim()
        .slice(0, 100);
}
