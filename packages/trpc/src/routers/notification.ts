import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { notificationSettings } from '@pounce/db/schema';
import { createTRPCRouter, authenticatedProcedure } from '../trpc';

export const notificationRouter = createTRPCRouter({
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
                    text: 'Pounce test notification - everything is working!',
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
