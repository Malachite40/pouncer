import { auth } from '@/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginButton } from './login-button';

export default async function LoginPage() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    if (session) {
        redirect('/');
    }

    return (
        <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center">
            <section className="w-full max-w-2xl rounded-lg border border-border/80 bg-card/84 p-8 text-center shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04),0_18px_50px_rgb(0_0_0_/_0.22)]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
                    Operator Access
                </div>
                <h1 className="mt-4 font-[family:var(--font-display)] text-5xl uppercase leading-none tracking-[-0.05em] text-foreground sm:text-6xl">
                    Sign in and start tracking.
                </h1>
                <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                    Get into the board, launch new watches for price drops and
                    restocks, and route alerts where they need to land.
                </p>
                <div className="mx-auto mt-8 max-w-sm">
                    <LoginButton />
                </div>
            </section>
        </div>
    );
}
