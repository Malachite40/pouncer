'use client';

import {
    type CheckType,
    countHistoryReads,
    getPriceHistoryData,
    normalizeStatus,
} from '@/app/watch-history';
import { api } from '@/trpc/react';
import { Button } from '@pounce/ui/components/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@pounce/ui/components/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@pounce/ui/components/dropdown-menu';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
    InputGroupText,
} from '@pounce/ui/components/input-group';
import { Label } from '@pounce/ui/components/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@pounce/ui/components/select';
import { PriceHistoryChart } from '@pounce/ui/components/price-history-chart';
import { Switch } from '@pounce/ui/components/switch';
import {
    BellIcon,
    CheckIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    CrosshairIcon,
    EllipsisVerticalIcon,
    ExternalLinkIcon,
    PauseIcon,
    PlayIcon,
    RefreshCwIcon,
    TimerIcon,
    Trash2Icon,
} from 'lucide-react';
import { keepPreviousData } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';

const INTERVAL_OPTIONS = [
    { value: '5', label: 'Every 5s', short: '5s' },
    { value: '10', label: 'Every 10s', short: '10s' },
    { value: '30', label: 'Every 30s', short: '30s' },
    { value: '60', label: 'Every 1m', short: '1m' },
    { value: '300', label: 'Every 5m', short: '5m' },
    { value: '900', label: 'Every 15m', short: '15m' },
    { value: '1800', label: 'Every 30m', short: '30m' },
    { value: '3600', label: 'Every 1hr', short: '1hr' },
    { value: '21600', label: 'Every 6hr', short: '6hr' },
    { value: '43200', label: 'Every 12hr', short: '12hr' },
    { value: '86400', label: 'Every 24hr', short: '24hr' },
] as const;

function getIntervalShortLabel(seconds: number): string {
    return (
        INTERVAL_OPTIONS.find((o) => o.value === String(seconds))?.short ??
        `${seconds}s`
    );
}

