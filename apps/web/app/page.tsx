import { HydrateClient, api } from "@/trpc/server";
import { redirect } from "next/navigation";
import { WatchList } from "./watch-list";

export default async function Home() {
  let watches: Awaited<ReturnType<typeof api.watch.list>>;
  try {
    watches = await api.watch.list();
  } catch (e: unknown) {
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      e.code === "UNAUTHORIZED"
    ) {
      redirect("/login");
    }
    throw e;
  }

  const activeCount = watches.filter((watch) => watch.isActive).length;
  const inStockCount = watches.filter(
    (watch) => watch.lastStockStatus === "in_stock",
  ).length;
  const priceCount = watches.filter((watch) => watch.lastPrice).length;
  const nextRuns = watches
    .filter((watch) => watch.isActive)
    .map((watch) => ({
      id: watch.id,
      name: watch.name,
      nextRunAt: getNextRunAt(watch.lastCheckedAt, watch.checkIntervalSeconds),
    }))
    .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime())
    .slice(0, 5);

  return (
    <HydrateClient>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-lg border border-border/80 bg-card/96">
          <div className="grid gap-0 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.85fr)]">
            <div className="relative p-3 sm:p-6">
              <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-px bg-border/60 xl:block" />
              <div className="space-y-3 sm:space-y-6">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary/90">
                    Watch Board
                  </div>
                  <h1 className="mt-1.5 max-w-2xl font-[family:var(--font-display)] text-2xl leading-[0.92] tracking-[-0.05em] text-foreground sm:mt-3 sm:text-5xl">
                    Track price and stock.
                  </h1>
                  <p className="mt-1.5 max-w-lg text-xs leading-5 text-muted-foreground sm:mt-3 sm:text-sm sm:leading-6">
                    Clean signals, fast scans, Telegram alerts when anything
                    changes.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border/70 bg-border/60">
                  <MetricCard
                    label="Active"
                    value={activeCount}
                    detail={`${watches.length - activeCount} paused`}
                  />
                  <MetricCard
                    label="In stock"
                    value={inStockCount}
                    detail={`${Math.max(watches.length - inStockCount, 0)} waiting`}
                  />
                  <MetricCard
                    label="Priced"
                    value={priceCount}
                    detail={`${watches.length - priceCount} pending`}
                  />
                </div>

                <div className="hidden flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:flex sm:gap-x-5 sm:gap-y-2 sm:pt-3 sm:text-[11px]">
                  <span>{watches.length} total watches</span>
                  <span className="text-primary/85">Live board</span>
                  <span>Fastest signal first</span>
                </div>
              </div>
            </div>

            <div className="hidden bg-background/18 p-3 sm:p-6 xl:block">
              <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Next runs
                </div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-primary/80">
                  active only
                </div>
              </div>

              {nextRuns.length ? (
                <div className="mt-3 space-y-1.5">
                  {nextRuns.map((watch, index) => (
                    <div
                      key={watch.id}
                      className="flex flex-col gap-2 rounded-md border border-transparent px-2 py-2 transition-colors hover:border-primary/20 hover:bg-card/70 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                    >
                      <div className="min-w-0 flex items-start gap-3 sm:items-center">
                        <div className="font-[family:var(--font-display)] text-lg leading-none tracking-[-0.05em] text-primary/90">
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div className="text-sm text-foreground break-words">
                          {watch.name}
                        </div>
                      </div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground sm:shrink-0 sm:text-right">
                        {formatNextRunLabel(watch.nextRunAt)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 text-sm text-muted-foreground">
                  No active watches.
                </div>
              )}
            </div>
          </div>
        </section>

        <WatchList />
      </div>
    </HydrateClient>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="min-w-0 bg-background/38 px-2 py-2.5 sm:px-4 sm:py-4">
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:text-[10px] sm:tracking-[0.18em]">
        {label}
      </div>
      <div className="mt-1.5 font-[family:var(--font-display)] text-2xl leading-none tracking-[-0.06em] text-foreground sm:mt-3 sm:text-[2.6rem]">
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.06em] text-muted-foreground sm:mt-2 sm:text-[11px] sm:tracking-[0.14em]">
        {detail}
      </div>
    </div>
  );
}

function getNextRunAt(
  lastCheckedAt: Date | string | null,
  checkIntervalSeconds: number,
) {
  if (!lastCheckedAt) {
    return new Date(0);
  }

  return new Date(
    new Date(lastCheckedAt).getTime() + checkIntervalSeconds * 1000,
  );
}

function formatNextRunLabel(nextRunAt: Date) {
  if (nextRunAt.getTime() <= Date.now()) {
    return "now";
  }

  return nextRunAt.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
