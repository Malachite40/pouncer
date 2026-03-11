import type { watches } from '@pounce/db/schema';

import {
    type TelegramNotificationPayload,
    buildPriceDropNotification,
    buildPriceIncreaseNotification,
    buildStockNotification,
} from './telegram';

type WatchRecord = typeof watches.$inferSelect;

interface BuildNotificationsInput {
    watch: WatchRecord;
    price: number | null;
    stockStatus: string | null;
}

function shouldNotifyForDrop(
    watch: WatchRecord,
    previousPrice: number,
    currentPrice: number,
): boolean {
    const targetPrice = watch.priceDropTargetPrice
        ? Number.parseFloat(watch.priceDropTargetPrice)
        : null;
    if (targetPrice !== null && currentPrice > targetPrice) {
        return false;
    }

    const absThreshold = watch.priceDropThreshold
        ? Number.parseFloat(watch.priceDropThreshold)
        : null;
    const pctThreshold = watch.priceDropPercentThreshold
        ? Number.parseFloat(watch.priceDropPercentThreshold)
        : null;

    if (absThreshold === null && pctThreshold === null) {
        return true;
    }

    const absoluteDelta = previousPrice - currentPrice;
    const percentDelta =
        previousPrice !== 0 ? (absoluteDelta / previousPrice) * 100 : 0;

    if (absThreshold !== null && absoluteDelta >= absThreshold) return true;
    if (pctThreshold !== null && percentDelta >= pctThreshold) return true;

    return false;
}

function shouldNotifyForIncrease(
    watch: WatchRecord,
    previousPrice: number,
    currentPrice: number,
): boolean {
    const targetPrice = watch.priceIncreaseTargetPrice
        ? Number.parseFloat(watch.priceIncreaseTargetPrice)
        : null;
    if (targetPrice !== null && currentPrice < targetPrice) {
        return false;
    }

    const absThreshold = watch.priceIncreaseThreshold
        ? Number.parseFloat(watch.priceIncreaseThreshold)
        : null;
    const pctThreshold = watch.priceIncreasePercentThreshold
        ? Number.parseFloat(watch.priceIncreasePercentThreshold)
        : null;

    if (absThreshold === null && pctThreshold === null) {
        return true;
    }

    const absoluteDelta = currentPrice - previousPrice;
    const percentDelta =
        previousPrice !== 0 ? (absoluteDelta / previousPrice) * 100 : 0;

    if (absThreshold !== null && absoluteDelta >= absThreshold) return true;
    if (pctThreshold !== null && percentDelta >= pctThreshold) return true;

    return false;
}

export function buildWatchNotifications({
    watch,
    price,
    stockStatus,
}: BuildNotificationsInput) {
    const notifications: TelegramNotificationPayload[] = [];
    const watchContext = {
        id: watch.id,
        name: watch.name,
        url: watch.url,
    };

    if (price !== null && watch.lastPrice !== null) {
        const previousPrice = Number.parseFloat(watch.lastPrice);

        if (price !== previousPrice) {
            if (price < previousPrice && watch.notifyPriceDrop) {
                if (shouldNotifyForDrop(watch, previousPrice, price)) {
                    const targetPrice = watch.priceDropTargetPrice
                        ? Number.parseFloat(watch.priceDropTargetPrice)
                        : null;
                    notifications.push(
                        buildPriceDropNotification({
                            watch: watchContext,
                            previousPrice,
                            currentPrice: price,
                            targetPrice:
                                targetPrice !== null && price <= targetPrice
                                    ? targetPrice
                                    : null,
                        }),
                    );
                }
            } else if (watch.notifyPriceIncrease) {
                if (shouldNotifyForIncrease(watch, previousPrice, price)) {
                    const targetPrice = watch.priceIncreaseTargetPrice
                        ? Number.parseFloat(watch.priceIncreaseTargetPrice)
                        : null;
                    notifications.push(
                        buildPriceIncreaseNotification({
                            watch: watchContext,
                            previousPrice,
                            currentPrice: price,
                            targetPrice:
                                targetPrice !== null && price >= targetPrice
                                    ? targetPrice
                                    : null,
                        }),
                    );
                }
            }
        }
    }

    if (
        watch.notifyStock &&
        stockStatus &&
        watch.lastStockStatus &&
        stockStatus !== watch.lastStockStatus
    ) {
        notifications.push(
            buildStockNotification({
                watch: watchContext,
                stockStatus: stockStatus as 'in_stock' | 'out_of_stock',
            }),
        );
    }

    return notifications;
}
