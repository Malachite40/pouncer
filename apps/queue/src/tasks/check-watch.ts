import { checkResults, sentNotifications, watches } from '@pounce/db/schema';
import {
    WATCH_CHECK_ERROR_TYPES,
    completeWatchCheck,
    failWatchCheckTerminal,
    failWatchCheckWithBackoff,
    markWatchCheckStarted,
    touchWatchCheckLease,
} from '@pounce/trpc/queue';
import { and, desc, eq, isNull } from 'drizzle-orm';

import {
    watchLeaseMs,
    watchOverloadBackoffMs,
    watchRetryBackoffMs,
} from '../config';
import { db } from '../db';
import { sendTelegramNotification } from '../lib/notifications';
import { checkWatchWithScraper } from '../lib/scraper';
import { computeVolatility, getAdjustedIntervalTier } from '../lib/volatility';
import { buildWatchNotifications } from '../lib/watch-notifications';
import type { ScraperCheckOutcome } from '../types';

interface CheckWatchPayload {
    watchId: string;
    userId: string;
    manual?: boolean;
}

type WatchRecord = typeof watches.$inferSelect;
type WatchNotification = ReturnType<typeof buildWatchNotifications>[number];

interface ScrapeOutcome {
    price: number | null;
    stockStatus: string | null;
    rawContent: string | null;
    error: string | null;
    errorType: ScraperCheckOutcome['errorType'];
}

interface CheckWatchDeps {
    getNow: () => Date;
    random: () => number;
    loadWatch: (input: {
        watchId: string;
        userId: string;
    }) => Promise<WatchRecord | null>;
    markWatchCheckStarted: (input: {
        watchId: string;
        userId: string;
        now: Date;
        leaseMs: number;
    }) => Promise<boolean>;
    touchWatchCheckLease: (input: {
        watchId: string;
        userId: string;
        now: Date;
        leaseMs: number;
    }) => Promise<void>;
    scrape: (input: {
        url: string;
        cssSelector: string | null;
        elementFingerprint: string | null;
    }) => Promise<ScraperCheckOutcome>;
    insertCheckResult: (input: {
        watchId: string;
        result: ScrapeOutcome;
    }) => Promise<void>;
    failWatchCheckWithBackoff: (input: {
        watchId: string;
        userId: string;
        now: Date;
        backoffMs: number;
        errorType: (typeof WATCH_CHECK_ERROR_TYPES)[keyof typeof WATCH_CHECK_ERROR_TYPES];
    }) => Promise<void>;
    failWatchCheckTerminal: (input: {
        watchId: string;
        userId: string;
        now: Date;
        errorType: (typeof WATCH_CHECK_ERROR_TYPES)[keyof typeof WATCH_CHECK_ERROR_TYPES];
    }) => Promise<void>;
    sendTelegramNotification: (
        userId: string,
        notification: WatchNotification,
    ) => Promise<void>;
    recordSentNotification: (input: {
        userId: string;
        watchId: string;
        notification: WatchNotification;
    }) => Promise<void>;
    loadRecentCheckPrices: (input: {
        watchId: string;
        limit: number;
    }) => Promise<Array<{ price: string | null }>>;
    completeWatchCheck: (input: {
        watchId: string;
        userId: string;
        now: Date;
        lastPrice: string | null;
        lastStockStatus: string | null;
        notificationsSent: number;
        checkIntervalSeconds?: number;
    }) => Promise<void>;
    log: (message: string) => void;
    warn: (message: string) => void;
}

function nullIfUndefined<T>(value: T | undefined): T | null {
    return value ?? null;
}

function getJitteredBackoffMs(
    baseBackoffMs: number,
    random: () => number = Math.random,
) {
    const jitterWindow = Math.max(1_000, Math.floor(baseBackoffMs * 0.1));
    return baseBackoffMs + Math.floor(random() * jitterWindow);
}

function normalizeScrapeOutcome(result: ScraperCheckOutcome): ScrapeOutcome {
    return {
        price: result.price ?? null,
        stockStatus: nullIfUndefined(result.stock_status),
        rawContent: nullIfUndefined(result.raw_content),
        error: nullIfUndefined(result.error),
        errorType: result.errorType,
    };
}

