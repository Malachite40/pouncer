import { checkResults, watches } from '@pounce/db/schema';
import { and, eq } from 'drizzle-orm';

import { db } from '../db';
import { sendTelegramNotification } from '../lib/notifications';
import { checkWatchWithScraper } from '../lib/scraper';
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

    for (const notification of notifications) {
        await sendTelegramNotification(payload.userId, notification);
    }

    await db
        .update(watches)
        .set({
            lastPrice: price?.toString() ?? watch.lastPrice ?? null,
            lastStockStatus: stockStatus ?? watch.lastStockStatus ?? null,
            lastCheckedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(watches.id, watch.id));

    return { success: true, notifications: notifications.length };
}
