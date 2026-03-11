interface TelegramInlineButton {
    text: string;
    url: string;
}

interface TelegramReplyMarkup {
    inline_keyboard: TelegramInlineButton[][];
}

export interface TelegramNotificationPayload {
    text: string;
    type: TelegramNotificationType;
    replyMarkup?: TelegramReplyMarkup;
}

export type TelegramNotificationType =
    | 'price_drop'
    | 'price_drop_target'
    | 'price_increase'
    | 'price_increase_target'
    | 'back_in_stock'
    | 'out_of_stock';

export interface TelegramWatchContext {
    id: string;
    name: string;
    url: string;
}

export function escapeTelegramHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function getAppUrl(): string {
    return (
        process.env.NEXT_PUBLIC_BETTER_AUTH_URL ??
        process.env.BETTER_AUTH_URL ??
        'http://localhost:3000'
    ).replace(/\/+$/, '');
}

function isTelegramSafeUrl(value: string): boolean {
    try {
        const url = new URL(value);

        if (url.protocol !== 'https:') {
            return false;
        }

        const hostname = url.hostname.toLowerCase();
        if (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '0.0.0.0' ||
            hostname === '::1'
        ) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}

export function buildWatchDetailUrl(watchId: string): string | null {
    const appUrl = getAppUrl();

    if (!isTelegramSafeUrl(appUrl)) {
        return null;
    }

    return `${appUrl}/watches/${watchId}`;
}

export function buildTelegramInlineKeyboard(
    watch: TelegramWatchContext,
): TelegramReplyMarkup {
    const buttons: TelegramInlineButton[] = [
        { text: 'View Product', url: watch.url },
    ];
    const watchDetailUrl = buildWatchDetailUrl(watch.id);

    if (watchDetailUrl) {
        buttons.push({ text: 'Open in Pounce', url: watchDetailUrl });
    }

    return {
        inline_keyboard: [buttons],
    };
}

export function buildPriceDropNotification(input: {
    watch: TelegramWatchContext;
    previousPrice: number;
    currentPrice: number;
    targetPrice?: number | null;
}): TelegramNotificationPayload {
    const { watch, previousPrice, currentPrice, targetPrice } = input;
    const drop = previousPrice - currentPrice;
    const pct =
        previousPrice !== 0 ? Math.round((drop / previousPrice) * 100) : 0;
    let text =
        `🟢 <b>Price Drop</b>\n<b>${escapeTelegramHtml(watch.name)}</b>\n` +
        `$${previousPrice.toFixed(2)} → <b>$${currentPrice.toFixed(2)}</b> (-$${drop.toFixed(2)} · ${pct}% off)`;

    if (targetPrice !== null && targetPrice !== undefined) {
        text += `\n✅ Below target price $${targetPrice.toFixed(2)}`;
    }

    return {
        type:
            targetPrice !== null && targetPrice !== undefined
                ? 'price_drop_target'
                : 'price_drop',
        text,
        replyMarkup: buildTelegramInlineKeyboard(watch),
    };
}

export function buildPriceIncreaseNotification(input: {
    watch: TelegramWatchContext;
    previousPrice: number;
    currentPrice: number;
    targetPrice?: number | null;
}): TelegramNotificationPayload {
    const { watch, previousPrice, currentPrice, targetPrice } = input;
    const increase = currentPrice - previousPrice;
    const pct =
        previousPrice !== 0 ? Math.round((increase / previousPrice) * 100) : 0;
    let text =
        `🔴 <b>Price Increase</b>\n<b>${escapeTelegramHtml(watch.name)}</b>\n` +
        `$${previousPrice.toFixed(2)} → <b>$${currentPrice.toFixed(2)}</b> (+$${increase.toFixed(2)} · ${pct}% up)`;

    if (targetPrice !== null && targetPrice !== undefined) {
        text += `\n⚠️ Above target price $${targetPrice.toFixed(2)}`;
    }

    return {
        type:
            targetPrice !== null && targetPrice !== undefined
                ? 'price_increase_target'
                : 'price_increase',
        text,
        replyMarkup: buildTelegramInlineKeyboard(watch),
    };
}

export function buildStockNotification(input: {
    watch: TelegramWatchContext;
    stockStatus: 'in_stock' | 'out_of_stock';
}): TelegramNotificationPayload {
    const { watch, stockStatus } = input;
    const name = escapeTelegramHtml(watch.name);

    return stockStatus === 'in_stock'
        ? {
              type: 'back_in_stock',
              text: `🟢 <b>Back in Stock</b>\n<b>${name}</b>\nStock signal recovered.`,
              replyMarkup: buildTelegramInlineKeyboard(watch),
          }
        : {
              type: 'out_of_stock',
              text: `⚪ <b>Out of Stock</b>\n<b>${name}</b>\nStock signal lost.`,
              replyMarkup: buildTelegramInlineKeyboard(watch),
          };
}

export function buildTelegramTestPayload(input: {
    type: TelegramNotificationType;
    watch: TelegramWatchContext;
}): TelegramNotificationPayload {
    const { type, watch } = input;

    switch (type) {
        case 'price_drop':
            return buildPriceDropNotification({
                watch,
                previousPrice: 129.99,
                currentPrice: 89.99,
            });
        case 'price_drop_target':
            return buildPriceDropNotification({
                watch,
                previousPrice: 129.99,
                currentPrice: 89.99,
                targetPrice: 99,
            });
        case 'price_increase':
            return buildPriceIncreaseNotification({
                watch,
                previousPrice: 89.99,
                currentPrice: 109.99,
            });
        case 'price_increase_target':
            return buildPriceIncreaseNotification({
                watch,
                previousPrice: 89.99,
                currentPrice: 109.99,
                targetPrice: 100,
            });
        case 'back_in_stock':
            return buildStockNotification({ watch, stockStatus: 'in_stock' });
        case 'out_of_stock':
            return buildStockNotification({
                watch,
                stockStatus: 'out_of_stock',
            });
    }
}
