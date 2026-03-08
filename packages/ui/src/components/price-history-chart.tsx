'use client';

import {
    type ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from '@pounce/ui/components/chart';
import * as React from 'react';
import {
    Area,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    XAxis,
    YAxis,
} from 'recharts';

type PriceHistoryPoint = {
    checkedAt: Date | string;
    price: number | null;
    stockStatus?: 'in_stock' | 'out_of_stock' | null;
};

const chartConfig = {
    price: {
        label: 'Price',
        color: 'var(--color-chart-1)',
    },
    inStock: {
        label: 'In Stock',
        color: 'var(--color-success)',
    },
    outOfStock: {
        label: 'Out of Stock',
        color: 'var(--color-destructive)',
    },
    availability: {
        label: 'Availability',
        color: 'var(--color-success)',
    },
} satisfies ChartConfig;

export function PriceHistoryChart({
    data,
    className,
    variant = 'default',
    hideXAxis = false,
    showStockBars = false,
    mode,
}: {
    data: PriceHistoryPoint[];
    className?: string;
    variant?: 'default' | 'minimal';
    hideXAxis?: boolean;
    showStockBars?: boolean;
    mode?: 'price' | 'stock' | 'both';
}) {
    const isMinimal = variant === 'minimal';
    const uniqueId = React.useId().replace(/:/g, '');
    const fillGradientId = `price-fill-${uniqueId}`;
    const strokeGradientId = `price-stroke-${uniqueId}`;

    const showPrice = mode ? mode !== 'stock' : true;
    const showStock = mode ? mode !== 'price' : showStockBars;

    const pricePointCount = data.reduce(
        (count, point) => (typeof point.price === 'number' ? count + 1 : count),
        0,
    );
    const stockPointCount = data.reduce(
        (count, point) => (point.stockStatus ? count + 1 : count),
        0,
    );

    const hasEnoughData =
        mode === 'stock'
            ? stockPointCount >= 2
            : pricePointCount >= 2 || (showStock && stockPointCount >= 2);

    if (!hasEnoughData) {
        const emptyMessage =
            mode === 'stock'
                ? 'Not enough stock history'
                : 'Not enough price history';
        return (
            <div
                className={`${isMinimal ? 'flex min-h-12 items-center border-0 bg-transparent px-0 text-[10px] tracking-[0.14em] text-muted-foreground' : 'flex h-24 items-center justify-center rounded-md border border-dashed border-border/70 bg-background/25 px-4 text-center text-[11px] uppercase tracking-[0.18em] text-muted-foreground'} ${className ?? ''}`}
            >
                {emptyMessage}
            </div>
        );
    }

    const chartData = data.map((point) => ({
        checkedAt: point.checkedAt,
        label: formatAxisLabel(point.checkedAt),
        price: point.price,
        stockValue: point.stockStatus ? 1 : 0,
        stockFill:
            point.stockStatus === 'in_stock'
                ? 'var(--color-inStock)'
                : point.stockStatus === 'out_of_stock'
                  ? 'var(--color-outOfStock)'
                  : 'transparent',
        inStock: point.stockStatus === 'in_stock' ? 1 : 0,
        outOfStock: point.stockStatus === 'out_of_stock' ? 1 : 0,
    }));
    const domain = getPriceDomain(
        chartData.flatMap((point) =>
            typeof point.price === 'number' ? [point.price] : [],
        ),
    );

    return (
        <ChartContainer
            config={chartConfig}
            className={`${isMinimal ? 'h-12 w-full aspect-auto' : 'h-24 w-full'} ${className ?? ''}`}
        >
            {!showPrice && showStock ? (
                <BarChart
                    accessibilityLayer
                    data={chartData}
                    margin={
                        isMinimal
                            ? { top: 0, right: 0, bottom: 0, left: 0 }
                            : { top: 6, right: 6, bottom: 0, left: 6 }
                    }
                    barCategoryGap={isMinimal ? '20%' : '14%'}
                >
                    {!isMinimal ? <CartesianGrid vertical={false} /> : null}
                    <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        minTickGap={28}
                        tickMargin={6}
                        hide={isMinimal || hideXAxis}
                    />
                    <YAxis domain={[0, 1]} hide />
                    <ChartTooltip
                        cursor={false}
                        content={
                            <ChartTooltipContent
                                labelFormatter={(_, payload) => {
                                    const point = payload?.[0]?.payload as
                                        | {
                                              checkedAt?: Date | string;
                                          }
                                        | undefined;

                                    return point?.checkedAt
                                        ? formatTooltipDate(point.checkedAt)
                                        : '';
                                }}
                                formatter={(value, name, item) => {
                                    if (value === 0) return null;
                                    const point = item?.payload as
                                        | {
                                              stockFill?: string;
                                          }
                                        | undefined;

                                    return (
                                        <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                                            <span className="text-muted-foreground">
                                                {name}
                                            </span>
                                            <span className="font-medium text-foreground">
                                                {point?.stockFill ===
                                                'var(--color-outOfStock)'
                                                    ? 'Out of stock'
                                                    : 'In stock'}
                                            </span>
                                        </div>
                                    );
                                }}
                                indicator="dot"
                            />
                        }
                    />
                    <Bar
                        dataKey="stockValue"
                        name="Availability"
                        radius={[2, 2, 0, 0]}
                        minPointSize={isMinimal ? 4 : 12}
                        maxBarSize={isMinimal ? 6 : 18}
                        isAnimationActive={false}
                    >
                        {chartData.map((point) => (
                            <Cell
                                key={`${point.label}-${point.checkedAt}`}
                                fill={point.stockFill}
                            />
                        ))}
                    </Bar>
                </BarChart>
            ) : (
                <ComposedChart
                    accessibilityLayer
                    data={chartData}
                    margin={
                        isMinimal
                            ? { top: 0, right: 0, bottom: 0, left: 0 }
                            : { top: 4, right: 4, bottom: 0, left: 0 }
                    }
                >
                    <defs>
                        <linearGradient
                            id={fillGradientId}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                        >
                            <stop
                                offset="5%"
                                stopColor="var(--color-price)"
                                stopOpacity={isMinimal ? 0.3 : 0.42}
                            />
                            <stop
                                offset="95%"
                                stopColor="var(--color-price)"
                                stopOpacity={0.03}
                            />
                        </linearGradient>
                        <linearGradient
                            id={strokeGradientId}
                            x1="0"
                            y1="0"
                            x2="1"
                            y2="0"
                        >
                            <stop
                                offset="0%"
                                stopColor="var(--color-price)"
                                stopOpacity={0.45}
                            />
                            <stop
                                offset="65%"
                                stopColor="var(--color-price)"
                                stopOpacity={0.88}
                            />
                            <stop
                                offset="100%"
                                stopColor="var(--color-price)"
                                stopOpacity={1}
                            />
                        </linearGradient>
                    </defs>
                    <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        minTickGap={28}
                        tickMargin={isMinimal ? 0 : 6}
                        hide={isMinimal || hideXAxis}
                    />
                    {showPrice ? (
                        <YAxis domain={domain} hide />
                    ) : (
                        <YAxis domain={[0, 1]} hide />
                    )}
                    {showStock && showPrice ? (
                        <YAxis yAxisId="stock" domain={[0, 1]} hide />
                    ) : null}
                    <ChartTooltip
                        cursor={false}
                        content={
                            <ChartTooltipContent
                                labelFormatter={(_, payload) => {
                                    const point = payload?.[0]?.payload as
                                        | {
                                              checkedAt?: Date | string;
                                          }
                                        | undefined;

                                    return point?.checkedAt
                                        ? formatTooltipDate(point.checkedAt)
                                        : '';
                                }}
                                formatter={(value, name, item) => {
                                    if (value === 0) return null;
                                    if (name === 'Price') {
                                        return (
                                            <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                                                <span className="text-muted-foreground">
                                                    Price
                                                </span>
                                                <span className="font-mono font-medium tabular-nums text-foreground">
                                                    {formatPrice(Number(value))}
                                                </span>
                                            </div>
                                        );
                                    }

                                    const point = item?.payload as { stockFill?: string } | undefined;
                                    const label =
                                        point?.stockFill === 'var(--color-outOfStock)'
                                            ? 'Out of stock'
                                            : 'In stock';

                                    return (
                                        <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                                            <span className="text-muted-foreground">
                                                Stock
                                            </span>
                                            <span className="font-medium text-foreground">
                                                {label}
                                            </span>
                                        </div>
                                    );
                                }}
                                indicator="dot"
                            />
                        }
                    />
                    {showStock ? (
                        <Bar
                            {...(showPrice ? { yAxisId: 'stock' } : {})}
                            dataKey="stockValue"
                            name="Availability"
                            radius={[2, 2, 0, 0]}
                            minPointSize={isMinimal ? 4 : 10}
                            maxBarSize={isMinimal ? 6 : showPrice ? 10 : 18}
                            fillOpacity={showPrice ? 0.35 : 0.7}
                            isAnimationActive={false}
                        >
                            {chartData.map((point) => (
                                <Cell
                                    key={`${point.label}-${point.checkedAt}`}
                                    fill={point.stockFill}
                                />
                            ))}
                        </Bar>
                    ) : null}
                    {showPrice ? (
                        <Area
                            type="monotone"
                            dataKey="price"
                            name="Price"
                            stroke={`url(#${strokeGradientId})`}
                            fill={`url(#${fillGradientId})`}
                            strokeWidth={isMinimal ? 2 : 2.5}
                            dot={false}
                            activeDot={{
                                r: isMinimal ? 3 : 4,
                                strokeWidth: 0,
                                fill: 'var(--color-price)',
                            }}
                        />
                    ) : null}
                </ComposedChart>
            )}
        </ChartContainer>
    );
}

function getPriceDomain(values: number[]) {
    if (!values.length) {
        return [0, 1] as [number, number];
    }

    const min = Math.min(...values);
    const max = Math.max(...values);

    if (min === max) {
        const padding = min === 0 ? 1 : Math.abs(min) * 0.03;
        return [min - padding, max + padding] as [number, number];
    }

    const padding = (max - min) * 0.12;
    return [Math.max(0, min - padding), max + padding] as [number, number];
}

function formatPrice(value: number) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
    }).format(value);
}

function formatAxisLabel(value: Date | string) {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
    }).format(new Date(value));
}

function formatTooltipDate(value: Date | string) {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(value));
}
