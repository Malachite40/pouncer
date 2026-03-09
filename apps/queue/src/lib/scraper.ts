import { scraperUrl } from '../config';
import type { ScraperCheckResult } from '../types';

interface CheckWatchInput {
    url: string;
    cssSelector: string | null;
    elementFingerprint: string | null;
}

export async function checkWatchWithScraper({
    url,
    cssSelector,
    elementFingerprint,
}: CheckWatchInput): Promise<ScraperCheckResult> {
    try {
        const response = await fetch(`${scraperUrl}/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                css_selector: cssSelector,
                element_fingerprint: elementFingerprint,
            }),
        });

        return (await response.json()) as ScraperCheckResult;
    } catch (error) {
        return {
            price: null,
            stock_status: null,
            raw_content: null,
            error: `Scraper request failed: ${error}`,
        };
    }
}
