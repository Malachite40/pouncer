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
