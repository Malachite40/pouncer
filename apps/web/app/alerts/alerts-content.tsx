'use client';

import { api } from '@/trpc/react';
import { Badge } from '@pounce/ui/components/badge';
import { Button } from '@pounce/ui/components/button';
import { keepPreviousData } from '@tanstack/react-query';
import Link from 'next/link';
import { parseAsInteger, useQueryState } from 'nuqs';

const TYPE_LABELS: Record<string, { label: string; className: string }> = {
    price_drop: {
        label: 'Price Drop',
        className: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300',
    },
    price_increase: {
        label: 'Price Increase',
        className: 'border-destructive/40 bg-destructive/12 text-red-200',
    },
    back_in_stock: {
        label: 'Back in Stock',
        className: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300',
    },
    out_of_stock: {
        label: 'Out of Stock',
        className: 'border-zinc-500/30 bg-zinc-500/12 text-zinc-300',
    },
};

function stripHtml(html: string) {
    return html.replace(/<[^>]*>/g, '').replace(/\n/g, ' ').trim();
}

export default function AlertsContent() {
    const [page, setPage] = useQueryState(
        'page',
        parseAsInteger.withDefault(1),
    );
    const [pageSize] = useQueryState(
        'pageSize',
        parseAsInteger.withDefault(50),
    );

    const { data, isPlaceholderData } = api.notification.history.useQuery(
        { page, pageSize },
        { placeholderData: keepPreviousData },
    );

    const items = data?.items ?? [];
    const totalPages = data?.totalPages ?? 0;

    return (
        <div className="space-y-6">
            <div>
                <div className="text-xs tracking-[0.16em] text-primary">
                    History
                </div>
                <h1 className="mt-2 font-[family:var(--font-display)] text-3xl tracking-[-0.04em] text-foreground sm:text-4xl">
                    Sent Alerts
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Every notification Pounce has fired, newest first.
                </p>
            </div>

            {items.length === 0 && !isPlaceholderData ? (
                <div className="rounded-lg border border-border/80 bg-card/96 p-12 text-center">
                    <p className="text-sm text-muted-foreground">
                        No alerts sent yet. Alerts will appear here once your
                        watches trigger notifications.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {items.map((item) => {
                        const typeInfo = TYPE_LABELS[item.type] ?? {
                            label: item.type,
                            className:
                                'border-zinc-500/30 bg-zinc-500/12 text-zinc-300',
                        };
                        return (
                            <div
                                key={item.id}
                                className={`rounded-lg border border-border/80 bg-card/96 p-4 transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}
                            >
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <Badge
                                            variant="outline"
                                            className={`shrink-0 ${typeInfo.className}`}
                                        >
                                            {typeInfo.label}
                                        </Badge>
                                        {item.watchName ? (
                                            <Link
                                                href={`/watches/${item.watchId}`}
                                                className="truncate text-sm font-medium text-foreground hover:underline"
                                            >
                                                {item.watchName}
                                            </Link>
                                        ) : (
                                            <span className="truncate text-sm text-muted-foreground">
                                                Deleted watch
                                            </span>
                                        )}
                                    </div>
                                    <time className="shrink-0 text-xs text-muted-foreground">
                                        {new Date(item.sentAt).toLocaleString()}
                                    </time>
                                </div>
                                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                                    {stripHtml(item.message)}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                    >
                        Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        Page {page} of {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => setPage(page + 1)}
                    >
                        Next
                    </Button>
                </div>
            )}
        </div>
    );
}
