import { Badge } from "@pounce/ui/components/badge";
import { Button } from "@pounce/ui/components/button";
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative flex flex-col items-center py-16 text-center sm:py-24">
      {/* Radar ping effect */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {/* Warm radial wash */}
        <div
          className="absolute top-1/2 left-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30"
          style={{
            background:
              "radial-gradient(circle, oklch(0.68 0.19 43 / 0.4) 0%, oklch(0.68 0.19 43 / 0.08) 40%, transparent 70%)",
          }}
        />

        {/* Pulsing rings */}
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="absolute top-1/2 left-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              boxShadow:
                "0 0 15px 2px oklch(0.68 0.19 43 / 0.12), inset 0 0 15px 2px oklch(0.68 0.19 43 / 0.06)",
              animation: "var(--animate-hero-ping)",
              animationDelay: `${i * 1.5}s`,
              animationFillMode: "backwards",
            }}
          />
        ))}
        {/* Rotating sweep beam */}
        <div
          className="absolute top-1/2 left-1/2 h-[600px] w-[600px] rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, transparent 300deg, oklch(0.68 0.19 43 / 0.12) 345deg, oklch(0.68 0.19 43 / 0.2) 360deg)",
            animation: "var(--animate-hero-sweep)",
            maskImage:
              "radial-gradient(circle, transparent 5%, black 15%, black 60%, transparent 70%)",
            WebkitMaskImage:
              "radial-gradient(circle, transparent 5%, black 15%, black 60%, transparent 70%)",
          }}
        />
        {/* Center pulse dot */}
        <div
          className="absolute top-1/2 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
          style={{
            boxShadow: "0 0 20px 6px oklch(0.68 0.19 43 / 0.5)",
            animation: "var(--animate-hero-pulse)",
          }}
        />
      </div>
      <Badge
        variant="outline"
        className="text-[11px] uppercase tracking-[0.18em]"
      >
        Price Drops + Restocks
      </Badge>

      <h1 className="mt-6 max-w-3xl font-[family:var(--font-display)] text-4xl leading-[0.92] tracking-[-0.05em] text-foreground sm:text-6xl lg:text-7xl">
        Track prices and stock
        <br />
        across any site.
      </h1>

      <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:mt-6 sm:text-base sm:leading-7">
        Point the Chrome extension at any element on any page. Pounce checks
        24/7 and sends Telegram alerts when things change.
      </p>

      <Button asChild size="lg" className="mt-8 sm:mt-10">
        <Link href="/login">Get Started</Link>
      </Button>
    </section>
  );
}
