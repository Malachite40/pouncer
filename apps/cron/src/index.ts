import 'dotenv/config';

import { getDb } from '@pounce/db';
import { watches } from '@pounce/db/schema';
import { enqueueWatchCheck } from '@pounce/trpc/queue';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import cron from 'node-cron';

const db = getDb();

console.log('Pounce cron scheduler starting...');

// Check due watches every 5 seconds
cron.schedule('*/5 * * * * *', async () => {
    try {
        const now = new Date();
        const dueWatches = await db
            .select()
            .from(watches)
            .where(
                and(
                    eq(watches.isActive, true),
                    or(
                        isNull(watches.lastCheckedAt),
                        lte(
                            sql`${watches.lastCheckedAt} + make_interval(secs => ${watches.checkIntervalSeconds})`,
                            now.toISOString(),
                        ),
                    ),
                ),
            );

        if (dueWatches.length > 0) {
            console.log(
                `[cron] ${now.toISOString()} — Enqueueing checks for ${dueWatches.length} due watches`,
            );
        }

        for (let i = 0; i < dueWatches.length; i++) {
            const watch = dueWatches[i];

            if (!watch.userId) {
                console.warn(
                    `[cron] Skipping watch ${watch.id} because it has no user id`,
                );
                continue;
            }

            await enqueueWatchCheck(
                { watchId: watch.id, userId: watch.userId },
                {
                    delay: i * 2000, // stagger by 2 seconds
                    removeOnComplete: true,
                    removeOnFail: true,
                },
            );
        }
    } catch (error) {
        console.error('[cron] Error enqueueing watch checks:', error);
    }
});

console.log('Pounce cron scheduler ready. Checks run every 5 seconds.');
