'use client';

import { type CheckType, getPriceHistoryData } from '@/app/watch-history';
import type { RouterOutputs } from '@/trpc/react';
import { Button } from '@pounce/ui/components/button';
import {
    type ChartConfig,
    ChartContainer,
    ChartTooltip,
} from '@pounce/ui/components/chart';
import { cn } from '@pounce/ui/lib/utils';
import { useEffect, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { useWatchboardPriceChartStore } from './watchboard-price-chart-store';

const SERIES_COLORS = [
    'var(--color-chart-1)',
    'var(--color-chart-2)',
    'var(--color-chart-3)',
    'var(--color-chart-4)',
    'var(--color-chart-5)',
    'var(--color-chart-6)',
    'var(--color-chart-7)',
    'var(--color-chart-8)',
    'var(--color-chart-9)',
    'var(--color-chart-10)',
] as const;
const BUCKET_MINUTES = [1, 5, 15, 30, 60, 120, 360, 720, 1440] as const;

type WatchboardWatch = RouterOutputs['watch']['getMany'][number];

type ChartSeries = {
    id: string;
    key: string;
    name: string;
    color: string;
    points: Array<{
        timestamp: number;
        price: number;
    }>;
};

type ChartRow = {
    timestamp: number;
} & Record<string, number | undefined>;

type TooltipPayloadItem = {
    color?: string;
    dataKey?: string | number;
    value?: number | string | null;
    payload?: {
        timestamp?: number;
    };
};

export function WatchboardPriceChart({
    watches,
}: {
    watches: WatchboardWatch[];
}) {
    const hiddenWatchIds = useWatchboardPriceChartStore(
        (state) => state.hiddenWatchIds,
    );
    const hasHydrated = useWatchboardPriceChartStore(
        (state) => state.hasHydrated,
    );
    const ultraMinimal = useWatchboardPriceChartStore(
        (state) => state.ultraMinimal,
    );
    const toggleWatch = useWatchboardPriceChartStore(
        (state) => state.toggleWatch,
    );
    const toggleUltraMinimal = useWatchboardPriceChartStore(
        (state) => state.toggleUltraMinimal,
    );
    const showAll = useWatchboardPriceChartStore((state) => state.showAll);
    const pruneHiddenWatchIds = useWatchboardPriceChartStore(
        (state) => state.pruneHiddenWatchIds,
    );

    const { chartData, series, omittedCount } = useMemo(
        () => buildChartData(watches),
        [watches],
    );

    const hiddenWatchIdSet = useMemo(
        () => new Set(hasHydrated ? hiddenWatchIds : []),
        [hasHydrated, hiddenWatchIds],
    );
    const visibleSeries = useMemo(
        () =>
            series.filter(
                (watchSeries) => !hiddenWatchIdSet.has(watchSeries.id),
            ),
        [hiddenWatchIdSet, series],
    );
    const visibleHiddenCount = useMemo(
        () =>
            series.reduce(
                (count, watchSeries) =>
                    hiddenWatchIdSet.has(watchSeries.id) ? count + 1 : count,
                0,
            ),
        [hiddenWatchIdSet, series],
    );
    const chartConfig = useMemo<ChartConfig>(
        () =>
            Object.fromEntries(
                series.map((watchSeries) => [
                    watchSeries.key,
                    {
                        label: watchSeries.name,
                        color: watchSeries.color,
                    },
                ]),
            ),
        [series],
    );
    const seriesByKey = useMemo(
        () =>
            new Map(
                series.map((watchSeries) => [watchSeries.key, watchSeries]),
            ),
        [series],
    );

    useEffect(() => {
        if (!hasHydrated || !series.length) {
            return;
        }

        pruneHiddenWatchIds(series.map((watchSeries) => watchSeries.id));
    }, [hasHydrated, pruneHiddenWatchIds, series]);

    if (!watches.length) {
        return null;
    }

    if (!series.length) {
        return null;
    }

    const chartStateMessage = !visibleSeries.length
        ? 'All lines hidden.'
        : null;
    const subtitle = ultraMinimal
        ? omittedCount > 0
            ? `Recent price reads. ${omittedCount} omitted.`
            : 'Recent price reads.'
        : 'Recent price reads across the board.';

    return (
        <section className="overflow-hidden rounded-lg border border-border/80 bg-card/96">
            <div
                className={cn(
                    ultraMinimal
                        ? 'grid gap-3 px-4 py-3 sm:px-5 md:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)_auto] md:items-center md:gap-4'
                        : 'border-b border-border/60 px-4 py-3 sm:px-5',
                )}
            >
                {ultraMinimal ? (
                    <>
                        <div className="min-w-0">
                            <div className="flex items-start justify-between gap-3 md:block">
                                <div className="min-w-0">
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary/85">
                                        Price History
                                    </div>
                                    <h3 className="mt-1 font-[family:var(--font-display)] text-xl leading-none tracking-[-0.05em] text-foreground sm:text-2xl">
                                        Price over time
                                    </h3>
                                </div>

                                <div className="mt-0.5 flex shrink-0 items-center gap-1.5 md:hidden">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="xs"
                                        aria-pressed={ultraMinimal}
                                        onClick={toggleUltraMinimal}
                                        className={cn(
                                            ultraMinimal &&
                                                'border-primary/25 bg-accent/45 text-foreground',
                                        )}
                                    >
                                        Minimal
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="xs"
                                        onClick={showAll}
                                        disabled={visibleHiddenCount === 0}
                                        className="shrink-0"
                                    >
                                        All on
                                    </Button>
                                </div>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {subtitle}
                            </p>
                        </div>

                        <div className="min-w-0 md:self-stretch">
                            {chartStateMessage ? (
                                <ChartEmptyState
                                    message={chartStateMessage}
                                    compact
                                />
                            ) : (
                                <WatchboardChartCanvas
                                    chartData={chartData}
                                    chartConfig={chartConfig}
                                    visibleSeries={visibleSeries}
                                    seriesByKey={seriesByKey}
                                    compact
                                />
                            )}
                        </div>

                        <div className="mt-0.5 hidden shrink-0 items-center gap-1.5 md:flex md:justify-self-end">
                            <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                aria-pressed={ultraMinimal}
                                onClick={toggleUltraMinimal}
                                className={cn(
                                    ultraMinimal &&
                                        'border-primary/25 bg-accent/45 text-foreground',
                                )}
                            >
                                Minimal
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={showAll}
                                disabled={visibleHiddenCount === 0}
                                className="shrink-0"
                            >
                                All on
                            </Button>
                        </div>
                    </>
                ) : (
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary/85">
                                Price History
                            </div>
                            <h3 className="mt-1 font-[family:var(--font-display)] text-xl leading-none tracking-[-0.05em] text-foreground sm:text-2xl">
                                Price over time
                            </h3>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {subtitle}
                            </p>
                        </div>
                        <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
                            <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                aria-pressed={ultraMinimal}
                                onClick={toggleUltraMinimal}
                                className={cn(
                                    ultraMinimal &&
                                        'border-primary/25 bg-accent/45 text-foreground',
                                )}
                            >
                                Minimal
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={showAll}
                                disabled={visibleHiddenCount === 0}
                                className="shrink-0"
                            >
                                All on
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {!ultraMinimal ? (
                <div className="px-2 py-3 sm:px-3 sm:py-4">
                    {chartStateMessage ? (
                        <ChartEmptyState message={chartStateMessage} />
                    ) : (
                        <WatchboardChartCanvas
                            chartData={chartData}
                            chartConfig={chartConfig}
                            visibleSeries={visibleSeries}
                            seriesByKey={seriesByKey}
                        />
                    )}
                </div>
            ) : null}

            {!ultraMinimal && omittedCount > 0 ? (
                <p className="border-t border-border/40 px-4 py-2 text-[11px] leading-5 text-muted-foreground sm:px-5">
                    {omittedCount}{' '}
                    {omittedCount === 1 ? 'watch is' : 'watches are'} omitted.
                    Stock-only targets and items without enough price history
                    are not charted.
                </p>
            ) : null}

            {!ultraMinimal && series.length ? (
                <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                    <div className="overflow-x-auto md:overflow-visible">
                        <div className="flex min-w-max gap-1.5 md:min-w-0 md:flex-wrap md:gap-2">
                            {series.map((watchSeries) => {
                                const isHidden = hiddenWatchIdSet.has(
                                    watchSeries.id,
                                );

                                return (
                                    <button
                                        key={watchSeries.id}
                                        type="button"
                                        aria-pressed={!isHidden}
                                        onClick={() =>
                                            toggleWatch(watchSeries.id)
                                        }
                                        className={cn(
                                            'inline-flex h-7 items-center gap-2 rounded-xs border px-2.5 text-[11px] tracking-[0.03em] transition-colors',
                                            isHidden
                                                ? 'border-border/70 text-muted-foreground hover:border-border hover:text-foreground'
                                                : 'border-primary/18 bg-background/55 text-foreground hover:border-primary/35 hover:bg-background/80',
                                        )}
                                    >
                                        <span
                                            className="h-1.5 w-4 shrink-0 rounded-full"
                                            style={{
                                                backgroundColor:
                                                    watchSeries.color,
                                                opacity: isHidden ? 0.35 : 1,
                                            }}
                                        />
                                        <span className="max-w-32 truncate sm:max-w-44">
                                            {watchSeries.name}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}

function WatchboardChartCanvas({
    chartData,
    chartConfig,
    visibleSeries,
    seriesByKey,
    compact = false,
}: {
    chartData: ChartRow[];
    chartConfig: ChartConfig;
    visibleSeries: ChartSeries[];
    seriesByKey: Map<string, ChartSeries>;
    compact?: boolean;
}) {
    const minTimestamp = chartData[0]?.timestamp;
    const maxTimestamp = chartData[chartData.length - 1]?.timestamp;

    return (
        <ChartContainer
            config={chartConfig}
            className={cn(
                compact
                    ? 'h-16 w-full aspect-auto sm:h-[4.5rem]'
                    : 'h-[16rem] w-full aspect-auto sm:h-[18rem]',
            )}
        >
            <AreaChart
                accessibilityLayer
                data={chartData}
                margin={
                    compact
                        ? { top: 5, right: 3, bottom: 0, left: 1 }
                        : { top: 8, right: 10, bottom: 0, left: 4 }
                }
            >
                <defs>
                    {visibleSeries.map((watchSeries) => (
                        <linearGradient
                            key={`gradient-${watchSeries.key}`}
                            id={`gradient-${watchSeries.key}`}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                        >
                            <stop
                                offset="0%"
                                stopColor={`var(--color-${watchSeries.key})`}
                                stopOpacity={compact ? 0.14 : 0.24}
                            />
                            <stop
                                offset="68%"
                                stopColor={`var(--color-${watchSeries.key})`}
                                stopOpacity={compact ? 0.035 : 0.08}
                            />
                            <stop
                                offset="100%"
                                stopColor={`var(--color-${watchSeries.key})`}
                                stopOpacity={compact ? 0.004 : 0.015}
                            />
                        </linearGradient>
                    ))}
                </defs>
                {!compact ? (
                    <CartesianGrid vertical={false} strokeDasharray="2 6" />
                ) : null}
                <XAxis
                    dataKey="timestamp"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    axisLine={false}
                    tickLine={false}
                    tickMargin={8}
                    minTickGap={28}
                    hide={compact}
                    tickFormatter={(value) =>
                        formatAxisLabel(
                            Number(value),
                            minTimestamp,
                            maxTimestamp,
                        )
                    }
                />
                <YAxis hide domain={['auto', 'auto']} />
                <ChartTooltip
                    cursor={
                        compact
                            ? false
                            : {
                                  stroke: 'var(--color-border)',
                                  strokeDasharray: '3 4',
                              }
                    }
                    content={({ active, label, payload }) => (
                        <WatchboardChartTooltip
                            active={active}
                            label={label}
                            payload={payload as TooltipPayloadItem[]}
                            seriesByKey={seriesByKey}
                        />
                    )}
                />
                {visibleSeries.map((watchSeries) => (
                    <Area
                        key={watchSeries.id}
                        type="natural"
                        dataKey={watchSeries.key}
                        stroke={`var(--color-${watchSeries.key})`}
                        fill={`url(#gradient-${watchSeries.key})`}
                        fillOpacity={1}
                        strokeWidth={compact ? 1.5 : 1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        dot={false}
                        connectNulls={false}
                        activeDot={{
                            r: compact ? 2.5 : 3,
                            strokeWidth: 0,
                            fill: `var(--color-${watchSeries.key})`,
                        }}
                        isAnimationActive={false}
                    />
                ))}
            </AreaChart>
        </ChartContainer>
    );
}

function buildChartData(watches: WatchboardWatch[]) {
    const rawSeries = watches.flatMap((watch) => {
        const checkType = watch.checkType as CheckType;

        if (checkType === 'stock') {
            return [];
        }

        const history = getPriceHistoryData(watch.history, checkType)
            .filter((point) => typeof point.price === 'number')
            .map((point) => ({
                timestamp: new Date(point.checkedAt).getTime(),
                price: point.price as number,
            }))
            .filter((point) => !Number.isNaN(point.timestamp))
            .sort((a, b) => a.timestamp - b.timestamp);

        if (history.length < 2) {
            return [];
        }

        return [
            {
                id: watch.id,
                key: getSeriesKey(watch.id),
                name: watch.name,
                color: getSeriesColor(watch.id),
                points: history,
            },
        ] satisfies ChartSeries[];
    });

    const allRawTimestamps = Array.from(
        new Set(
            rawSeries.flatMap((watchSeries) =>
                watchSeries.points.map((point) => point.timestamp),
            ),
        ),
    ).sort((a, b) => a - b);

    if (!allRawTimestamps.length) {
        return {
            chartData: [],
            series: [],
            omittedCount: Math.max(watches.length, 0),
        };
    }

    const firstRawTimestamp = allRawTimestamps[0];
    const lastRawTimestamp = allRawTimestamps[allRawTimestamps.length - 1];

    if (firstRawTimestamp === undefined || lastRawTimestamp === undefined) {
        return {
            chartData: [],
            series: [],
            omittedCount: Math.max(watches.length, 0),
        };
    }

    const bucketMinutes = getBucketMinutes(
        lastRawTimestamp - firstRawTimestamp,
    );
    const series = rawSeries.flatMap((watchSeries) => {
        const bucketedPoints = Array.from(
            watchSeries.points.reduce((bucketMap, point) => {
                bucketMap.set(
                    getBucketStart(point.timestamp, bucketMinutes),
                    point.price,
                );
                return bucketMap;
            }, new Map<number, number>()),
        )
            .map(([timestamp, price]) => ({ timestamp, price }))
            .sort((a, b) => a.timestamp - b.timestamp);

        if (bucketedPoints.length < 2) {
            return [];
        }

        return [
            {
                ...watchSeries,
                points: bucketedPoints,
            },
        ];
    });

    const bucketedTimestamps = Array.from(
        new Set(
            series.flatMap((watchSeries) =>
                watchSeries.points.map((point) => point.timestamp),
            ),
        ),
    ).sort((a, b) => a - b);

    if (!bucketedTimestamps.length) {
        return {
            chartData: [],
            series: [],
            omittedCount: Math.max(watches.length, 0),
        };
    }

    const firstBucketTimestamp = bucketedTimestamps[0];
    const lastBucketTimestamp =
        bucketedTimestamps[bucketedTimestamps.length - 1];

    if (
        firstBucketTimestamp === undefined ||
        lastBucketTimestamp === undefined
    ) {
        return {
            chartData: [],
            series: [],
            omittedCount: Math.max(watches.length - series.length, 0),
        };
    }

    const chartData: ChartRow[] = [];
    let bucketTimestamp = firstBucketTimestamp;

    while (bucketTimestamp <= lastBucketTimestamp) {
        chartData.push({ timestamp: bucketTimestamp });
        bucketTimestamp = getNextBucketStart(bucketTimestamp, bucketMinutes);
    }

    for (const watchSeries of series) {
        let pointIndex = 0;
        let lastPrice: number | undefined;

        for (const row of chartData) {
            while (
                pointIndex < watchSeries.points.length &&
                watchSeries.points[pointIndex]?.timestamp <= row.timestamp
            ) {
                lastPrice = watchSeries.points[pointIndex]?.price;
                pointIndex += 1;
            }

            if (lastPrice !== undefined) {
                row[watchSeries.key] = lastPrice;
            }
        }
    }

    return {
        chartData,
        series,
        omittedCount: Math.max(watches.length - series.length, 0),
    };
}

function getSeriesKey(watchId: string) {
    return `watch_${watchId.replace(/-/g, '_')}`;
}

function getSeriesColor(watchId: string) {
    let hash = 0;

    for (const character of watchId) {
        hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    }

    return SERIES_COLORS[hash % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

function getBucketMinutes(spanMs: number) {
    const spanMinutes = Math.max(Math.ceil(spanMs / (60 * 1000)), 1);

    return (
        BUCKET_MINUTES.find(
            (bucketMinutes) => spanMinutes / bucketMinutes <= 12,
        ) ?? BUCKET_MINUTES[BUCKET_MINUTES.length - 1]
    );
}

function getBucketStart(timestamp: number, bucketMinutes: number) {
    const bucketDate = new Date(timestamp);

    if (bucketMinutes >= 1440) {
        bucketDate.setHours(0, 0, 0, 0);
        return bucketDate.getTime();
    }

    bucketDate.setSeconds(0, 0);

    if (bucketMinutes % 60 === 0) {
        const bucketHours = bucketMinutes / 60;
        bucketDate.setMinutes(0, 0, 0);
        bucketDate.setHours(
            Math.floor(bucketDate.getHours() / bucketHours) * bucketHours,
        );
        return bucketDate.getTime();
    }

    const totalMinutes = bucketDate.getHours() * 60 + bucketDate.getMinutes();
    const bucketedMinutes =
        Math.floor(totalMinutes / bucketMinutes) * bucketMinutes;

    bucketDate.setHours(
        Math.floor(bucketedMinutes / 60),
        bucketedMinutes % 60,
        0,
        0,
    );
    return bucketDate.getTime();
}

function getNextBucketStart(timestamp: number, bucketMinutes: number) {
    const bucketDate = new Date(timestamp);

    if (bucketMinutes >= 1440) {
        bucketDate.setDate(bucketDate.getDate() + bucketMinutes / 1440);
        return bucketDate.getTime();
    }

    bucketDate.setMinutes(bucketDate.getMinutes() + bucketMinutes);
    return bucketDate.getTime();
}

function formatAxisLabel(
    value: number,
    minTimestamp?: number,
    maxTimestamp?: number,
) {
    const span = (maxTimestamp ?? value) - (minTimestamp ?? value);

    if (span <= 36 * 60 * 60 * 1000) {
        return new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit',
        }).format(value);
    }

    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
    }).format(value);
}

function formatTooltipDate(value: number) {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(value);
}

function formatPrice(value: number) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
    }).format(value);
}

function ChartEmptyState({
    message,
    compact = false,
}: {
    message: string;
    compact?: boolean;
}) {
    return (
        <div
            className={cn(
                'flex items-center justify-center rounded-md border border-dashed border-border/70 bg-background/20 px-4 text-center uppercase text-muted-foreground',
                compact
                    ? 'h-16 w-full text-[10px] tracking-[0.14em] sm:h-[4.5rem]'
                    : 'h-[16rem] text-[11px] tracking-[0.18em] sm:h-[18rem]',
            )}
        >
            {message}
        </div>
    );
}

function WatchboardChartTooltip({
    active,
    label,
    payload,
    seriesByKey,
}: {
    active?: boolean;
    label?: number | string;
    payload?: TooltipPayloadItem[];
    seriesByKey: Map<string, ChartSeries>;
}) {
    if (!active || !payload?.length) {
        return null;
    }

    const items = payload
        .filter(
            (
                item,
            ): item is TooltipPayloadItem & {
                dataKey: string;
                value: number;
            } =>
                typeof item.dataKey === 'string' &&
                typeof item.value === 'number' &&
                Number.isFinite(item.value),
        )
        .sort((a, b) => b.value - a.value);

    if (!items.length) {
        return null;
    }

    const timestamp =
        typeof label === 'number'
            ? label
            : typeof items[0]?.payload?.timestamp === 'number'
              ? items[0].payload.timestamp
              : null;

    return (
        <div className="grid min-w-[12rem] gap-2 rounded-lg border border-border/70 bg-background/96 px-3 py-2 text-xs shadow-xl">
            {timestamp !== null ? (
                <div className="font-medium text-foreground">
                    {formatTooltipDate(timestamp)}
                </div>
            ) : null}
            <div className="grid gap-1.5">
                {items.map((item) => {
                    const watchSeries = seriesByKey.get(item.dataKey);

                    return (
                        <div
                            key={item.dataKey}
                            className="flex items-center gap-2 leading-none"
                        >
                            <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: item.color }}
                            />
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                {watchSeries?.name ?? item.dataKey}
                            </span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                                {formatPrice(item.value)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
