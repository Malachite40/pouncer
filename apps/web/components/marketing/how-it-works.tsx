import Link from 'next/link';
import { Button } from '@pounce/ui/components/button';

export function HowItWorks() {
    return (
        <section className="py-12 sm:py-16">
            <div className="text-center">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary/90">
                    How it works
                </div>
                <h2 className="mt-2 font-[family:var(--font-display)] text-2xl tracking-[-0.04em] text-foreground sm:text-3xl">
                    Two steps to autopilot.
                </h2>
            </div>

            {/* Step 1 — text left, image right */}
            <div className="mt-8 grid items-center gap-8 sm:mt-10 md:grid-cols-2 md:gap-12">
                <div>
                    <div className="font-[family:var(--font-display)] text-3xl leading-none tracking-[-0.05em] text-primary/90">
                        01
                    </div>
                    <h3 className="mt-3 font-[family:var(--font-display)] text-xl tracking-[-0.03em] text-foreground sm:text-2xl">
                        Track any price or button with the Chrome extension
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
                        Browse to any product page, click the Pounce extension in
                        your toolbar, and select the price or stock element you
                        want to track. No setup, no configuration — just point and
                        click.
                    </p>
                </div>
                <div className="overflow-hidden rounded-lg border border-border/80 bg-card/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/select-button.png"
                        alt="Selecting a price element with the Pounce Chrome extension"
                        className="h-auto w-full"
                    />
                </div>
            </div>

            {/* Step 2 — image left, text right */}
            <div className="mt-12 grid items-center gap-8 sm:mt-16 md:grid-cols-2 md:gap-12">
                <div className="overflow-hidden rounded-lg border border-border/80 bg-card/40 md:order-first">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/connect-to-telegram.png"
                        alt="Connecting Telegram to receive Pounce alerts"
                        className="h-auto w-full"
                    />
                </div>
                <div className="order-first md:order-last">
                    <div className="font-[family:var(--font-display)] text-3xl leading-none tracking-[-0.05em] text-primary/90">
                        02
                    </div>
                    <h3 className="mt-3 font-[family:var(--font-display)] text-xl tracking-[-0.03em] text-foreground sm:text-2xl">
                        Connect Telegram and get alerts
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
                        Connect your Telegram account in settings, and Pounce
                        monitors 24/7. The moment a price drops or an item
                        restocks, you get a notification — no need to check
                        manually ever again.
                    </p>
                    <Button asChild className="mt-4">
                        <Link href="/login">Get started now</Link>
                    </Button>
                </div>
            </div>
        </section>
    );
}
