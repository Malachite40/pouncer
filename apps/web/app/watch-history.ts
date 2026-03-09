export type WatchStatus = 'in_stock' | 'out_of_stock' | null;

type HistoryEntry = {
    checkedAt: Date | string;
    price: string | null;
    stockStatus: string | null;
};

export type CheckType = 'price' | 'stock' | 'both';

export type PriceHistoryPoint = {
    checkedAt: Date | string;
    price: number | null;
    stockStatus?: WatchStatus;
};

export function normalizeStatus(value: string | null): WatchStatus {
    if (value === 'in_stock' || value === 'out_of_stock') {
        return value;
    }

    return null;
}

export function getPriceHistoryData(
    history: HistoryEntry[],
    checkType: CheckType = 'price',
): PriceHistoryPoint[] {
    const data = [...history]
        .sort(
            (a, b) =>
                new Date(a.checkedAt).getTime() -
                new Date(b.checkedAt).getTime(),
        )
        .flatMap<PriceHistoryPoint>((entry) => {
            const price = entry.price ? Number.parseFloat(entry.price) : null;
            const validPrice =
                price !== null && !Number.isNaN(price) ? price : null;
            const stockStatus = normalizeStatus(entry.stockStatus);

            if (checkType === 'stock') {
                if (!stockStatus) return [];
                return [
                    {
                        checkedAt: entry.checkedAt,
                        price: validPrice,
                        stockStatus,
                    },
                ];
            }

            if (checkType === 'both') {
                if (validPrice === null && !stockStatus) return [];
                return [
                    {
                        checkedAt: entry.checkedAt,
                        price: validPrice,
                        stockStatus,
                    },
                ];
            }

            if (validPrice === null) return [];

            return [
                { checkedAt: entry.checkedAt, price: validPrice, stockStatus },
            ];
        });

    if (data.length === 1) {
        const onlyPoint = data[0];
        const checkedAt = new Date(onlyPoint.checkedAt);

        data.push({
            ...onlyPoint,
            checkedAt: Number.isNaN(checkedAt.getTime())
                ? onlyPoint.checkedAt
                : new Date(checkedAt.getTime() + 1000),
        });
    }

    return data;
}

export type SimpleTrend = {
    direction: 'up' | 'down' | 'stable';
    percentChange: number;
    spanLabel: string;
};

export function computeSimpleTrend(
    history: HistoryEntry[],
): SimpleTrend | null {
    const priceEntries = history
        .filter(
            (e) => e.price !== null && !Number.isNaN(Number.parseFloat(e.price!)),
        )
        .sort(
            (a, b) =>
                new Date(a.checkedAt).getTime() -
                new Date(b.checkedAt).getTime(),
        );

    if (priceEntries.length < 2) return null;

    const earliest = Number.parseFloat(priceEntries[0].price!);
    const latest = Number.parseFloat(
        priceEntries[priceEntries.length - 1].price!,
    );

    if (earliest === 0) return null;

    const percentChange =
        Math.round(((latest - earliest) / earliest) * 100 * 100) / 100;

    const direction: 'up' | 'down' | 'stable' =
        percentChange > 1 ? 'up' : percentChange < -1 ? 'down' : 'stable';

    const firstTime = new Date(priceEntries[0].checkedAt).getTime();
    const lastTime = new Date(
        priceEntries[priceEntries.length - 1].checkedAt,
    ).getTime();
    const spanMs = lastTime - firstTime;
    const spanHours = spanMs / (1000 * 60 * 60);

    let spanLabel: string;
    if (spanHours < 1) {
        spanLabel = `${Math.round(spanMs / (1000 * 60))}m`;
    } else if (spanHours < 24) {
        spanLabel = `${Math.round(spanHours)}h`;
    } else {
        spanLabel = `${Math.round(spanHours / 24)}d`;
    }

    return { direction, percentChange, spanLabel };
}

export function countPricePoints(
    history: Array<{
        price: string | null;
    }>,
) {
    return history.reduce(
        (count, entry) => (entry.price ? count + 1 : count),
        0,
    );
}

export function countHistoryReads(
    history: HistoryEntry[],
    checkType: CheckType,
) {
    if (checkType === 'stock') {
        return history.reduce(
            (count, entry) =>
                normalizeStatus(entry.stockStatus) ? count + 1 : count,
            0,
        );
    }

    if (checkType === 'both') {
        return history.reduce((count, entry) => {
            const price = entry.price ? Number.parseFloat(entry.price) : null;
            const hasPrice = price !== null && !Number.isNaN(price);
            return hasPrice || normalizeStatus(entry.stockStatus)
                ? count + 1
                : count;
        }, 0);
    }

    return countPricePoints(history);
}
