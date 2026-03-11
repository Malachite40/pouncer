import { notificationSettings } from '@pounce/db/schema';
import type { TelegramNotificationPayload } from '@pounce/trpc/telegram';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import { buildTelegramSendMessageBody } from './send-message-body';

export async function sendTelegramNotification(
    userId: string,
    notification: TelegramNotificationPayload,
) {
    const [settings] = await db
        .select()
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, userId))
        .limit(1);

    if (!settings?.isActive) {
        return;
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = settings.telegramChatId;

    if (!botToken || !chatId) {
        return;
    }

    try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
                buildTelegramSendMessageBody(chatId, notification),
            ),
        });
    } catch (error) {
        console.error('[queue] Failed to send Telegram notification:', error);
    }
}
