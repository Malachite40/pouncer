import assert from 'node:assert/strict';
import test from 'node:test';
import type { watches } from '@pounce/db/schema';

import { watchLeaseMs } from '../config';
import type { ScraperCheckOutcome } from '../types';
import { __testables } from './check-watch';

type WatchRecord = typeof watches.$inferSelect;
type CheckWatchDeps = Parameters<
    typeof __testables.handleCheckWatchWithDeps
>[1];

const baseNow = new Date('2026-03-14T12:00:00.000Z');

function createWatch(
    overrides: Partial<WatchRecord> = {},
): typeof watches.$inferSelect {
    return {
        id: '11111111-1111-1111-1111-111111111111',
        userId: 'user-1',
        url: 'https://example.com/product',
        name: 'Tracker Target',
        checkType: 'stock',
        cssSelector: null,
        elementFingerprint: null,
        imageUrl: null,
        checkIntervalSeconds: 900,
        lastPrice: null,
        lastStockStatus: 'in_stock',
        lastCheckedAt: null,
        checkQueuedAt: null,
        checkStartedAt: null,
        checkLeaseExpiresAt: null,
        lastCheckAttemptAt: null,
        lastCheckErrorType: null,
        notifyPriceDrop: true,
        notifyPriceIncrease: true,
        notifyStock: true,
        priceThreshold: null,
        priceDropThreshold: null,
        priceDropPercentThreshold: null,
        priceDropTargetPrice: null,
        priceIncreaseThreshold: null,
        priceIncreasePercentThreshold: null,
        priceIncreaseTargetPrice: null,
        notifyCooldownSeconds: null,
        lastNotifiedAt: null,
        autoInterval: false,
        baseCheckIntervalSeconds: null,
        isActive: true,
        createdAt: baseNow,
        updatedAt: baseNow,
        deletedAt: null,
        ...overrides,
    };
}

function createScrapeOutcome(
    overrides: Partial<ScraperCheckOutcome> = {},
): ScraperCheckOutcome {
    return {
        price: null,
        stock_status: null,
        raw_content: null,
        error: null,
        errorType: null,
        ...overrides,
    };
}

function createDeps({
    watch = createWatch(),
    scrapeResults,
}: {
    watch?: WatchRecord | null;
    scrapeResults: ScraperCheckOutcome[];
}) {
    const events: string[] = [];
    const insertedResults: Array<
        Parameters<CheckWatchDeps['insertCheckResult']>[0]
    > = [];
    const backoffCalls: Array<
        Parameters<CheckWatchDeps['failWatchCheckWithBackoff']>[0]
    > = [];
    const terminalCalls: Array<
        Parameters<CheckWatchDeps['failWatchCheckTerminal']>[0]
    > = [];
    const leaseTouches: Array<
        Parameters<CheckWatchDeps['touchWatchCheckLease']>[0]
    > = [];
    const notifications: Array<{
        userId: string;
        notification: Parameters<CheckWatchDeps['sendTelegramNotification']>[1];
    }> = [];
    const sentNotifications: Array<
        Parameters<CheckWatchDeps['recordSentNotification']>[0]
    > = [];
    const completeCalls: Array<
        Parameters<CheckWatchDeps['completeWatchCheck']>[0]
    > = [];
    const warnings: string[] = [];
    let scrapeCallCount = 0;

    const deps: CheckWatchDeps = {
        getNow: () => new Date(baseNow),
        random: () => 0.5,
        async loadWatch() {
            events.push('load-watch');
            return watch;
        },
        async markWatchCheckStarted() {
            events.push('mark-started');
            return true;
        },
        async touchWatchCheckLease(input) {
            events.push('touch-lease');
            leaseTouches.push(input);
        },
        async scrape() {
            scrapeCallCount += 1;
            events.push(`scrape-${scrapeCallCount}`);
            const nextResult = scrapeResults.shift();
            assert.ok(nextResult, 'expected scrape result');
            return nextResult;
        },
        async insertCheckResult(input) {
            events.push('insert-check-result');
            insertedResults.push(input);
        },
        async failWatchCheckWithBackoff(input) {
            events.push('fail-with-backoff');
            backoffCalls.push(input);
        },
        async failWatchCheckTerminal(input) {
            events.push('fail-terminal');
            terminalCalls.push(input);
        },
        async sendTelegramNotification(userId, notification) {
            events.push('send-notification');
            notifications.push({ userId, notification });
        },
        async recordSentNotification(input) {
            events.push('record-notification');
            sentNotifications.push(input);
        },
        async loadRecentCheckPrices() {
            events.push('load-recent-prices');
            return [];
        },
        async completeWatchCheck(input) {
            events.push('complete-check');
            completeCalls.push(input);
        },
        log: () => {},
        warn: (message) => warnings.push(message),
    };

    return {
        deps,
        state: {
            events,
            insertedResults,
            backoffCalls,
            terminalCalls,
            leaseTouches,
            notifications,
            sentNotifications,
            completeCalls,
            warnings,
            get scrapeCallCount() {
                return scrapeCallCount;
            },
        },
    };
}

test('jittered overload backoff stays above base delay', () => {
    assert.equal(
        __testables.getJitteredBackoffMs(300_000, () => 0),
        300_000,
    );
});

test('jittered overload backoff adds up to ten percent jitter', () => {
    const backoffMs = __testables.getJitteredBackoffMs(300_000, () => 0.9999);
    assert.equal(backoffMs, 329_997);
});

