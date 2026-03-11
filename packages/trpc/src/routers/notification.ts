import {
    notificationSettings,
    sentNotifications,
    watches,
} from '@pounce/db/schema';
import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { buildTelegramTestPayload } from '../telegram';
import { authenticatedProcedure, createTRPCRouter } from '../trpc';

export const notificationRouter = createTRPCRouter({
    history: authenticatedProcedure
        .input(
            z
                .object({
                    page: z.number().int().positive().default(1),
                    pageSize: z.number().int().positive().max(100).default(50),
                })
                .default({}),
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
                    .leftJoin(
                        watches,
                        eq(sentNotifications.watchId, watches.id),
                    )
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

            const notification = buildTelegramTestPayload({
                type: input.type,
                watch: {
                    id: '00000000-0000-0000-0000-000000000001',
                    name: 'Sample Product',
                    url: 'https://www.google.com',
                },
            });

            const response = await fetch(
                `https://api.telegram.org/bot${botToken}/sendMessage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: settings.telegramChatId,
                        text: notification.text,
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                        ...(notification.replyMarkup && {
                            reply_markup: notification.replyMarkup,
                        }),
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

        const notification = buildTelegramTestPayload({
            type: 'back_in_stock',
            watch: {
                id: '00000000-0000-0000-0000-000000000001',
                name: 'Pounce Test',
                url: 'https://www.google.com',
            },
        });

        const response = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: settings.telegramChatId,
                    text: notification.text.replace(
                        'Stock signal recovered.',
                        "Notifications are working. You'll receive alerts here when your watched products change.",
                    ),
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    ...(notification.replyMarkup && {
                        reply_markup: notification.replyMarkup,
                    }),
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
