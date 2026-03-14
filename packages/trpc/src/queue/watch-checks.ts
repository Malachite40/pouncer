import type { getDb } from '@pounce/db';
import { watches } from '@pounce/db/schema';
import {
    and,
    eq,
    gte,
    inArray,
    isNotNull,
    isNull,
    lte,
    or,
    sql,
} from 'drizzle-orm';

type Database = ReturnType<typeof getDb>;

export const WATCH_CHECK_ERROR_TYPES = {
    SCRAPER_OVERLOADED: 'scraper_overloaded',
    TRANSIENT: 'transient',
    TERMINAL: 'terminal',
} as const;

export type WatchCheckErrorType =
    (typeof WATCH_CHECK_ERROR_TYPES)[keyof typeof WATCH_CHECK_ERROR_TYPES];

export interface ClaimedWatch {
    id: string;
    userId: string | null;
}

function getLeaseExpiry(now: Date, leaseMs: number) {
    return new Date(now.getTime() + leaseMs);
}

export async function claimDueWatchesForScheduling(
    db: Database,
    {
        now,
        limit,
        leaseMs,
    }: {
        now: Date;
        limit: number;
        leaseMs: number;
    },
): Promise<ClaimedWatch[]> {
    const candidates = await db
        .select({
            id: watches.id,
            userId: watches.userId,
        })
        .from(watches)
        .where(
            and(
                eq(watches.isActive, true),
                isNull(watches.deletedAt),
                or(
                    isNull(watches.lastCheckedAt),
                    lte(
                        sql`${watches.lastCheckedAt} + make_interval(secs => ${watches.checkIntervalSeconds})`,
                        now.toISOString(),
                    ),
                ),
                or(
                    isNull(watches.checkLeaseExpiresAt),
                    lte(watches.checkLeaseExpiresAt, now),
                ),
            ),
        )
        .limit(limit);

    const claimed: ClaimedWatch[] = [];

    for (const candidate of candidates) {
        const [updated] = await db
            .update(watches)
            .set({
                checkQueuedAt: now,
                checkStartedAt: null,
                checkLeaseExpiresAt: getLeaseExpiry(now, leaseMs),
                updatedAt: now,
            })
            .where(
                and(
                    eq(watches.id, candidate.id),
                    or(
                        isNull(watches.checkLeaseExpiresAt),
                        lte(watches.checkLeaseExpiresAt, now),
                    ),
                ),
            )
            .returning({
                id: watches.id,
                userId: watches.userId,
            });

        if (updated) {
            claimed.push(updated);
        }
    }

    return claimed;
}

export async function claimWatchCheck(
    db: Database,
    {
        watchId,
        userId,
        now,
        leaseMs,
        allowInactive = false,
    }: {
        watchId: string;
        userId: string;
        now: Date;
        leaseMs: number;
        allowInactive?: boolean;
    },
): Promise<boolean> {
    const baseConditions = [
        eq(watches.id, watchId),
        eq(watches.userId, userId),
        isNull(watches.deletedAt),
        or(
            isNull(watches.checkLeaseExpiresAt),
            lte(watches.checkLeaseExpiresAt, now),
        ),
    ];

    if (!allowInactive) {
        baseConditions.push(eq(watches.isActive, true));
    }

    const [updated] = await db
        .update(watches)
        .set({
            checkQueuedAt: now,
            checkStartedAt: null,
            checkLeaseExpiresAt: getLeaseExpiry(now, leaseMs),
            updatedAt: now,
        })
        .where(and(...baseConditions))
        .returning({ id: watches.id });

    return Boolean(updated);
}

export async function markWatchCheckStarted(
    db: Database,
    {
        watchId,
        userId,
        now,
        leaseMs,
    }: {
        watchId: string;
        userId: string;
        now: Date;
        leaseMs: number;
    },
): Promise<boolean> {
    const [updated] = await db
        .update(watches)
        .set({
            checkStartedAt: now,
            checkLeaseExpiresAt: getLeaseExpiry(now, leaseMs),
            lastCheckAttemptAt: now,
            updatedAt: now,
        })
        .where(
            and(
                eq(watches.id, watchId),
                eq(watches.userId, userId),
                isNull(watches.deletedAt),
                isNotNull(watches.checkQueuedAt),
                gte(watches.checkLeaseExpiresAt, now),
            ),
        )
        .returning({ id: watches.id });

    return Boolean(updated);
}

