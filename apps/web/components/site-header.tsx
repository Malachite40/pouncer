import { auth } from '@/auth';
import { UserButton } from '@/components/user-button';
import { Button } from '@pounce/ui/components/button';
import { headers } from 'next/headers';
import Link from 'next/link';

const navItems = [
    { href: '/', label: 'Board' },
    { href: '/watches/new', label: 'New Watch' },
    { href: '/settings', label: 'Alerts' },
];

export async function SiteHeader() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    return (
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

                    {session ? (
                        <>
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
                        </>
                    ) : null}
                </div>

                {session ? (
                    <UserButton />
                ) : (
                    <Button asChild variant="outline" size="sm">
                        <Link href="/login">Sign in</Link>
                    </Button>
                )}
            </div>
        </header>
    );
}
