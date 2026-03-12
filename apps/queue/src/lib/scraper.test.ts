import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables, checkWatchWithScraper } from './scraper';

test('classifies 503 responses as scraper overload', () => {
    assert.equal(
        __testables.classifyScraperError(
            'Scraper request failed with status 503',
            503,
        ),
        'scraper_overloaded',
    );
});

test('classifies 504 responses as transient', () => {
    assert.equal(
        __testables.classifyScraperError(
            'Scraper request failed with status 504',
            504,
        ),
        'transient',
    );
});

test('classifies timeout and abort errors as transient', () => {
    assert.equal(
        __testables.classifyScraperError('Scraper request failed: AbortError'),
        'transient',
    );
    assert.equal(
        __testables.classifyScraperError('Scrape timed out'),
        'transient',
    );
    assert.equal(
        __testables.classifyScraperError(
            'Dynamic fetch failed after empty extraction: browser has been closed',
        ),
        'transient',
    );
});

test('classifies health-derived overload messages as scraper overload', () => {
    assert.equal(
        __testables.classifyScraperError(
            '{"status":"degraded","stuck_workers":1}',
        ),
        'scraper_overloaded',
    );
});

test('classifies browser resource exhaustion as scraper overload', () => {
    assert.equal(
        __testables.classifyScraperError(
            'Scrape failed: BrowserType.launch_persistent_context: Connection closed while reading from the driver',
        ),
        'scraper_overloaded',
    );
    assert.equal(
        __testables.classifyScraperError(
            'Scrape failed: [Errno 11] Resource temporarily unavailable',
        ),
        'scraper_overloaded',
    );
});

test('normalizes structured health error detail', () => {
    assert.equal(
        __testables.normalizeScraperErrorDetail({
            status: 'degraded',
            stuck_workers: 1,
        }),
        '{"status":"degraded","stuck_workers":1}',
    );
});

test('classifies timed-out 200 responses as transient', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
        ({
            ok: true,
            json: async () => ({
                price: null,
                stock_status: null,
                raw_content: null,
                error: 'Scrape timed out',
            }),
        }) as Response) as typeof fetch;

    try {
        const result = await checkWatchWithScraper({
            url: 'https://example.com/product',
            cssSelector: null,
            elementFingerprint: null,
        });
        assert.equal(result.errorType, 'transient');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('returns transient error when fetch aborts before scraper responds', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
        throw new DOMException('This operation was aborted', 'AbortError');
    }) as typeof fetch;

    try {
        const result = await checkWatchWithScraper({
            url: 'https://example.com/product',
            cssSelector: null,
            elementFingerprint: null,
        });
        assert.equal(result.errorType, 'transient');
        assert.match(result.error ?? '', /AbortError/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('classifies empty extraction responses as terminal', () => {
    assert.equal(
        __testables.classifyScraperError('No product data extracted from page'),
        'terminal',
    );
});
