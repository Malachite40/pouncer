import { SiteHeader } from '@/components/site-header';
import { TRPCReactProvider } from '@/trpc/react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import type { Metadata } from 'next';
import { IBM_Plex_Sans, Oswald } from 'next/font/google';
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

                        <SiteHeader />

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
