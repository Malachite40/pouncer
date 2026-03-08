'use client';

import {
    type WatchStatus,
    countHistoryReads,
    getPriceHistoryData,
    normalizeStatus,
} from '@/app/watch-history';
import { api } from '@/trpc/react';
import { Button } from '@pounce/ui/components/button';
import { Input } from '@pounce/ui/components/input';
import { PriceHistoryChart } from '@pounce/ui/components/price-history-chart';
import { useDebouncedValue } from '@pounce/ui/hooks/use-debounce';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import Link from 'next/link';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useMemo } from 'react';

type SortKey = 'status' | 'price' | 'timing';

const badgePillClassName =
    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-none tracking-[0.12em]';
const boardColumnClassName =
    'lg:grid lg:grid-cols-[32%_15%_11%_24%_18%] lg:items-center';

const statusStyles: Record<
    NonNullable<WatchStatus>,
    {
        label: string;
        className: string;
        pulseClassName: string;
        accentClassName: string;
    }
> = {
    in_stock: {
        label: 'In Stock',
        className: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300',
        pulseClassName: 'bg-emerald-400',
        accentClassName: 'before:bg-emerald-400/70',
    },
    out_of_stock: {
        label: 'Out of Stock',
        className: 'border-destructive/40 bg-destructive/12 text-red-200',
        pulseClassName: 'bg-destructive',
        accentClassName: 'before:bg-destructive/75',
    },
};

const STATUS_ORDER: Record<string, number> = {
    in_stock: 0,
    out_of_stock: 1,
};

function getStatusRank(status: WatchStatus, isActive: boolean) {
    if (!isActive) return 3;
    if (!status) return 2;
    return STATUS_ORDER[status] ?? 2;
}

