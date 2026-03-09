'use client';

import { api } from '@/trpc/react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

export function TrendSummary({ watchId }: { watchId: string }) {
    const { data: trend } = api.watch.trends.useQuery(
        { watchId },
        { staleTime: 60_000 },
    );

    if (!trend) return null;

    const Icon =
        trend.direction === 'up'
            ? TrendingUp
            : trend.direction === 'down'
              ? TrendingDown
              : Minus;

    const colorClass =
        trend.direction === 'down'
            ? 'text-emerald-400'
            : trend.direction === 'up'
              ? 'text-red-300'
              : 'text-muted-foreground';

    return (
        <div className={`mt-2 flex items-center gap-1.5 ${colorClass}`}>
            <Icon className="size-3.5" />
            <span className="text-[11px] font-semibold tabular-nums tracking-[0.06em]">
                {trend.direction === 'stable'
                    ? 'Stable'
                    : `${trend.direction === 'down' ? '' : '+'}${trend.percentChange7d}%`}
            </span>
            <span className="text-[10px] tracking-[0.08em] opacity-70">
                7d · ${trend.priceMin7d.toFixed(2)}–${trend.priceMax7d.toFixed(2)}
            </span>
        </div>
    );
}
