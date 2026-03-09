import { checkResults, watches } from '@pounce/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '../db';
import { sendTelegramNotification } from '../lib/notifications';
import { checkWatchWithScraper } from '../lib/scraper';
import {
    computeVolatility,
    getAdjustedIntervalTier,
} from '../lib/volatility';
import { buildWatchNotifications } from '../lib/watch-notifications';

interface CheckWatchPayload {
    watchId: string;
    userId: string;
    manual?: boolean;
}

function nullIfUndefined<T>(value: T | undefined): T | null {
    return value ?? null;
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
                await sendTelegramNotification(payload.userId, notification);
            }
            notificationsSent = notifications.length;
        }
    }

    const autoIntervalUpdate: Record<string, unknown> = {};

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
                autoIntervalUpdate.checkIntervalSeconds = adjustedInterval;
                console.log(
                    `[queue] Auto-interval for ${watch.id}: CV=${cv.toFixed(4)}, ${watch.checkIntervalSeconds}s -> ${adjustedInterval}s`,
                );
            }
        }
    }

    await db
        .update(watches)
        .set({
            lastPrice: price?.toString() ?? watch.lastPrice ?? null,
            lastStockStatus: stockStatus ?? watch.lastStockStatus ?? null,
            lastCheckedAt: now,
            ...(notificationsSent > 0 && { lastNotifiedAt: now }),
            ...autoIntervalUpdate,
            updatedAt: now,
        })
        .where(eq(watches.id, watch.id));

    return { success: true, notifications: notificationsSent };
}
