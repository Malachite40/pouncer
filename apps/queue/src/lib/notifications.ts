import { notificationSettings } from '@pounce/db/schema';
import { eq } from 'drizzle-orm';

import { db } from '../db';

export async function sendTelegramNotification(
    userId: string,
    message: string,
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
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            }),
        });
    } catch (error) {
        console.error('[queue] Failed to send Telegram notification:', error);
    }
}
