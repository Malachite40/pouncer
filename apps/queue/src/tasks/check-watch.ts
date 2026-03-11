import { checkResults, sentNotifications, watches } from '@pounce/db/schema';
import {
    WATCH_CHECK_ERROR_TYPES,
    completeWatchCheck,
    failWatchCheckTerminal,
    failWatchCheckWithBackoff,
    markWatchCheckStarted,
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

interface CheckWatchPayload {
    watchId: string;
    userId: string;
    manual?: boolean;
}

function nullIfUndefined<T>(value: T | undefined): T | null {
    return value ?? null;
}

function getJitteredBackoffMs(baseBackoffMs: number) {
    const jitterWindow = Math.max(1_000, Math.floor(baseBackoffMs * 0.1));
    return baseBackoffMs + Math.floor(Math.random() * jitterWindow);
}

export async function handleCheckWatch(payload: CheckWatchPayload) {
    const [watch] = await db
        .select()
        .from(watches)
        .where(
            and(
                eq(watches.id, payload.watchId),
                eq(watches.userId, payload.userId),
                isNull(watches.deletedAt),
            ),
        );

    if (!watch || (!watch.isActive && !payload.manual)) {
        console.log(
            `[queue] Watch ${payload.watchId} not found or inactive, skipping`,
        );
        return { skipped: true };
    }

    console.log(
        `[queue] Checking watch ${watch.id}: ${watch.name} (${watch.url})`,
    );

    const attemptStartedAt = new Date();
    const claimed = await markWatchCheckStarted(db, {
        watchId: watch.id,
        userId: payload.userId,
        now: attemptStartedAt,
        leaseMs: watchLeaseMs,
    });

    if (!claimed) {
        console.log(
            `[queue] Watch ${watch.id} no longer has an active claim, skipping`,
        );
        return { skipped: true };
    }

    try {
        const result = await checkWatchWithScraper({
            url: watch.url,
            cssSelector: watch.cssSelector,
            elementFingerprint: watch.elementFingerprint,
        });

        const price = result.price ?? null;
        const stockStatus = nullIfUndefined(result.stock_status);
        const rawContent = nullIfUndefined(result.raw_content);
        const error = nullIfUndefined(result.error);

        await db.insert(checkResults).values({
            watchId: watch.id,
            price: price?.toString() ?? null,
            stockStatus,
            rawContent,
            error,
        });

        if (result.errorType === WATCH_CHECK_ERROR_TYPES.SCRAPER_OVERLOADED) {
            await failWatchCheckWithBackoff(db, {
                watchId: watch.id,
                userId: payload.userId,
                now: new Date(),
                backoffMs: getJitteredBackoffMs(watchOverloadBackoffMs),
                errorType: WATCH_CHECK_ERROR_TYPES.SCRAPER_OVERLOADED,
            });
            return { success: false, retrying: true };
        }

        if (result.errorType === WATCH_CHECK_ERROR_TYPES.TRANSIENT) {
            await failWatchCheckWithBackoff(db, {
                watchId: watch.id,
                userId: payload.userId,
                now: new Date(),
                backoffMs: watchRetryBackoffMs,
                errorType: WATCH_CHECK_ERROR_TYPES.TRANSIENT,
            });
            return { success: false, retrying: true };
        }

        if (result.errorType === WATCH_CHECK_ERROR_TYPES.TERMINAL) {
            await failWatchCheckTerminal(db, {
                watchId: watch.id,
                userId: payload.userId,
                now: new Date(),
                errorType: WATCH_CHECK_ERROR_TYPES.TERMINAL,
            });
            return { success: false, retrying: false };
        }

        const notifications = buildWatchNotifications({
            watch,
            price,
            stockStatus,
        });

        let notificationsSent = 0;
        const now = new Date();

        if (notifications.length > 0) {
            const cooldown = watch.notifyCooldownSeconds;
            const lastNotified = watch.lastNotifiedAt;
            const cooldownElapsed =
                !cooldown ||
                !lastNotified ||
                now.getTime() - lastNotified.getTime() >= cooldown * 1000;

            if (cooldownElapsed || payload.manual) {
                for (const notification of notifications) {
                    await sendTelegramNotification(
                        payload.userId,
                        notification,
                    );
                    await db.insert(sentNotifications).values({
                        userId: payload.userId,
                        watchId: watch.id,
                        message: notification.text,
                        type: notification.type,
                    });
                }
                notificationsSent = notifications.length;
            }
        }

        let nextCheckIntervalSeconds: number | undefined;

        if (watch.autoInterval && watch.baseCheckIntervalSeconds) {
            const recentChecks = await db
                .select({ price: checkResults.price })
                .from(checkResults)
                .where(eq(checkResults.watchId, watch.id))
                .orderBy(desc(checkResults.checkedAt))
                .limit(20);

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
                    console.log(
                        `[queue] Auto-interval for ${watch.id}: CV=${cv.toFixed(4)}, ${watch.checkIntervalSeconds}s -> ${adjustedInterval}s`,
                    );
                }
            }
        }

        await completeWatchCheck(db, {
            watchId: watch.id,
            userId: payload.userId,
            now,
            lastPrice: price?.toString() ?? watch.lastPrice ?? null,
            lastStockStatus: stockStatus ?? watch.lastStockStatus ?? null,
            notificationsSent,
            checkIntervalSeconds: nextCheckIntervalSeconds,
        });

        return { success: true, notifications: notificationsSent };
    } catch (error) {
        await failWatchCheckWithBackoff(db, {
            watchId: watch.id,
            userId: payload.userId,
            now: new Date(),
            backoffMs: watchRetryBackoffMs,
            errorType: WATCH_CHECK_ERROR_TYPES.TRANSIENT,
        });
        throw error;
    }
}

export const __testables = {
    getJitteredBackoffMs,
};
