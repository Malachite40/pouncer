import { scraperConcurrencyLimit, scraperUrl } from '../config';
import type { ScraperCheckOutcome } from '../types';

class AsyncLimiter {
    private activeCount = 0;
    private readonly waiters: Array<() => void> = [];

    constructor(private readonly limit: number) {}

    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    private async acquire() {
        if (this.activeCount < this.limit) {
            this.activeCount += 1;
            return;
        }

        await new Promise<void>((resolve) => {
            this.waiters.push(() => {
                this.activeCount += 1;
                resolve();
            });
        });
    }

    private release() {
        this.activeCount -= 1;
        const next = this.waiters.shift();
        if (next) {
            next();
        }
    }
}

const scraperRequestLimiter = new AsyncLimiter(scraperConcurrencyLimit);

interface CheckWatchInput {
    url: string;
    cssSelector: string | null;
    elementFingerprint: string | null;
}

function normalizeScraperErrorDetail(detail: unknown) {
    if (typeof detail === 'string') {
        return detail;
    }

    if (detail == null) {
        return null;
    }

    try {
        return JSON.stringify(detail);
    } catch {
        return String(detail);
    }
}

export async function checkWatchWithScraper({
    url,
    cssSelector,
    elementFingerprint,
}: CheckWatchInput): Promise<ScraperCheckOutcome> {
    return scraperRequestLimiter.run(async () => {
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
                    | { detail?: unknown }
                    | null;
                const error =
                    normalizeScraperErrorDetail(body?.detail) ??
                    `Scraper request failed with status ${response.status}`;
                return {
                    price: null,
                    stock_status: null,
                    raw_content: null,
                    error,
                    errorType: classifyScraperError(
                        error,
                        response.status,
                    ),
                };
            }

            const payload = (await response.json()) as Omit<
                ScraperCheckOutcome,
                'errorType'
            >;
            return {
                ...payload,
                errorType: classifyScraperError(payload.error),
            };
        } catch (error) {
            const message = `Scraper request failed: ${error}`;
            return {
                price: null,
                stock_status: null,
                raw_content: null,
                error: message,
                errorType: classifyScraperError(message),
            };
        } finally {
            clearTimeout(timeout);
        }
    });
}

function classifyScraperError(
    error: string | null,
    statusCode?: number,
): ScraperCheckOutcome['errorType'] {
    if (statusCode === 503) {
        return 'scraper_overloaded';
    }

    if (statusCode === 504) {
        return 'transient';
    }

    if (!error) {
        return null;
    }

    const message = error.toLowerCase();
    if (
        message.includes('at capacity') ||
        message.includes('queue is full') ||
        message.includes('stuck_workers') ||
        message.includes('scraper is at capacity') ||
        message.includes('scraper overloaded') ||
        message.includes('resource temporarily unavailable') ||
        message.includes('process resources exhausted') ||
        message.includes('connection closed while reading from the driver') ||
        message.includes('launch_persistent_context') ||
        message.includes('503')
    ) {
        return 'scraper_overloaded';
    }

    if (
        message.includes('aborterror') ||
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('fetch failed') ||
        message.includes('browser has been closed') ||
        message.includes('econnreset') ||
        message.includes('etimedout') ||
        message.includes('enotfound') ||
        message.includes('http 429') ||
        message.includes('http 504') ||
        message.includes('http 5')
    ) {
        return 'transient';
    }

    return 'terminal';
}

export const __testables = {
    classifyScraperError,
    normalizeScraperErrorDetail,
};
