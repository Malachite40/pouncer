import 'dotenv/config';

import { getDb } from '@pounce/db';
import {
    claimDueWatchesForScheduling,
    enqueueWatchCheck,
    recoverExpiredWatchClaims,
    releaseClaimsForWatches,
} from '@pounce/trpc/queue';
import cron from 'node-cron';

const db = getDb();

function parsePositiveInt(value: string | undefined, fallback: number) {
    if (!value) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
        return fallback;
    }

    return parsed;
}

const schedulerBatchSize = parsePositiveInt(
    process.env.WATCH_SCHEDULER_BATCH_SIZE,
    25,
);
const watchLeaseMs = parsePositiveInt(
    process.env.WATCH_CHECK_LEASE_MS,
    120_000,
);

console.log('Pounce cron scheduler starting...');

// Check due watches every 5 seconds
cron.schedule('*/5 * * * * *', async () => {
    try {
        const now = new Date();
        const recoveredClaims = await recoverExpiredWatchClaims(db, { now });
        if (recoveredClaims > 0) {
            console.log(
                `[cron] ${now.toISOString()} — Recovered ${recoveredClaims} expired watch claims`,
            );
        }

        const claimedWatches = await claimDueWatchesForScheduling(db, {
            now,
            limit: schedulerBatchSize,
            leaseMs: watchLeaseMs,
        });

        if (claimedWatches.length > 0) {
            console.log(
                `[cron] ${now.toISOString()} — Enqueueing checks for ${claimedWatches.length} claimed watches`,
            );
        }

        for (let i = 0; i < claimedWatches.length; i++) {
            const watch = claimedWatches[i];
            if (!watch.userId) {
                console.warn(
                    `[cron] Skipping watch ${watch.id} because it has no user id`,
                );
                continue;
            }

            try {
                await enqueueWatchCheck(
                    { watchId: watch.id, userId: watch.userId },
                    {
                        replaceExisting: true,
                        delay: i * 2000, // stagger by 2 seconds
                        removeOnComplete: true,
                        removeOnFail: true,
                    },
                );
            } catch (error) {
                await releaseClaimsForWatches(db, {
                    watchIds: [watch.id],
                    now: new Date(),
                });
                throw error;
            }
        }

        const orphanedClaims = claimedWatches
            .filter((watch) => !watch.userId)
            .map((watch) => watch.id);
        if (orphanedClaims.length > 0) {
            await releaseClaimsForWatches(db, {
                watchIds: orphanedClaims,
                now: new Date(),
            });
        }
    } catch (error) {
        console.error('[cron] Error enqueueing watch checks:', error);
    }
});

console.log('Pounce cron scheduler ready. Checks run every 5 seconds.');
