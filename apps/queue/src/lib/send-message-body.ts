import type { TelegramNotificationPayload } from './telegram';

export function buildTelegramSendMessageBody(
    chatId: string,
    notification: TelegramNotificationPayload,
) {
    return {
        chat_id: chatId,
        text: notification.text,
        parse_mode: 'HTML' as const,
        disable_web_page_preview: true,
        ...(notification.replyMarkup && {
            reply_markup: notification.replyMarkup,
        }),
    };
}
