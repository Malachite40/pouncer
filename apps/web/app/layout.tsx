import { UserButton } from '@/components/user-button';
import { TRPCReactProvider } from '@/trpc/react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import type { Metadata } from 'next';
import { IBM_Plex_Sans, Oswald } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const sans = IBM_Plex_Sans({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-sans',
});

const display = Oswald({
    subsets: ['latin'],
    weight: ['500', '600', '700'],
    variable: '--font-display',
});

export const metadata: Metadata = {
    title: 'Pounce',
    description: 'Catch price drops and restocks with Telegram alerts',
};

const navItems = [
    { href: '/', label: 'Board' },
    { href: '/watches/new', label: 'New Watch' },
    { href: '/settings', label: 'Alerts' },
];

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className="dark">
            <body
                className={`${sans.variable} ${display.variable} ${sans.className}`}
            >
                <TRPCReactProvider>
                  <NuqsAdapter>
                    <div className="relative min-h-screen overflow-hidden">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-border/80" />

                        <header className="fixed inset-x-0 top-0 z-30 border-b border-border/70 bg-background/88 backdrop-blur-md md:sticky">
                            <div className="mx-auto flex min-h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:min-h-16 sm:px-6 md:py-0">
                                <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-6">
                                    <Link
                                        href="/"
                                        className="flex shrink-0 items-center gap-3"
                                    >
                                        <div className="leading-none">
                                            <div className="font-[family:var(--font-display)] text-xl tracking-[-0.04em] text-foreground sm:text-2xl">
                                                Pounce
                                            </div>
                                            <div className="hidden text-[10px] tracking-[0.12em] text-muted-foreground sm:block">
                                                Price Drops + Restocks
                                            </div>
                                        </div>
                                    </Link>

                                    <nav className="hidden items-center gap-2 md:flex">
                                        {navItems.map((item) => (
                                            <Link
                                                key={item.href}
                                                href={item.href}
                                                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                                            >
                                                {item.label}
                                            </Link>
                                        ))}
                                    </nav>

                                    <div className="relative min-w-0 md:hidden">
                                        <nav className="flex gap-1.5 overflow-x-auto pr-6 scrollbar-none">
                                            {navItems.map((item) => (
                                                <Link
                                                    key={item.href}
                                                    href={item.href}
                                                    className="shrink-0 rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                                                >
                                                    {item.label}
                                                </Link>
                                            ))}
                                        </nav>
                                        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background/88 to-transparent" />
                                    </div>
                                </div>

                                <UserButton />
                            </div>
                        </header>

                        <div className="h-14 md:hidden" />
                        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
                            {children}
                        </main>
                    </div>
                  </NuqsAdapter>
                </TRPCReactProvider>
            </body>
        </html>
    );
}