export function WatchList() {
    const { data: watches } = api.watch.getMany.useQuery(undefined, {
        staleTime: 30_000,
    });

    const sortKeys = ['status', 'price', 'timing'] as const;
    const [sortKey, setSortKey] = useQueryState(
        'sort',
        parseAsStringLiteral(sortKeys),
    );
    const [sortDir, setSortDir] = useQueryState(
        'dir',
        parseAsStringLiteral(['asc', 'desc'] as const).withDefault('asc'),
    );
    const [search, setSearch] = useQueryState('q', { defaultValue: '' });
    const debouncedSearch = useDebouncedValue(search, 250);

    const filteredWatches = useMemo(() => {
        if (!watches) return [];

        let result = watches;

        if (debouncedSearch) {
            const q = debouncedSearch.toLowerCase();
            result = result.filter(
                (w) =>
                    w.name.toLowerCase().includes(q) ||
                    w.url.toLowerCase().includes(q),
            );
        }

        if (sortKey) {
            result = [...result].sort((a, b) => {
                let cmp = 0;
                if (sortKey === 'status') {
                    cmp =
                        getStatusRank(
                            normalizeStatus(a.lastStockStatus),
                            a.isActive,
                        ) -
                        getStatusRank(
                            normalizeStatus(b.lastStockStatus),
                            b.isActive,
                        );
                } else if (sortKey === 'price') {
                    const pa = a.lastPrice
                        ? Number.parseFloat(a.lastPrice)
                        : null;
                    const pb = b.lastPrice
                        ? Number.parseFloat(b.lastPrice)
                        : null;
                    if (pa === null && pb === null) return 0;
                    if (pa === null) return 1;
                    if (pb === null) return -1;
                    cmp = pa - pb;
                } else if (sortKey === 'timing') {
                    const ta = a.lastCheckedAt
                        ? new Date(a.lastCheckedAt).getTime()
                        : 0;
                    const tb = b.lastCheckedAt
                        ? new Date(b.lastCheckedAt).getTime()
                        : 0;
                    if (!a.lastCheckedAt && !b.lastCheckedAt) cmp = 0;
                    else if (!a.lastCheckedAt) cmp = 1;
                    else if (!b.lastCheckedAt) cmp = -1;
                    else cmp = ta - tb;
                }
                return sortDir === 'asc' ? cmp : -cmp;
            });
        }

        return result;
    }, [watches, debouncedSearch, sortKey, sortDir]);

    function toggleSort(key: SortKey) {
        if (sortKey === key) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('asc');
        }
    }

    if (!watches?.length) {
        return (
            <div className="rounded-lg border border-dashed border-border bg-card/96 p-8 text-center sm:p-12">
                <div className="text-xs tracking-[0.16em] text-primary">
                    Watchlist Empty
                </div>
                <h2 className="mt-3 font-[family:var(--font-display)] text-4xl tracking-[-0.04em] text-foreground">
                    No targets live.
                </h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                    Add a product URL, define the signal you care about, and let
                    Pounce keep watch.
                </p>
                <Button asChild className="mt-6">
                    <Link href="/watches/new">Add First Watch</Link>
                </Button>
            </div>
        );
    }

    return (
        <section className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <div className="text-xs tracking-[0.16em] text-primary">
                        Live Targets
                    </div>
                    <h2 className="mt-2 font-[family:var(--font-display)] text-2xl tracking-[-0.04em] text-foreground">
                        Watch the board.
                    </h2>
                </div>
                <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search watches..."
                        className="h-8 pl-8 text-sm"
                    />
                </div>
            </div>

            <div className="grid gap-2">
                <div
                    className={`${boardColumnClassName} hidden rounded-md border border-border/60 bg-background/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground lg:grid`}
                >
                    <span>Item</span>
                    <SortButton
                        label="Status"
                        active={sortKey === 'status'}
                        dir={sortDir}
                        onClick={() => toggleSort('status')}
                    />
                    <SortButton
                        label="Price"
                        active={sortKey === 'price'}
                        dir={sortDir}
                        onClick={() => toggleSort('price')}
                    />
                    <SortButton
                        label="Timing"
                        active={sortKey === 'timing'}
                        dir={sortDir}
                        onClick={() => toggleSort('timing')}
                    />
                    <span className="text-right">Reads</span>
                </div>

                {filteredWatches.map((watch) => {
                    const price = formatPrice(watch.lastPrice);
                    const status = normalizeStatus(watch.lastStockStatus);
                    const historyData = getPriceHistoryData(
                        watch.history,
                        watch.checkType as 'price' | 'stock' | 'both',
                    );
                    const readCount = countHistoryReads(
                        watch.history,
                        watch.checkType as 'price' | 'stock' | 'both',
                    );

                    return (
                        <article
                            key={watch.id}
                            className={`group relative overflow-hidden rounded-md border border-border/70 bg-card/96 px-4 py-2.5 transition-colors before:absolute before:bottom-0 before:left-0 before:top-0 before:w-px lg:py-3 ${getWatchAccentClassName(status)} hover:border-primary/25`}
                        >
                            {/* Desktop layout */}
                            <div
                                className={`${boardColumnClassName} hidden lg:grid`}
                            >
                                <div className="min-w-0 lg:pr-3">
                                    <Link
                                        href={`/watches/${watch.id}`}
                                        className="block truncate font-[family:var(--font-display)] text-lg leading-none tracking-[-0.04em] text-foreground transition-colors group-hover:text-primary"
                                    >
                                        {watch.name}
                                    </Link>
                                    <p className="mt-1 min-w-0 truncate text-sm leading-5 text-muted-foreground/90">
                                        {watch.url}
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 lg:pr-3">
                                    <StatusBadge status={status} />
                                    {!watch.isActive ? (
                                        <span
                                            className={`${badgePillClassName} border-border bg-transparent text-[10px] text-muted-foreground`}
                                        >
                                            Paused
                                        </span>
                                    ) : null}
                                </div>

                                <span className="font-[family:var(--font-display)] text-lg leading-none tracking-[-0.03em] text-foreground tabular-nums lg:pr-3">
                                    {price}
                                </span>

                                <div className="space-y-1 lg:pr-3">
                                    <div className="text-xs text-muted-foreground">
                                        Last{' '}
                                        {formatLastChecked(watch.lastCheckedAt)}
                                    </div>
                                    <div className="text-[11px] tracking-[0.04em] text-foreground/78">
                                        {formatNextCheck(
                                            watch.lastCheckedAt,
                                            watch.isActive,
                                            watch.checkIntervalSeconds,
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-end gap-4">
                                    <PriceHistoryChart
                                        data={historyData}
                                        variant="minimal"
                                        className="h-6 w-32 shrink-0"
                                        mode={
                                            watch.checkType === 'stock'
                                                ? 'stock'
                                                : watch.checkType === 'both'
                                                  ? 'both'
                                                  : undefined
                                        }
                                    />
                                    <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                        {readCount}{' '}
                                        {watch.checkType === 'stock'
                                            ? 'checks'
                                            : 'reads'}
                                    </span>
                                </div>
                            </div>

                            {/* Mobile layout */}
                            <div className="space-y-2 lg:hidden">
                                <div className="flex items-center justify-between gap-3">
                                    <Link
                                        href={`/watches/${watch.id}`}
                                        className="min-w-0 truncate font-[family:var(--font-display)] text-base leading-none tracking-[-0.04em] text-foreground transition-colors group-hover:text-primary"
                                    >
                                        {watch.name}
                                    </Link>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <StatusBadge status={status} short />
                                        {!watch.isActive ? (
                                            <span
                                                className={`${badgePillClassName} border-border bg-transparent text-[10px] text-muted-foreground`}
                                            >
                                                Paused
                                            </span>
                                        ) : null}
                                        <span className="font-[family:var(--font-display)] text-base leading-none tracking-[-0.03em] text-foreground tabular-nums">
                                            {price}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0 space-y-0.5">
                                        <div className="text-xs text-muted-foreground">
                                            Last{' '}
                                            {formatLastChecked(
                                                watch.lastCheckedAt,
                                            )}
                                        </div>
                                        <div className="text-[11px] tracking-[0.04em] text-foreground/78">
                                            {formatNextCheck(
                                                watch.lastCheckedAt,
                                                watch.isActive,
                                                watch.checkIntervalSeconds,
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-3">
                                        <PriceHistoryChart
                                            data={historyData}
                                            variant="minimal"
                                            className="h-6 w-24 shrink-0 sm:w-32"
                                            mode={
                                                watch.checkType === 'stock'
                                                    ? 'stock'
                                                    : watch.checkType === 'both'
                                                      ? 'both'
                                                      : undefined
                                            }
                                        />
                                        <span className="hidden shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground sm:inline">
                                            {readCount}{' '}
                                            {watch.checkType === 'stock'
                                                ? 'checks'
                                                : 'reads'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}

function StatusBadge({
    status,
    short,
}: { status: WatchStatus; short?: boolean }) {
    if (!status) {
        return (
            <span
                className={`${badgePillClassName} border-border bg-muted text-muted-foreground`}
            >
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                {short ? '?' : 'Unknown'}
            </span>
        );
    }

    const style = statusStyles[status];
    const shortLabels: Record<NonNullable<WatchStatus>, string> = {
        in_stock: 'In',
        out_of_stock: 'Out',
    };

    return (
        <span className={`${badgePillClassName} ${style.className}`}>
            <span
                className={`h-1.5 w-1.5 rounded-full ${style.pulseClassName}`}
            />
            {short ? shortLabels[status] : style.label}
        </span>
    );
}

function SortButton({
    label,
    active,
    dir,
    onClick,
}: {
    label: string;
    active: boolean;
    dir: 'asc' | 'desc';
    onClick: () => void;
}) {
    const DirIcon = dir === 'asc' ? ArrowUp : ArrowDown;
    return (
        <button
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-1 hover:text-foreground"
        >
            {label}
            {active ? (
                <DirIcon className="h-3 w-3" />
            ) : (
                <ArrowUpDown className="h-3 w-3 opacity-40" />
            )}
        </button>
    );
}

function getWatchAccentClassName(status: WatchStatus) {
    if (!status) {
        return 'before:bg-border/80';
    }

    return statusStyles[status].accentClassName;
}

function formatPrice(value: string | null) {
    if (!value) {
        return '-';
    }

    return `$${Number.parseFloat(value).toFixed(2)}`;
}

function formatLastChecked(value: Date | string | null) {
    if (!value) {
        return 'Never';
    }

    const date = new Date(value);
    return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function formatNextCheck(
    lastCheckedAt: Date | string | null,
    isActive: boolean,
    checkIntervalSeconds: number,
) {
    if (!isActive) {
        return 'Paused';
    }

    if (!lastCheckedAt) {
        return 'Next check ready now';
    }

    const nextCheckAt = new Date(
        new Date(lastCheckedAt).getTime() + checkIntervalSeconds * 1000,
    );

    return `Next check ${nextCheckAt.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    })}`;
}