export function WatchDetailPage() {
    const params = useParams();
    const router = useRouter();
    const utils = api.useUtils();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    const isValidWatchId =
        typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
    const [manualCheckError, setManualCheckError] = useState<string | null>(
        null,
    );
    const [manualCheckComplete, setManualCheckComplete] = useState(false);
    const [pendingManualCheckAt, setPendingManualCheckAt] = useState<
        number | null
    >(null);
    const [notifDialogOpen, setNotifDialogOpen] = useState(false);
    const [historyPage, setHistoryPage] = useState(1);
    const [expandedErrorId, setExpandedErrorId] = useState<number | null>(null);

    const { data: watch } = api.watch.get.useQuery(
        { id: id ?? '' },
        {
            enabled: isValidWatchId,
            refetchInterval: (query) => {
                const watchData = query.state.data;

                if (pendingManualCheckAt !== null) {
                    return 1000;
                }

                if (!watchData?.isActive) {
                    return false;
                }

                return watchData.checkIntervalSeconds * 1000;
            },
            refetchIntervalInBackground: true,
        },
    );
    const {
        data: historyData,
        isPlaceholderData: isHistoryPlaceholder,
    } = api.watch.history.useQuery(
        { watchId: id ?? '', page: historyPage, pageSize: 50 },
        {
            enabled: isValidWatchId,
            placeholderData: keepPreviousData,
            refetchInterval: historyPage === 1 ? () => {
                if (pendingManualCheckAt !== null) return 1000;
                if (!watch?.isActive) return false;
                return (watch?.checkIntervalSeconds ?? 900) * 1000;
            } : false,
        },
    );

    const totalPages = historyData?.totalPages ?? 1;
    const canGoNext = historyPage < totalPages && !isHistoryPlaceholder;
    const canGoPrev = historyPage > 1;

    const checkNow = api.watch.checkNow.useMutation({
        onSuccess: () => {
            setManualCheckError(null);
            setManualCheckComplete(false);
            setHistoryPage(1);
            void utils.watch.get.invalidate({ id: id ?? '' });
            void utils.watch.history.invalidate();
        },
        onError: (error) => {
            setManualCheckError(error.message);
            setManualCheckComplete(false);
            setPendingManualCheckAt(null);
        },
    });
    const toggleActive = api.watch.update.useMutation({
        onMutate: async (input) => {
            await utils.watch.get.cancel({ id: id ?? '' });
            const previous = utils.watch.get.getData({ id: id ?? '' });
            utils.watch.get.setData({ id: id ?? '' }, (old) => {
                if (!old) return old;
                const { priceDropThreshold, priceDropPercentThreshold, priceDropTargetPrice, priceIncreaseThreshold, priceIncreasePercentThreshold, priceIncreaseTargetPrice, notifyCooldownSeconds, ...rest } = input;
                return {
                    ...old,
                    ...rest,
                    ...(priceDropThreshold !== undefined && { priceDropThreshold: priceDropThreshold?.toString() ?? null }),
                    ...(priceDropPercentThreshold !== undefined && { priceDropPercentThreshold: priceDropPercentThreshold?.toString() ?? null }),
                    ...(priceDropTargetPrice !== undefined && { priceDropTargetPrice: priceDropTargetPrice?.toString() ?? null }),
                    ...(priceIncreaseThreshold !== undefined && { priceIncreaseThreshold: priceIncreaseThreshold?.toString() ?? null }),
                    ...(priceIncreasePercentThreshold !== undefined && { priceIncreasePercentThreshold: priceIncreasePercentThreshold?.toString() ?? null }),
                    ...(priceIncreaseTargetPrice !== undefined && { priceIncreaseTargetPrice: priceIncreaseTargetPrice?.toString() ?? null }),
                    ...(notifyCooldownSeconds !== undefined && { notifyCooldownSeconds: notifyCooldownSeconds ?? null }),
                };
            });
            return { previous };
        },
        onError: (_err, _input, context) => {
            if (context?.previous) {
                utils.watch.get.setData({ id: id ?? '' }, context.previous);
            }
        },
        onSettled: () => {
            void utils.watch.get.invalidate({ id: id ?? '' });
            void utils.watch.getMany.invalidate();
        },
    });
    const deleteWatch = api.watch.delete.useMutation({
        onSuccess: () => router.push('/'),
    });

    useEffect(() => {
        if (!watch?.lastCheckedAt || pendingManualCheckAt === null) {
            return;
        }

        const lastCheckedAt = new Date(watch.lastCheckedAt).getTime();

        if (
            Number.isNaN(lastCheckedAt) ||
            lastCheckedAt < pendingManualCheckAt
        ) {
            return;
        }

        setManualCheckComplete(true);
        setPendingManualCheckAt(null);
    }, [pendingManualCheckAt, watch?.lastCheckedAt]);

    if (!isValidWatchId) {
        return (
            <div className="rounded-lg border border-border/80 bg-card/78 p-8 text-sm text-muted-foreground">
                Invalid watch ID.
            </div>
        );
    }

    if (!watch) {
        return (
            <div className="rounded-lg border border-border/80 bg-card/78 p-8 text-sm text-muted-foreground">
                Loading watch data...
            </div>
        );
    }

    const checkType = watch.checkType as CheckType;
    const chartHistoryData = getPriceHistoryData(watch.history, checkType);
    const historyReadCount = countHistoryReads(watch.history, checkType);

    return (
        <div className="space-y-6">
            <Link
                href="/"
                className="inline-flex text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-primary"
            >
                Back to board
            </Link>
            <section className="relative rounded-lg border border-border/80 bg-card/84">
                <div className="relative overflow-hidden rounded-t bg-background/35">
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-4 sm:p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                            <div className="min-w-0 max-w-xl">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
                                        History
                                    </span>
                                    <span className="text-[10px] uppercase tracking-[0.16em] text-primary/80">
                                        {watch.checkType === 'stock'
                                            ? 'Stock trend'
                                            : 'Price trend'}{' '}
                                        · {historyReadCount}{' '}
                                        {watch.checkType === 'stock'
                                            ? 'checks'
                                            : 'reads'}
                                    </span>
                                </div>
                                <h2 className="mt-2 font-[family:var(--font-display)] text-2xl uppercase tracking-[-0.04em] text-foreground break-words sm:text-3xl">
                                    {watch.name}
                                </h2>
                            </div>

                            <div className="min-w-0 sm:text-right">
                                <div className="pointer-events-auto mb-2 flex flex-wrap items-center gap-2 sm:mb-3 sm:justify-end">
                                    <StatusBadge
                                        status={normalizeStatus(
                                            watch.lastStockStatus,
                                        )}
                                    />
                                    <Button
                                        variant="outline"
                                        size="icon-sm"
                                        className="bg-background"
                                        onClick={() =>
                                            toggleActive.mutate({
                                                id,
                                                isActive: !watch.isActive,
                                            })
                                        }
                                    >
                                        {watch.isActive ? (
                                            <PauseIcon className="size-4" />
                                        ) : (
                                            <PlayIcon className="size-4" />
                                        )}
                                        <span className="sr-only">
                                            {watch.isActive
                                                ? 'Pause'
                                                : 'Resume'}
                                        </span>
                                    </Button>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="outline"
                                                size="icon-sm"
                                                className="relative bg-background"
                                            >
                                                <EllipsisVerticalIcon className="size-4" />
                                                {!watch.notifyPriceDrop ||
                                                !watch.notifyPriceIncrease ||
                                                !watch.notifyStock ||
                                                watch.priceDropThreshold ||
                                                watch.priceDropPercentThreshold ||
                                                watch.priceDropTargetPrice ||
                                                watch.priceIncreaseThreshold ||
                                                watch.priceIncreasePercentThreshold ||
                                                watch.priceIncreaseTargetPrice ||
                                                watch.notifyCooldownSeconds ? (
                                                    <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
                                                ) : null}
                                                <span className="sr-only">
                                                    More actions
                                                </span>
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem asChild>
                                                <a
                                                    href={watch.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    <ExternalLinkIcon />
                                                    Open URL
                                                </a>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                disabled={checkNow.isPending}
                                                onSelect={() => {
                                                    setManualCheckError(null);
                                                    setManualCheckComplete(
                                                        false,
                                                    );
                                                    setPendingManualCheckAt(
                                                        Date.now(),
                                                    );
                                                    checkNow.mutate({ id });
                                                }}
                                            >
                                                {manualCheckComplete ? (
                                                    <CheckIcon className="text-emerald-400" />
                                                ) : (
                                                    <RefreshCwIcon
                                                        className={
                                                            checkNow.isPending
                                                                ? 'animate-spin'
                                                                : ''
                                                        }
                                                    />
                                                )}
                                                {checkNow.isPending
                                                    ? 'Checking…'
                                                    : manualCheckComplete
                                                      ? 'Check received'
                                                      : 'Check Now'}
                                            </DropdownMenuItem>
                                            <DropdownMenuSub>
                                                <DropdownMenuSubTrigger>
                                                    <TimerIcon />
                                                    Check Interval
                                                    <DropdownMenuShortcut>
                                                        {getIntervalShortLabel(
                                                            watch.checkIntervalSeconds,
                                                        )}
                                                    </DropdownMenuShortcut>
                                                </DropdownMenuSubTrigger>
                                                <DropdownMenuSubContent>
                                                    <DropdownMenuRadioGroup
                                                        value={String(
                                                            watch.checkIntervalSeconds,
                                                        )}
                                                        onValueChange={(
                                                            value,
                                                        ) =>
                                                            toggleActive.mutate(
                                                                {
                                                                    id,
                                                                    checkIntervalSeconds:
                                                                        Number(
                                                                            value,
                                                                        ),
                                                                },
                                                            )
                                                        }
                                                    >
                                                        {INTERVAL_OPTIONS.map(
                                                            (opt) => (
                                                                <DropdownMenuRadioItem
                                                                    key={
                                                                        opt.value
                                                                    }
                                                                    value={
                                                                        opt.value
                                                                    }
                                                                >
                                                                    {opt.label}
                                                                </DropdownMenuRadioItem>
                                                            ),
                                                        )}
                                                    </DropdownMenuRadioGroup>
                                                </DropdownMenuSubContent>
                                            </DropdownMenuSub>
                                            <DropdownMenuItem
                                                onSelect={() =>
                                                    setNotifDialogOpen(true)
                                                }
                                            >
                                                <BellIcon />
                                                Notifications
                                                {!watch.notifyPriceDrop ||
                                                !watch.notifyPriceIncrease ||
                                                !watch.notifyStock ||
                                                watch.priceDropThreshold ||
                                                watch.priceDropPercentThreshold ||
                                                watch.priceDropTargetPrice ||
                                                watch.priceIncreaseThreshold ||
                                                watch.priceIncreasePercentThreshold ||
                                                watch.priceIncreaseTargetPrice ||
                                                watch.notifyCooldownSeconds ? (
                                                    <span className="ml-auto size-2 rounded-full bg-primary" />
                                                ) : null}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                variant="destructive"
                                                onSelect={() => {
                                                    if (
                                                        confirm(
                                                            'Delete this watch?',
                                                        )
                                                    ) {
                                                        deleteWatch.mutate({
                                                            id,
                                                        });
                                                    }
                                                }}
                                            >
                                                <Trash2Icon />
                                                Delete Watch
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                                {watch.checkType !== 'stock' && (
                                    <>
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                            Current price
                                        </div>
                                        <div className="mt-1 font-[family:var(--font-display)] text-2xl leading-none tracking-[-0.05em] text-foreground sm:text-4xl">
                                            {formatPrice(watch.lastPrice)}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="absolute inset-x-0 top-0 h-28 bg-linear-to-b from-background via-background/78 to-transparent sm:h-32" />
                    <PriceHistoryChart
                        data={chartHistoryData}
                        className="h-64 sm:h-72"
                        hideXAxis
                        mode={
                            checkType === 'stock'
                                ? 'stock'
                                : checkType === 'both'
                                  ? 'both'
                                  : 'price'
                        }
                    />
                </div>

                {manualCheckError ? (
                    <p className="px-4 pt-4 text-[11px] uppercase tracking-[0.14em] text-destructive sm:px-5">
                        {manualCheckError}
                    </p>
                ) : null}

                {historyData && historyData.items.length > 0 ? (
                    <div className="mt-4">
                        {/* Mobile history list */}
                        <div className="md:hidden">
                            {historyData.items.map((check) => {
                                const hasError = !!check.error;
                                const isExpanded = expandedErrorId === check.id;
                                return (
                                    <Fragment key={check.id}>
                                        <div
                                            className={`flex items-center justify-between border-t border-border/30 px-4 py-1.5${hasError ? ' cursor-pointer active:bg-muted/30' : ''}`}
                                            onClick={hasError ? () => setExpandedErrorId(isExpanded ? null : check.id) : undefined}
                                        >
                                            <span className="text-[11px] tabular-nums text-foreground/58">
                                                {formatCompact(check.checkedAt)}
                                            </span>
                                            <div className="flex items-center gap-3">
                                                {hasError && <span className="inline-block size-1.5 rounded-full bg-destructive" />}
                                                <StockDot status={normalizeStatus(check.stockStatus)} />
                                                <span className="min-w-[4.5rem] text-right text-sm tabular-nums text-foreground">
                                                    {formatPrice(check.price)}
                                                </span>
                                            </div>
                                        </div>
                                        {isExpanded && (
                                            <div className="border-t border-border/10 px-4 py-2 text-xs leading-5 text-destructive/90">
                                                {check.error}
                                            </div>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </div>

                        {/* Desktop history table */}
                        <div className="hidden md:block">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-border/40 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                                        <th className="px-4 py-1.5 font-semibold">When</th>
                                        <th className="px-4 py-1.5 font-semibold">Price</th>
                                        <th className="px-4 py-1.5 font-semibold">Stock</th>
                                        <th className="px-4 py-1.5 font-semibold">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {historyData.items.map((check) => {
                                        const hasError = !!check.error;
                                        const isExpanded = expandedErrorId === check.id;
                                        return (
                                            <Fragment key={check.id}>
                                                <tr
                                                    className={`border-t border-border/20 text-sm${hasError ? ' cursor-pointer hover:bg-muted/30' : ''}`}
                                                    onClick={hasError ? () => setExpandedErrorId(isExpanded ? null : check.id) : undefined}
                                                >
                                                    <td className="px-4 py-1 text-[11px] tabular-nums text-foreground/58">
                                                        {formatCompact(check.checkedAt)}
                                                    </td>
                                                    <td className="px-4 py-1 tabular-nums text-foreground">
                                                        {formatPrice(check.price)}
                                                    </td>
                                                    <td className="px-4 py-1">
                                                        <StockDot status={normalizeStatus(check.stockStatus)} />
                                                    </td>
                                                    <td className="px-4 py-1">
                                                        {hasError ? (
                                                            <span className="text-[10px] uppercase tracking-[0.12em] text-destructive/80">err</span>
                                                        ) : (
                                                            <span className="text-[10px] uppercase tracking-[0.12em] text-emerald-400/60">ok</span>
                                                        )}
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr className="border-t border-border/10">
                                                        <td colSpan={4} className="px-4 py-2 text-xs leading-5 text-destructive/90">
                                                            {check.error}
                                                        </td>
                                                    </tr>
                                                )}
                                            </Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination controls */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between border-t border-border/30 px-4 py-2 sm:px-5">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-[11px] uppercase tracking-[0.12em]"
                                    disabled={!canGoPrev}
                                    onClick={() => setHistoryPage((p) => Math.max(p - 1, 1))}
                                >
                                    <ChevronLeftIcon className="size-3.5" />
                                    Prev
                                </Button>
                                <span className={`text-[10px] tabular-nums tracking-[0.12em] ${isHistoryPlaceholder ? 'text-muted-foreground/40' : 'text-muted-foreground/70'}`}>
                                    {historyPage} / {totalPages}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-[11px] uppercase tracking-[0.12em]"
                                    disabled={!canGoNext}
                                    onClick={() => setHistoryPage((p) => Math.min(p + 1, totalPages))}
                                >
                                    Next
                                    <ChevronRightIcon className="size-3.5" />
                                </Button>
                            </div>
                        )}
                    </div>
                ) : historyData ? (
                    <p className="mt-6 text-sm leading-6 text-muted-foreground">
                        No checks yet. Run a manual check to capture the first
                        signal.
                    </p>
                ) : null}

                <Dialog
                    open={notifDialogOpen}
                    onOpenChange={setNotifDialogOpen}
                >
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Notification Preferences</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <Label
                                    htmlFor="detail-notify-price-drop"
                                    className="text-sm font-medium text-foreground"
                                >
                                    Notify on price drop
                                </Label>
                                <Switch
                                    id="detail-notify-price-drop"
                                    checked={watch.notifyPriceDrop}
                                    onCheckedChange={(checked) =>
                                        toggleActive.mutate({
                                            id,
                                            notifyPriceDrop: checked,
                                        })
                                    }
                                />
                            </div>
                            {watch.notifyPriceDrop ? (
                                <DropThresholdSection
                                    watch={watch}
                                    onCommit={(fields) => toggleActive.mutate({ id, ...fields })}
                                />
                            ) : null}
                            <div className="flex items-center justify-between gap-3">
                                <Label
                                    htmlFor="detail-notify-price-increase"
                                    className="text-sm font-medium text-foreground"
                                >
                                    Notify on price increase
                                </Label>
                                <Switch
                                    id="detail-notify-price-increase"
                                    checked={watch.notifyPriceIncrease}
                                    onCheckedChange={(checked) =>
                                        toggleActive.mutate({
                                            id,
                                            notifyPriceIncrease: checked,
                                        })
                                    }
                                />
                            </div>
                            {watch.notifyPriceIncrease ? (
                                <IncreaseThresholdSection
                                    watch={watch}
                                    onCommit={(fields) => toggleActive.mutate({ id, ...fields })}
                                />
                            ) : null}
                            <div className="flex items-center justify-between gap-3">
                                <Label
                                    htmlFor="detail-notify-stock"
                                    className="text-sm font-medium text-foreground"
                                >
                                    Notify on availability change
                                </Label>
                                <Switch
                                    id="detail-notify-stock"
                                    checked={watch.notifyStock}
                                    onCheckedChange={(checked) =>
                                        toggleActive.mutate({
                                            id,
                                            notifyStock: checked,
                                        })
                                    }
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="text-sm font-medium text-foreground">Cooldown</span>
                                    <span className="text-[11px] tracking-[0.12em] text-muted-foreground">Min time between alerts.</span>
                                </div>
                                <Select
                                    value={String(watch.notifyCooldownSeconds ?? 'none')}
                                    onValueChange={(v) =>
                                        toggleActive.mutate({
                                            id,
                                            notifyCooldownSeconds: v === 'none' ? null : Number(v),
                                        })
                                    }
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="None" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None</SelectItem>
                                        <SelectItem value="900">15 minutes</SelectItem>
                                        <SelectItem value="1800">30 minutes</SelectItem>
                                        <SelectItem value="3600">1 hour</SelectItem>
                                        <SelectItem value="21600">6 hours</SelectItem>
                                        <SelectItem value="43200">12 hours</SelectItem>
                                        <SelectItem value="86400">24 hours</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </section>
        </div>
    );
}

function StatusBadge({
    status,
    size,
}: {
    status: 'in_stock' | 'out_of_stock' | null;
    size?: 'lg';
}) {
    const sizeClassName =
        size === 'lg'
            ? 'px-3 py-1 text-sm gap-2.5'
            : 'px-2 py-0.5 text-[11px] gap-2';

    if (status === 'in_stock') {
        return (
            <span
                className={`inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/12 font-semibold uppercase tracking-[0.16em] text-emerald-300 ${sizeClassName}`}
            >
                <span className="h-2 w-2 rounded-md bg-emerald-400" />
                In Stock
            </span>
        );
    }

    if (status === 'out_of_stock') {
        return (
            <span
                className={`inline-flex items-center rounded-md border border-destructive/40 bg-destructive/12 font-semibold uppercase tracking-[0.16em] text-red-200 ${sizeClassName}`}
            >
                <span className="h-2 w-2 rounded-md bg-destructive" />
                Out of Stock
            </span>
        );
    }

    return (
        <span
            className={`inline-flex items-center rounded-md border border-border bg-muted/70 font-semibold uppercase tracking-[0.16em] text-muted-foreground ${sizeClassName}`}
        >
            <span className="h-2 w-2 rounded-md bg-muted-foreground/60" />
            Unknown
        </span>
    );
}

function StockDot({ status }: { status: 'in_stock' | 'out_of_stock' | null }) {
    if (status === 'in_stock') {
        return (
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-emerald-400">
                <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
                in
            </span>
        );
    }
    if (status === 'out_of_stock') {
        return (
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-destructive/80">
                <span className="inline-block size-1.5 rounded-full bg-destructive" />
                out
            </span>
        );
    }
    return <span className="inline-block size-1.5 rounded-full bg-muted-foreground/30" title="Unknown" />;
}

function formatCompact(value: Date | string) {
    const d = new Date(value);
    return d.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function formatPrice(value: string | null) {
    if (!value) {
        return 'Awaiting';
    }

    return `$${Number.parseFloat(value).toFixed(2)}`;
}

type ThresholdMode = 'abs' | 'pct' | 'target';

function ModeToggle({ mode, onModeChange }: { mode: ThresholdMode; onModeChange: (mode: ThresholdMode) => void }) {
    const btn = (value: ThresholdMode, children: React.ReactNode) => (
        <button
            type="button"
            className={`flex items-center justify-center px-2 py-1.5 text-xs font-medium transition-colors ${mode === value ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
            onClick={() => onModeChange(value)}
        >
            {children}
        </button>
    );
    return (
        <div className="flex shrink-0 overflow-hidden rounded-md border border-border/60">
            {btn('abs', '$')}
            {btn('pct', '%')}
            {btn('target', <CrosshairIcon className="size-3.5" />)}
        </div>
    );
}

function DropThresholdSection({ watch, onCommit }: {
    watch: { priceDropThreshold: string | null; priceDropPercentThreshold: string | null; priceDropTargetPrice: string | null };
    onCommit: (fields: Record<string, number | null>) => void;
}) {
    const [mode, setMode] = useState<ThresholdMode>(
        watch.priceDropThreshold ? 'abs' : watch.priceDropPercentThreshold ? 'pct' : 'target',
    );

    return (
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center gap-2">
                <ModeToggle mode={mode} onModeChange={(m) => {
                    setMode(m);
                    if (m === 'abs') onCommit({ priceDropPercentThreshold: null, priceDropTargetPrice: null });
                    else if (m === 'pct') onCommit({ priceDropThreshold: null, priceDropTargetPrice: null });
                    else onCommit({ priceDropThreshold: null, priceDropPercentThreshold: null });
                }} />
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Price Drop Alerts</span>
            </div>
            {mode === 'abs' ? (
                <ThresholdInput label="Min change" hint="Skip drops smaller than this" prefix="$" value={watch.priceDropThreshold} onCommit={(v) => onCommit({ priceDropThreshold: v })} />
            ) : mode === 'pct' ? (
                <ThresholdInput label="Min change" hint="Skip drops smaller than this" suffix="%" value={watch.priceDropPercentThreshold} onCommit={(v) => onCommit({ priceDropPercentThreshold: v })} />
            ) : (
                <ThresholdInput label="Target price" hint="Only alert when price is at or below this" prefix="$" value={watch.priceDropTargetPrice} onCommit={(v) => onCommit({ priceDropTargetPrice: v })} />
            )}
        </div>
    );
}

function IncreaseThresholdSection({ watch, onCommit }: {
    watch: { priceIncreaseThreshold: string | null; priceIncreasePercentThreshold: string | null; priceIncreaseTargetPrice: string | null };
    onCommit: (fields: Record<string, number | null>) => void;
}) {
    const [mode, setMode] = useState<ThresholdMode>(
        watch.priceIncreaseThreshold ? 'abs' : watch.priceIncreasePercentThreshold ? 'pct' : 'target',
    );

    return (
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center gap-2">
                <ModeToggle mode={mode} onModeChange={(m) => {
                    setMode(m);
                    if (m === 'abs') onCommit({ priceIncreasePercentThreshold: null, priceIncreaseTargetPrice: null });
                    else if (m === 'pct') onCommit({ priceIncreaseThreshold: null, priceIncreaseTargetPrice: null });
                    else onCommit({ priceIncreaseThreshold: null, priceIncreasePercentThreshold: null });
                }} />
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Price Increase Alerts</span>
            </div>
            {mode === 'abs' ? (
                <ThresholdInput label="Min change" hint="Skip increases smaller than this" prefix="$" value={watch.priceIncreaseThreshold} onCommit={(v) => onCommit({ priceIncreaseThreshold: v })} />
            ) : mode === 'pct' ? (
                <ThresholdInput label="Min change" hint="Skip increases smaller than this" suffix="%" value={watch.priceIncreasePercentThreshold} onCommit={(v) => onCommit({ priceIncreasePercentThreshold: v })} />
            ) : (
                <ThresholdInput label="Target price" hint="Only alert when price is at or above this" prefix="$" value={watch.priceIncreaseTargetPrice} onCommit={(v) => onCommit({ priceIncreaseTargetPrice: v })} />
            )}
        </div>
    );
}

function ThresholdInput({
    label,
    hint,
    prefix,
    suffix,
    value,
    onCommit,
}: {
    label: string;
    hint?: string;
    prefix?: string;
    suffix?: string;
    value: string | null;
    onCommit: (value: number | null) => void;
}) {
    const [draft, setDraft] = useState(value ?? '');

    useEffect(() => {
        setDraft(value ?? '');
    }, [value]);

    return (
        <div className="min-w-0 flex-1 space-y-1">
            <span className="text-[11px] tracking-[0.1em] text-muted-foreground">{label}</span>
            {hint ? <span className="block text-[10px] text-muted-foreground/70">{hint}</span> : null}
            <InputGroup className="bg-background">
                {prefix ? (
                    <InputGroupAddon>
                        <InputGroupText>{prefix}</InputGroupText>
                    </InputGroupAddon>
                ) : null}
                <InputGroupInput
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                        const num = Number(draft);
                        const next = draft && num > 0 ? num : null;
                        const current = value ? Number(value) : null;
                        if (next !== current) {
                            onCommit(next);
                        }
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                />
                {suffix ? (
                    <InputGroupAddon align="inline-end">
                        <InputGroupText>{suffix}</InputGroupText>
                    </InputGroupAddon>
                ) : null}
            </InputGroup>
        </div>
    );
}
