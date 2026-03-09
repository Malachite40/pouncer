import type { watches } from '@pounce/db/schema';

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
    const notifications: { message: string; type: string }[] = [];

    if (price !== null && watch.lastPrice !== null) {
        const previousPrice = Number.parseFloat(watch.lastPrice);

        if (price !== previousPrice) {
            if (price < previousPrice && watch.notifyPriceDrop) {
                if (shouldNotifyForDrop(watch, previousPrice, price)) {
                    const drop = previousPrice - price;
                    const pct =
                        previousPrice !== 0
                            ? Math.round((drop / previousPrice) * 100)
                            : 0;

                    let message = `🟢 <b>Price Drop!</b> · <a href="${watch.url}">View Product</a>\n\n<b>${watch.name}</b>\n$${previousPrice.toFixed(2)} → <b>$${price.toFixed(2)}</b> (-$${drop.toFixed(2)} · ${pct}% off)`;

                    const targetPrice = watch.priceDropTargetPrice
                        ? Number.parseFloat(watch.priceDropTargetPrice)
                        : null;
                    if (targetPrice !== null && price <= targetPrice) {
                        message += `\n✅ Below target price $${targetPrice.toFixed(2)}`;
                    }
                    notifications.push({ message, type: 'price_drop' });
                }
            } else if (watch.notifyPriceIncrease) {
                if (shouldNotifyForIncrease(watch, previousPrice, price)) {
                    const increase = price - previousPrice;
                    const pct =
                        previousPrice !== 0
                            ? Math.round((increase / previousPrice) * 100)
                            : 0;

                    let message = `🔴 <b>Price Increase</b> · <a href="${watch.url}">View Product</a>\n\n<b>${watch.name}</b>\n$${previousPrice.toFixed(2)} → <b>$${price.toFixed(2)}</b> (+$${increase.toFixed(2)} · ${pct}% up)`;

                    const targetPrice = watch.priceIncreaseTargetPrice
                        ? Number.parseFloat(watch.priceIncreaseTargetPrice)
                        : null;
                    if (targetPrice !== null && price >= targetPrice) {
                        message += `\n⚠️ Above target price $${targetPrice.toFixed(2)}`;
                    }
                    notifications.push({ message, type: 'price_increase' });
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
            stockStatus === 'in_stock'
                ? { message: `🟢 <b>Back in Stock!</b> · <a href="${watch.url}">View Product</a>\n\n<b>${watch.name}</b>`, type: 'back_in_stock' }
                : { message: `⚪ <b>Out of Stock</b> · <a href="${watch.url}">View Product</a>\n\n<b>${watch.name}</b>`, type: 'out_of_stock' },
        );
    }

    return notifications;
}