function shouldConfirmLostStock(
    previousStockStatus: string | null,
    result: ScrapeOutcome,
) {
    return (
        previousStockStatus === 'in_stock' &&
        result.errorType === null &&
        result.stockStatus === 'out_of_stock'
    );
}

function resolveCanonicalStockLossOutcome(
    initialResult: ScrapeOutcome,
    retryResult: ScrapeOutcome,
) {
    return retryResult.errorType === null ? retryResult : initialResult;
}

async function runScrapeAttempt(
    deps: CheckWatchDeps,
    watch: WatchRecord,
    attempt: 'initial' | 'confirmation',
) {
    const scrapeStartedAt = Date.now();
    const result = normalizeScrapeOutcome(
        await deps.scrape({
            url: watch.url,
            cssSelector: watch.cssSelector,
            elementFingerprint: watch.elementFingerprint,
        }),
    );
    const scrapeElapsedMs = Date.now() - scrapeStartedAt;

    if (result.errorType) {
        deps.warn(
            `[queue] Scrape result attempt=${attempt} watchId=${watch.id} url=${watch.url} errorType=${result.errorType} elapsed_ms=${scrapeElapsedMs} error=${JSON.stringify(result.error)}`,
        );
    }

    return result;
}

const defaultDeps: CheckWatchDeps = {
    getNow: () => new Date(),
    random: () => Math.random(),
    async loadWatch({ watchId, userId }) {
        const [watch] = await db
            .select()
            .from(watches)
            .where(
                and(
                    eq(watches.id, watchId),
                    eq(watches.userId, userId),
                    isNull(watches.deletedAt),
                ),
            );

        return watch ?? null;
    },
    markWatchCheckStarted: (input) => markWatchCheckStarted(db, input),
    touchWatchCheckLease: (input) => touchWatchCheckLease(db, input),
    scrape: checkWatchWithScraper,
    async insertCheckResult({ watchId, result }) {
        await db.insert(checkResults).values({
            watchId,
            price: result.price?.toString() ?? null,
            stockStatus: result.stockStatus,
            rawContent: result.rawContent,
            error: result.error,
        });
    },
    failWatchCheckWithBackoff: (input) => failWatchCheckWithBackoff(db, input),
    failWatchCheckTerminal: (input) => failWatchCheckTerminal(db, input),
    sendTelegramNotification,
    async recordSentNotification({ userId, watchId, notification }) {
        await db.insert(sentNotifications).values({
            userId,
            watchId,
            message: notification.text,
            type: notification.type,
        });
    },
    async loadRecentCheckPrices({ watchId, limit }) {
        return db
            .select({ price: checkResults.price })
            .from(checkResults)
            .where(eq(checkResults.watchId, watchId))
            .orderBy(desc(checkResults.checkedAt))
            .limit(limit);
    },
    completeWatchCheck: (input) => completeWatchCheck(db, input),
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
};

