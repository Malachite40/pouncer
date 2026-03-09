import { eq, and, desc, count } from 'drizzle-orm';
import { z } from 'zod';
import { notificationSettings, sentNotifications, watches } from '@pounce/db/schema';
import { createTRPCRouter, authenticatedProcedure } from '../trpc';

export const notificationRouter = createTRPCRouter({
    history: authenticatedProcedure
        .input(
            z.object({
                page: z.number().int().positive().default(1),
                pageSize: z.number().int().positive().max(100).default(50),
            }).default({}),
        )
        .query(async ({ ctx, input }) => {
            const { page, pageSize } = input;
            const offset = (page - 1) * pageSize;

            const [items, [countResult]] = await Promise.all([
                ctx.db
                    .select({
                        id: sentNotifications.id,
                        message: sentNotifications.message,
                        type: sentNotifications.type,
                        sentAt: sentNotifications.sentAt,
                        watchId: sentNotifications.watchId,
                        watchName: watches.name,
                        watchUrl: watches.url,
                    })
                    .from(sentNotifications)
                    .leftJoin(watches, eq(sentNotifications.watchId, watches.id))
                    .where(eq(sentNotifications.userId, ctx.userId))
                    .orderBy(desc(sentNotifications.sentAt))
                    .limit(pageSize)
                    .offset(offset),
                ctx.db
                    .select({ total: count() })
                    .from(sentNotifications)
                    .where(eq(sentNotifications.userId, ctx.userId)),
            ]);

            const totalItems = countResult?.total ?? 0;
            const totalPages = Math.ceil(totalItems / pageSize);

            return { items, page, totalItems, totalPages };
        }),

    getSettings: authenticatedProcedure.query(async ({ ctx }) => {
        const [settings] = await ctx.db
            .select()
            .from(notificationSettings)
            .where(eq(notificationSettings.userId, ctx.userId))
            .limit(1);
        return settings ?? null;
    }),

    updateSettings: authenticatedProcedure
        .input(
            z.object({
                telegramChatId: z.string().min(1),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const [existing] = await ctx.db
                .select()
                .from(notificationSettings)
                .where(eq(notificationSettings.userId, ctx.userId))
                .limit(1);

            if (existing) {
                const [updated] = await ctx.db
                    .update(notificationSettings)
                    .set(input)
                    .where(
                        and(
                            eq(notificationSettings.id, existing.id),
                            eq(notificationSettings.userId, ctx.userId),
                        ),
                    )
                    .returning();
                return updated;
            }

            const [created] = await ctx.db
                .insert(notificationSettings)
                .values({ ...input, userId: ctx.userId })
                .returning();
            return created;
        }),

    testSendType: authenticatedProcedure
        .input(
            z.object({
                type: z.enum([
                    'price_drop',
                    'price_drop_target',
                    'price_increase',
                    'price_increase_target',
                    'back_in_stock',
                    'out_of_stock',
                ]),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const [settings] = await ctx.db
                .select()
                .from(notificationSettings)
                .where(eq(notificationSettings.userId, ctx.userId))
                .limit(1);

            if (!settings) {
                throw new Error('No notification settings configured');
            }

            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (!botToken) {
                throw new Error('Telegram bot token is not configured');
            }

            const name = 'Sample Product';
            const url = 'https://www.google.com';

            const SAMPLE_NOTIFICATIONS: Record<string, string> = {
                price_drop: `🟢 <b>Price Drop!</b> · <a href="${url}">View Product</a>\n\n<b>${name}</b>\n$129.99 → <b>$89.99</b> (-$40.00 · 31% off)`,
                price_drop_target: `🟢 <b>Price Drop!</b> · <a href="${url}">View Product</a>\n\n<b>${name}</b>\n$129.99 → <b>$89.99</b> (-$40.00 · 31% off)\n✅ Below target price $99.00`,
                price_increase: `🔴 <b>Price Increase</b> · <a href="${url}">View Product</a>\n\n<b>${name}</b>\n$89.99 → <b>$109.99</b> (+$20.00 · 22% up)`,
                price_increase_target: `🔴 <b>Price Increase</b> · <a href="${url}">View Product</a>\n\n<b>${name}</b>\n$89.99 → <b>$109.99</b> (+$20.00 · 22% up)\n⚠️ Above target price $100.00`,
                back_in_stock: `🟢 <b>Back in Stock!</b> · <a href="${url}">View Product</a>\n\n<b>${name}</b>`,
                out_of_stock: `⚪ <b>Out of Stock</b> · <a href="${url}">View Product</a>\n\n<b>${name}</b>`,
            };

            const message = SAMPLE_NOTIFICATIONS[input.type];
            if (!message) {
                throw new Error(`Unknown notification type: ${input.type}`);
            }

            const response = await fetch(
                `https://api.telegram.org/bot${botToken}/sendMessage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: settings.telegramChatId,
                        text: message,
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                    }),
                },
            );

            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`Telegram API error: ${errorData}`);
            }

            return { success: true };
        }),

    testSend: authenticatedProcedure.mutation(async ({ ctx }) => {
        const [settings] = await ctx.db
            .select()
            .from(notificationSettings)
            .where(eq(notificationSettings.userId, ctx.userId))
            .limit(1);

        if (!settings) {
            throw new Error('No notification settings configured');
        }

        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
            throw new Error('Telegram bot token is not configured');
        }

        const response = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: settings.telegramChatId,
                    text: '🟢 <b>Pounce Test</b>\n\nNotifications are working! You\'ll receive alerts here when your watched products change.',
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                }),
            },
        );

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Telegram API error: ${errorData}`);
        }

        return { success: true };
    }),
});
