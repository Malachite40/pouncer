import { checkResults, watches } from '@pounce/db/schema';
import { and, count, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { enqueueWatchCheck } from '../queue/enqueue';
import { authenticatedProcedure, createTRPCRouter } from '../trpc';

const BOARD_HISTORY_LIMIT = 24;

function mergeCheckType(a: string, b: string): 'price' | 'stock' | 'both' {
    if (a === 'both' || b === 'both') return 'both';
    if (a === b) return a as 'price' | 'stock';
    return 'both';
}

export const watchRouter = createTRPCRouter({
    findByUrl: authenticatedProcedure
        .input(z.object({ url: z.string().url() }))
        .query(async ({ ctx, input }) => {
            const [watch] = await ctx.db
                .select()
                .from(watches)
                .where(
                    and(
                        eq(watches.userId, ctx.userId),
                        eq(watches.url, input.url),
                    ),
                );
            return watch ?? null;
        }),

    create: authenticatedProcedure
        .input(
            z.object({
                url: z.string().url(),
                name: z.string().min(1),
                checkType: z.enum(['price', 'stock', 'both']).default('both'),
                cssSelector: z.string().nullable().optional(),
                checkIntervalSeconds: z
                    .number()
                    .refine((v) =>
                        [
                            5, 10, 30, 60, 300, 900, 1800, 3600, 21600, 43200,
                            86400,
                        ].includes(v),
                    )
                    .default(900),
                notifyPriceDrop: z.boolean().default(true),
                notifyPriceIncrease: z.boolean().default(true),
                notifyStock: z.boolean().default(true),
                priceDropThreshold: z.number().positive().nullable().optional(),
                priceDropPercentThreshold: z.number().positive().max(100).nullable().optional(),
                priceDropTargetPrice: z.number().positive().nullable().optional(),
                priceIncreaseThreshold: z.number().positive().nullable().optional(),
                priceIncreasePercentThreshold: z.number().positive().max(100).nullable().optional(),
                priceIncreaseTargetPrice: z.number().positive().nullable().optional(),
                notifyCooldownSeconds: z.number().int().positive().nullable().optional(),
                skipMerge: z.boolean().default(false),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            if (!input.skipMerge) {
                const [existing] = await ctx.db
                    .select()
                    .from(watches)
                    .where(
                        and(
                            eq(watches.userId, ctx.userId),
                            eq(watches.url, input.url),
                        ),
                    );

                if (existing) {
                    const mergedType = mergeCheckType(
                        existing.checkType,
                        input.checkType,
                    );
                    const [updated] = await ctx.db
                        .update(watches)
                        .set({
                            name: input.name,
                            checkType: mergedType,
                            cssSelector:
                                input.cssSelector ?? existing.cssSelector,
                            checkIntervalSeconds: input.checkIntervalSeconds,
                            notifyPriceDrop: input.notifyPriceDrop,
                            notifyPriceIncrease: input.notifyPriceIncrease,
                            notifyStock: input.notifyStock,
                            priceDropThreshold: input.priceDropThreshold?.toString() ?? null,
                            priceDropPercentThreshold: input.priceDropPercentThreshold?.toString() ?? null,
                            priceDropTargetPrice: input.priceDropTargetPrice?.toString() ?? null,
                            priceIncreaseThreshold: input.priceIncreaseThreshold?.toString() ?? null,
                            priceIncreasePercentThreshold: input.priceIncreasePercentThreshold?.toString() ?? null,
                            priceIncreaseTargetPrice: input.priceIncreaseTargetPrice?.toString() ?? null,
                            notifyCooldownSeconds: input.notifyCooldownSeconds ?? null,
                            isActive: true,
                            updatedAt: new Date(),
                        })
                        .where(eq(watches.id, existing.id))
                        .returning();
                    await enqueueWatchCheck(
                        {
                            watchId: updated.id,
                            userId: ctx.userId,
                        },
                        {
                            replaceExisting: true,
                            removeOnComplete: true,
                            removeOnFail: true,
                        },
                    );
                    return { ...updated, merged: true };
                }
            }

            const [watch] = await ctx.db
                .insert(watches)
                .values({
                    url: input.url,
                    name: input.name,
                    checkType: input.checkType,
                    cssSelector: input.cssSelector ?? null,
                    checkIntervalSeconds: input.checkIntervalSeconds,
                    notifyPriceDrop: input.notifyPriceDrop,
                    notifyPriceIncrease: input.notifyPriceIncrease,
                    notifyStock: input.notifyStock,
                    priceDropThreshold: input.priceDropThreshold?.toString() ?? null,
                    priceDropPercentThreshold: input.priceDropPercentThreshold?.toString() ?? null,
                    priceDropTargetPrice: input.priceDropTargetPrice?.toString() ?? null,
                    priceIncreaseThreshold: input.priceIncreaseThreshold?.toString() ?? null,
                    priceIncreasePercentThreshold: input.priceIncreasePercentThreshold?.toString() ?? null,
                    priceIncreaseTargetPrice: input.priceIncreaseTargetPrice?.toString() ?? null,
                    notifyCooldownSeconds: input.notifyCooldownSeconds ?? null,
                    userId: ctx.userId,
                })
                .returning();
            await enqueueWatchCheck(
                {
                    watchId: watch.id,
                    userId: ctx.userId,
                },
                {
                    replaceExisting: true,
                    removeOnComplete: true,
                    removeOnFail: true,
                },
            );
            return { ...watch, merged: false };
        }),

    list: authenticatedProcedure.query(async ({ ctx }) => {
        return ctx.db
            .select()
            .from(watches)
            .where(eq(watches.userId, ctx.userId))
            .orderBy(desc(watches.createdAt));
    }),

    getMany: authenticatedProcedure.query(async ({ ctx }) => {
        const watchList = await ctx.db
            .select()
            .from(watches)
            .where(eq(watches.userId, ctx.userId))
            .orderBy(desc(watches.createdAt));

        if (!watchList.length) {
            return [];
        }

        const rankedHistory = ctx.db
            .select({
                watchId: checkResults.watchId,
                price: checkResults.price,
                stockStatus: checkResults.stockStatus,
                checkedAt: checkResults.checkedAt,
                historyRank: sql<number>`row_number() over (
                    partition by ${checkResults.watchId}
                    order by ${checkResults.checkedAt} desc
                )`.as('history_rank'),
            })
            .from(checkResults)
            .where(
                inArray(
                    checkResults.watchId,
                    watchList.map((watch) => watch.id),
                ),
            )
            .as('ranked_history');

        const historyRows = await ctx.db
            .select({
                watchId: rankedHistory.watchId,
                price: rankedHistory.price,
                stockStatus: rankedHistory.stockStatus,
                checkedAt: rankedHistory.checkedAt,
            })
            .from(rankedHistory)
            .where(lte(rankedHistory.historyRank, BOARD_HISTORY_LIMIT))
            .orderBy(rankedHistory.watchId, rankedHistory.checkedAt);

        const historyByWatchId = new Map<
            string,
            Array<{
                checkedAt: Date;
                price: string | null;
                stockStatus: string | null;
            }>
        >();

        for (const row of historyRows) {
            const existingRows = historyByWatchId.get(row.watchId) ?? [];
            existingRows.push({
                checkedAt: row.checkedAt,
                price: row.price,
                stockStatus: row.stockStatus,
            });
            historyByWatchId.set(row.watchId, existingRows);
        }

        return watchList.map((watch) => ({
            ...watch,
            history: historyByWatchId.get(watch.id) ?? [],
        }));
    }),

    get: authenticatedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .query(async ({ ctx, input }) => {
            const [watch] = await ctx.db
                .select()
                .from(watches)
                .where(
                    and(
                        eq(watches.id, input.id),
                        eq(watches.userId, ctx.userId),
                    ),
                );
            if (!watch) return null;

            const history = await ctx.db
                .select({
                    price: checkResults.price,
                    stockStatus: checkResults.stockStatus,
                    checkedAt: checkResults.checkedAt,
                })
                .from(checkResults)
                .where(eq(checkResults.watchId, input.id))
                .orderBy(desc(checkResults.checkedAt))
                .limit(24);

            return { ...watch, history };
        }),

    history: authenticatedProcedure
        .input(
            z.object({
                watchId: z.string().uuid(),
                page: z.number().int().positive().default(1),
                pageSize: z.number().int().positive().max(100).default(25),
            }),
        )
        .query(async ({ ctx, input }) => {
            const { watchId, page, pageSize } = input;

            const [watch] = await ctx.db
                .select({ id: watches.id })
                .from(watches)
                .where(
                    and(
                        eq(watches.id, watchId),
                        eq(watches.userId, ctx.userId),
                    ),
                );
            if (!watch) return { items: [], page, totalItems: 0, totalPages: 0 };

            const offset = (page - 1) * pageSize;

            const [items, [countResult]] = await Promise.all([
                ctx.db
                    .select()
                    .from(checkResults)
                    .where(eq(checkResults.watchId, watchId))
                    .orderBy(desc(checkResults.checkedAt))
                    .limit(pageSize)
                    .offset(offset),
                ctx.db
                    .select({ total: count() })
                    .from(checkResults)
                    .where(eq(checkResults.watchId, watchId)),
            ]);

            const totalItems = countResult?.total ?? 0;
            const totalPages = Math.ceil(totalItems / pageSize);

            return { items, page, totalItems, totalPages };
        }),

    update: authenticatedProcedure
        .input(
            z.object({
                id: z.string().uuid(),
                name: z.string().min(1).optional(),
                checkType: z.enum(['price', 'stock', 'both']).optional(),
                cssSelector: z.string().nullable().optional(),
                isActive: z.boolean().optional(),
                checkIntervalSeconds: z
                    .number()
                    .refine((v) =>
                        [
                            5, 10, 30, 60, 300, 900, 1800, 3600, 21600, 43200,
                            86400,
                        ].includes(v),
                    )
                    .optional(),
                notifyPriceDrop: z.boolean().optional(),
                notifyPriceIncrease: z.boolean().optional(),
                notifyStock: z.boolean().optional(),
                priceDropThreshold: z.number().positive().nullable().optional(),
                priceDropPercentThreshold: z.number().positive().max(100).nullable().optional(),
                priceDropTargetPrice: z.number().positive().nullable().optional(),
                priceIncreaseThreshold: z.number().positive().nullable().optional(),
                priceIncreasePercentThreshold: z.number().positive().max(100).nullable().optional(),
                priceIncreaseTargetPrice: z.number().positive().nullable().optional(),
                notifyCooldownSeconds: z.number().int().positive().nullable().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const {
                id,
                priceDropThreshold,
                priceDropPercentThreshold,
                priceDropTargetPrice,
                priceIncreaseThreshold,
                priceIncreasePercentThreshold,
                priceIncreaseTargetPrice,
                notifyCooldownSeconds,
                ...data
            } = input;
            const numericFields = {
                ...(priceDropThreshold !== undefined && {
                    priceDropThreshold: priceDropThreshold?.toString() ?? null,
                }),
                ...(priceDropPercentThreshold !== undefined && {
                    priceDropPercentThreshold: priceDropPercentThreshold?.toString() ?? null,
                }),
                ...(priceDropTargetPrice !== undefined && {
                    priceDropTargetPrice: priceDropTargetPrice?.toString() ?? null,
                }),
                ...(priceIncreaseThreshold !== undefined && {
                    priceIncreaseThreshold: priceIncreaseThreshold?.toString() ?? null,
                }),
                ...(priceIncreasePercentThreshold !== undefined && {
                    priceIncreasePercentThreshold: priceIncreasePercentThreshold?.toString() ?? null,
                }),
                ...(priceIncreaseTargetPrice !== undefined && {
                    priceIncreaseTargetPrice: priceIncreaseTargetPrice?.toString() ?? null,
                }),
                ...(notifyCooldownSeconds !== undefined && {
                    notifyCooldownSeconds: notifyCooldownSeconds ?? null,
                }),
            };
            const [updated] = await ctx.db
                .update(watches)
                .set({
                    ...data,
                    ...numericFields,
                    updatedAt: new Date(),
                })
                .where(and(eq(watches.id, id), eq(watches.userId, ctx.userId)))
                .returning();

            if (
                updated?.isActive &&
                (Object.hasOwn(data, 'checkIntervalSeconds') ||
                    data.isActive === true)
            ) {
                await enqueueWatchCheck(
                    {
                        watchId: updated.id,
                        userId: ctx.userId,
                    },
                    {
                        replaceExisting: true,
                        removeOnComplete: true,
                        removeOnFail: true,
                    },
                );
            }

            return updated;
        }),

    delete: authenticatedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            await ctx.db
                .delete(watches)
                .where(
                    and(
                        eq(watches.id, input.id),
                        eq(watches.userId, ctx.userId),
                    ),
                );
            return { success: true };
        }),

    checkNow: authenticatedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const [watch] = await ctx.db
                .select()
                .from(watches)
                .where(
                    and(
                        eq(watches.id, input.id),
                        eq(watches.userId, ctx.userId),
                    ),
                );
            if (!watch) {
                throw new Error('Watch not found');
            }
            await enqueueWatchCheck(
                {
                    watchId: input.id,
                    userId: ctx.userId,
                    manual: true,
                },
                {
                    replaceExisting: true,
                    removeOnComplete: true,
                    removeOnFail: true,
                },
            );
            return { queued: true };
        }),
});
