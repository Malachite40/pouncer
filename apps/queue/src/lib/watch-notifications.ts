import type { watches } from '@pounce/db/schema';

type WatchRecord = typeof watches.$inferSelect;

interface BuildNotificationsInput {
    watch: WatchRecord;
    price: number | null;
    stockStatus: string | null;
}

export function buildWatchNotifications({
    watch,
    price,
    stockStatus,
}: BuildNotificationsInput) {
    const notifications: string[] = [];
    const shouldNotifyPrice = watch.notifyPrice;
    const shouldNotifyStock = watch.notifyStock;

    if (shouldNotifyPrice && price !== null && watch.lastPrice !== null) {
        const previousPrice = Number.parseFloat(watch.lastPrice);

        if (price !== previousPrice) {
            const drop = previousPrice - price;
            const threshold = watch.priceThreshold
                ? Number.parseFloat(watch.priceThreshold)
                : null;

            if (price < previousPrice && threshold !== null && drop < threshold) {
                // Drop is below threshold — skip
            } else {
                notifications.push(
                    price < previousPrice
                        ? `<b>Price Drop!</b> ${watch.name}\n$${previousPrice.toFixed(2)} → $${price.toFixed(2)}\n${watch.url}`
                        : `<b>Price Increase</b> ${watch.name}\n$${previousPrice.toFixed(2)} → $${price.toFixed(2)}\n${watch.url}`,
                );
            }
        }
    }

    if (
        shouldNotifyStock &&
        stockStatus &&
        watch.lastStockStatus &&
        stockStatus !== watch.lastStockStatus
    ) {
        notifications.push(
            stockStatus === 'in_stock'
                ? `<b>Back in Stock!</b> ${watch.name}\n${watch.url}`
                : `<b>Out of Stock</b> ${watch.name}\n${watch.url}`,
        );
    }

    return notifications;
}