export async function touchWatchCheckLease(
    db: Database,
    {
        watchId,
        userId,
        now,
        leaseMs,
    }: {
        watchId: string;
        userId: string;
        now: Date;
        leaseMs: number;
    },
) {
    await db
        .update(watches)
        .set({
            checkLeaseExpiresAt: getLeaseExpiry(now, leaseMs),
            updatedAt: now,
        })
        .where(
            and(
                eq(watches.id, watchId),
                eq(watches.userId, userId),
                isNull(watches.deletedAt),
                isNotNull(watches.checkStartedAt),
                gte(watches.checkLeaseExpiresAt, now),
            ),
        );
}

export async function completeWatchCheck(
    db: Database,
    {
        watchId,
        userId,
        now,
        lastPrice,
        lastStockStatus,
        notificationsSent,
        checkIntervalSeconds,
    }: {
        watchId: string;
        userId: string;
        now: Date;
        lastPrice: string | null;
        lastStockStatus: string | null;
        notificationsSent: number;
        checkIntervalSeconds?: number;
    },
) {
    await db
        .update(watches)
        .set({
            lastPrice,
            lastStockStatus,
            lastCheckedAt: now,
            checkQueuedAt: null,
            checkStartedAt: null,
            checkLeaseExpiresAt: null,
            lastCheckErrorType: null,
            ...(notificationsSent > 0 && { lastNotifiedAt: now }),
            ...(checkIntervalSeconds !== undefined && {
                checkIntervalSeconds,
            }),
            updatedAt: now,
        })
        .where(and(eq(watches.id, watchId), eq(watches.userId, userId)));
}

export async function failWatchCheckWithBackoff(
    db: Database,
    {
        watchId,
        userId,
        now,
        backoffMs,
        errorType,
    }: {
        watchId: string;
        userId: string;
        now: Date;
        backoffMs: number;
        errorType: WatchCheckErrorType;
    },
) {
    await db
        .update(watches)
        .set({
            checkQueuedAt: null,
            checkStartedAt: null,
            checkLeaseExpiresAt: new Date(now.getTime() + backoffMs),
            lastCheckErrorType: errorType,
            updatedAt: now,
        })
        .where(and(eq(watches.id, watchId), eq(watches.userId, userId)));
}

export async function failWatchCheckTerminal(
    db: Database,
    {
        watchId,
        userId,
        now,
        errorType,
    }: {
        watchId: string;
        userId: string;
        now: Date;
        errorType: WatchCheckErrorType;
    },
) {
    await db
        .update(watches)
        .set({
            lastCheckedAt: now,
            checkQueuedAt: null,
            checkStartedAt: null,
            checkLeaseExpiresAt: null,
            lastCheckErrorType: errorType,
            updatedAt: now,
        })
        .where(and(eq(watches.id, watchId), eq(watches.userId, userId)));
}

export async function releaseWatchCheckClaim(
    db: Database,
    {
        watchId,
        userId,
        now,
    }: {
        watchId: string;
        userId: string;
        now: Date;
    },
) {
    await db
        .update(watches)
        .set({
            checkQueuedAt: null,
            checkStartedAt: null,
            checkLeaseExpiresAt: null,
            updatedAt: now,
        })
        .where(and(eq(watches.id, watchId), eq(watches.userId, userId)));
}

export async function recoverExpiredWatchClaims(
    db: Database,
    { now }: { now: Date },
) {
    const recovered = await db
        .update(watches)
        .set({
            checkQueuedAt: null,
            checkStartedAt: null,
            updatedAt: now,
        })
        .where(
            and(
                isNull(watches.deletedAt),
                or(
                    isNotNull(watches.checkQueuedAt),
                    isNotNull(watches.checkStartedAt),
                ),
                lte(watches.checkLeaseExpiresAt, now),
            ),
        )
        .returning({ id: watches.id });

    return recovered.length;
}

export async function releaseClaimsForWatches(
    db: Database,
    { watchIds, now }: { watchIds: string[]; now: Date },
) {
    if (watchIds.length === 0) {
        return;
    }

    await db
        .update(watches)
        .set({
            checkQueuedAt: null,
            checkStartedAt: null,
            checkLeaseExpiresAt: null,
            updatedAt: now,
        })
        .where(inArray(watches.id, watchIds));
}
