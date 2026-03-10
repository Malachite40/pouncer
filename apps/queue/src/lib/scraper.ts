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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    try {
        const response = await fetch(`${scraperUrl}/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                url,
                css_selector: cssSelector,
                element_fingerprint: elementFingerprint,
            }),
        });

        if (!response.ok) {
            const body = (await response.json().catch(() => null)) as
                | { detail?: string }
                | null;
            return {
                price: null,
                stock_status: null,
                raw_content: null,
                error:
                    body?.detail ??
                    `Scraper request failed with status ${response.status}`,
            };
        }

        return (await response.json()) as ScraperCheckResult;
    } catch (error) {
        return {
            price: null,
            stock_status: null,
            raw_content: null,
            error: `Scraper request failed: ${error}`,
        };
    } finally {
        clearTimeout(timeout);
    }
}