async function handleCheckWatchWithDeps(
    payload: CheckWatchPayload,
    deps: CheckWatchDeps,
) {
    const watch = await deps.loadWatch({
        watchId: payload.watchId,
        userId: payload.userId,
    });

    if (!watch || (!watch.isActive && !payload.manual)) {
        deps.log(
            `[queue] Watch ${payload.watchId} not found or inactive, skipping`,
        );
        return { skipped: true };
    }

    deps.log(
        `[queue] Checking watch ${watch.id}: ${watch.name} (${watch.url})`,
    );

    const attemptStartedAt = deps.getNow();
    const claimed = await deps.markWatchCheckStarted({
        watchId: watch.id,
        userId: payload.userId,
        now: attemptStartedAt,
        leaseMs: watchLeaseMs,
    });

    if (!claimed) {
        deps.log(
            `[queue] Watch ${watch.id} no longer has an active claim, skipping`,
        );
        return { skipped: true };
    }

    try {
        let result = await runScrapeAttempt(deps, watch, 'initial');

        if (shouldConfirmLostStock(watch.lastStockStatus, result)) {
            await deps.touchWatchCheckLease({
                watchId: watch.id,
                userId: payload.userId,
                now: deps.getNow(),
                leaseMs: watchLeaseMs,
            });

            const retryResult = await runScrapeAttempt(
                deps,
                watch,
                'confirmation',
            );
            result = resolveCanonicalStockLossOutcome(result, retryResult);
        }

        await deps.insertCheckResult({
            watchId: watch.id,
            result,
        });

        if (result.errorType === WATCH_CHECK_ERROR_TYPES.SCRAPER_OVERLOADED) {
            await deps.failWatchCheckWithBackoff({
                watchId: watch.id,
                userId: payload.userId,
                now: deps.getNow(),
                backoffMs: getJitteredBackoffMs(
                    watchOverloadBackoffMs,
                    deps.random,
                ),
                errorType: WATCH_CHECK_ERROR_TYPES.SCRAPER_OVERLOADED,
            });
            return { success: false, retrying: true };
        }

        if (result.errorType === WATCH_CHECK_ERROR_TYPES.TRANSIENT) {
            await deps.failWatchCheckWithBackoff({
                watchId: watch.id,
                userId: payload.userId,
                now: deps.getNow(),
                backoffMs: watchRetryBackoffMs,
                errorType: WATCH_CHECK_ERROR_TYPES.TRANSIENT,
            });
            return { success: false, retrying: true };
        }

        if (result.errorType === WATCH_CHECK_ERROR_TYPES.TERMINAL) {
            await deps.failWatchCheckTerminal({
                watchId: watch.id,
                userId: payload.userId,
                now: deps.getNow(),
                errorType: WATCH_CHECK_ERROR_TYPES.TERMINAL,
            });
            return { success: false, retrying: false };
        }

        const notifications = buildWatchNotifications({
            watch,
            price: result.price,
            stockStatus: result.stockStatus,
        });

        let notificationsSent = 0;
        const now = deps.getNow();

        if (notifications.length > 0) {
            const cooldown = watch.notifyCooldownSeconds;
            const lastNotified = watch.lastNotifiedAt;
            const cooldownElapsed =
                !cooldown ||
                !lastNotified ||
                now.getTime() - lastNotified.getTime() >= cooldown * 1000;

            if (cooldownElapsed || payload.manual) {
                for (const notification of notifications) {
                    await deps.sendTelegramNotification(
                        payload.userId,
                        notification,
                    );
                    await deps.recordSentNotification({
                        userId: payload.userId,
                        watchId: watch.id,
                        notification,
                    });
                }
                notificationsSent = notifications.length;
            }
        }

        let nextCheckIntervalSeconds: number | undefined;

        if (watch.autoInterval && watch.baseCheckIntervalSeconds) {
            const recentChecks = await deps.loadRecentCheckPrices({
                watchId: watch.id,
                limit: 20,
            });

            const prices = recentChecks
                .map((r) => (r.price ? Number(r.price) : null))
                .filter((p): p is number => p !== null && !Number.isNaN(p));

            if (prices.length >= 5) {
                const cv = computeVolatility(prices);
                const adjustedInterval = getAdjustedIntervalTier(
                    watch.baseCheckIntervalSeconds,
                    cv,
                );

                if (adjustedInterval !== watch.checkIntervalSeconds) {
                    nextCheckIntervalSeconds = adjustedInterval;
                    deps.log(
                        `[queue] Auto-interval for ${watch.id}: CV=${cv.toFixed(4)}, ${watch.checkIntervalSeconds}s -> ${adjustedInterval}s`,
                    );
                }
            }
        }

        await deps.completeWatchCheck({
            watchId: watch.id,
            userId: payload.userId,
            now,
            lastPrice: result.price?.toString() ?? watch.lastPrice ?? null,
            lastStockStatus:
                result.stockStatus ?? watch.lastStockStatus ?? null,
            notificationsSent,
            checkIntervalSeconds: nextCheckIntervalSeconds,
        });

        return { success: true, notifications: notificationsSent };
    } catch (error) {
        await deps.failWatchCheckWithBackoff({
            watchId: watch.id,
            userId: payload.userId,
            now: deps.getNow(),
            backoffMs: watchRetryBackoffMs,
            errorType: WATCH_CHECK_ERROR_TYPES.TRANSIENT,
        });
        throw error;
    }
}

export async function handleCheckWatch(payload: CheckWatchPayload) {
    return handleCheckWatchWithDeps(payload, defaultDeps);
}

export const __testables = {
    getJitteredBackoffMs,
    handleCheckWatchWithDeps,
    normalizeScrapeOutcome,
    shouldConfirmLostStock,
    resolveCanonicalStockLossOutcome,
};