test('retries a fresh lost stock signal immediately and persists the confirmed result', async () => {
    const { deps, state } = createDeps({
        scrapeResults: [
            createScrapeOutcome({
                stock_status: 'out_of_stock',
                raw_content: 'first-loss',
            }),
            createScrapeOutcome({
                stock_status: 'out_of_stock',
                raw_content: 'confirmed-loss',
            }),
        ],
    });

    const result = await __testables.handleCheckWatchWithDeps(
        { watchId: 'watch-1', userId: 'user-1' },
        deps,
    );

    assert.deepEqual(result, { success: true, notifications: 1 });
    assert.equal(state.scrapeCallCount, 2);
    assert.equal(state.leaseTouches.length, 1);
    assert.equal(state.leaseTouches[0]?.leaseMs, watchLeaseMs);
    assert.equal(state.insertedResults.length, 1);
    assert.equal(state.insertedResults[0]?.result.rawContent, 'confirmed-loss');
    assert.equal(state.insertedResults[0]?.result.stockStatus, 'out_of_stock');
    assert.equal(state.notifications.length, 1);
    assert.equal(state.notifications[0]?.notification.type, 'out_of_stock');
    assert.equal(state.sentNotifications.length, 1);
    assert.equal(state.completeCalls[0]?.lastStockStatus, 'out_of_stock');
    assert.ok(
        state.events.indexOf('touch-lease') < state.events.indexOf('scrape-2'),
    );
});

for (const scenario of [
    {
        label: 'in stock',
        retryOutcome: createScrapeOutcome({
            stock_status: 'in_stock',
            raw_content: 'recovered-stock',
        }),
        expectedInsertedStatus: 'in_stock',
        expectedLastStockStatus: 'in_stock',
    },
    {
        label: 'unknown',
        retryOutcome: createScrapeOutcome({
            stock_status: null,
            raw_content: 'unclear-stock',
        }),
        expectedInsertedStatus: null,
        expectedLastStockStatus: 'in_stock',
    },
] as const) {
    test(`suppresses the stock-loss alert when confirmation returns ${scenario.label}`, async () => {
        const { deps, state } = createDeps({
            scrapeResults: [
                createScrapeOutcome({
                    stock_status: 'out_of_stock',
                    raw_content: 'first-loss',
                }),
                scenario.retryOutcome,
            ],
        });

        const result = await __testables.handleCheckWatchWithDeps(
            { watchId: 'watch-1', userId: 'user-1' },
            deps,
        );

        assert.deepEqual(result, { success: true, notifications: 0 });
        assert.equal(state.scrapeCallCount, 2);
        assert.equal(state.leaseTouches.length, 1);
        assert.equal(state.notifications.length, 0);
        assert.equal(state.sentNotifications.length, 0);
        assert.equal(state.insertedResults.length, 1);
        assert.equal(
            state.insertedResults[0]?.result.stockStatus,
            scenario.expectedInsertedStatus,
        );
        assert.equal(
            state.completeCalls[0]?.lastStockStatus,
            scenario.expectedLastStockStatus,
        );
    });
}

test('falls back to the first lost-stock result when the confirmation retry errors', async () => {
    const { deps, state } = createDeps({
        scrapeResults: [
            createScrapeOutcome({
                stock_status: 'out_of_stock',
                raw_content: 'first-loss',
            }),
            createScrapeOutcome({
                error: 'timed out',
                errorType: 'transient',
                raw_content: 'retry-error',
            }),
        ],
    });

    const result = await __testables.handleCheckWatchWithDeps(
        { watchId: 'watch-1', userId: 'user-1' },
        deps,
    );

    assert.deepEqual(result, { success: true, notifications: 1 });
    assert.equal(state.scrapeCallCount, 2);
    assert.equal(state.backoffCalls.length, 0);
    assert.equal(state.terminalCalls.length, 0);
    assert.equal(state.insertedResults.length, 1);
    assert.equal(state.insertedResults[0]?.result.rawContent, 'first-loss');
    assert.equal(state.notifications[0]?.notification.type, 'out_of_stock');
    assert.ok(
        state.events.indexOf('scrape-2') <
            state.events.indexOf('send-notification'),
    );
    assert.equal(state.warnings.length, 1);
});

for (const scenario of [
    {
        label: 'previous status is unknown',
        watch: createWatch({ lastStockStatus: null }),
    },
    {
        label: 'watch is already out of stock',
        watch: createWatch({ lastStockStatus: 'out_of_stock' }),
    },
] as const) {
    test(`does not confirm lost stock when ${scenario.label}`, async () => {
        const { deps, state } = createDeps({
            watch: scenario.watch,
            scrapeResults: [
                createScrapeOutcome({
                    stock_status: 'out_of_stock',
                    raw_content: 'single-read',
                }),
            ],
        });

        const result = await __testables.handleCheckWatchWithDeps(
            { watchId: 'watch-1', userId: 'user-1' },
            deps,
        );

        assert.deepEqual(result, { success: true, notifications: 0 });
        assert.equal(state.scrapeCallCount, 1);
        assert.equal(state.leaseTouches.length, 0);
        assert.equal(state.insertedResults.length, 1);
        assert.equal(state.notifications.length, 0);
        assert.equal(state.completeCalls.length, 1);
    });
}
