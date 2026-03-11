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
    assert.equal(__testables.classifyScraperError('Scrape timed out'), 'transient');
});

test('classifies health-derived overload messages as scraper overload', () => {
    assert.equal(
        __testables.classifyScraperError(
            '{"status":"degraded","stuck_workers":1}',
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
