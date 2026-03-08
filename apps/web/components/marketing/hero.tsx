import { Badge } from '@pounce/ui/components/badge';
import { Button } from '@pounce/ui/components/button';
import Link from 'next/link';

export function Hero() {
    return (
        <section className="flex flex-col items-center py-16 text-center sm:py-24">
            <Badge variant="outline" className="text-[11px] uppercase tracking-[0.18em]">
                Price Drops + Restocks
            </Badge>

            <h1 className="mt-6 max-w-3xl font-[family:var(--font-display)] text-4xl leading-[0.92] tracking-[-0.05em] text-foreground sm:text-6xl lg:text-7xl">
                Track prices and stock across any site.
            </h1>

            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:mt-6 sm:text-base sm:leading-7">
                Point the Chrome extension at any element on any page. Pounce
                checks 24/7 and sends Telegram alerts when things change.
            </p>

            <Button asChild size="lg" className="mt-8 sm:mt-10">
                <Link href="/login">Get Started</Link>
            </Button>
        </section>
    );
}
