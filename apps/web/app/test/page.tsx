'use client';

import { api } from '@/trpc/react';
import { Button } from '@pounce/ui/components/button';
import { useState } from 'react';

const NOTIFICATION_TYPES = [
    {
        type: 'price_drop' as const,
        label: 'Price Drop',
        description: 'Price decreased without a target price line.',
        preview: `🟢 <b>Price Drop!</b> · <a href="https://www.google.com">View Product</a>\n\n<b>Sample Product</b>\n$129.99 → <b>$89.99</b> (-$40.00 · 31% off)`,
    },
    {
        type: 'price_drop_target' as const,
        label: 'Price Drop (Target)',
        description: 'Price decreased below the target price.',
        preview: `🟢 <b>Price Drop!</b> · <a href="https://www.google.com">View Product</a>\n\n<b>Sample Product</b>\n$129.99 → <b>$89.99</b> (-$40.00 · 31% off)\n✅ Below target price $99.00`,
    },
    {
        type: 'price_increase' as const,
        label: 'Price Increase',
        description: 'Price increased without a target price line.',
        preview: `🔴 <b>Price Increase</b> · <a href="https://www.google.com">View Product</a>\n\n<b>Sample Product</b>\n$89.99 → <b>$109.99</b> (+$20.00 · 22% up)`,
    },
    {
        type: 'price_increase_target' as const,
        label: 'Price Increase (Target)',
        description: 'Price increased above the target price.',
        preview: `🔴 <b>Price Increase</b> · <a href="https://www.google.com">View Product</a>\n\n<b>Sample Product</b>\n$89.99 → <b>$109.99</b> (+$20.00 · 22% up)\n⚠️ Above target price $100.00`,
    },
    {
        type: 'back_in_stock' as const,
        label: 'Back in Stock',
        description: 'Item returned to stock.',
        preview: `🟢 <b>Back in Stock!</b> · <a href="https://www.google.com">View Product</a>\n\n<b>Sample Product</b>`,
    },
    {
        type: 'out_of_stock' as const,
        label: 'Out of Stock',
        description: 'Item went out of stock.',
        preview: `⚪ <b>Out of Stock</b> · <a href="https://www.google.com">View Product</a>\n\n<b>Sample Product</b>`,
    },
];

type NotificationType = (typeof NOTIFICATION_TYPES)[number]['type'];

export default function TestPage() {
    const [sentTypes, setSentTypes] = useState<Set<NotificationType>>(
        new Set(),
    );
    const [sendingType, setSendingType] = useState<NotificationType | null>(
        null,
    );
    const [error, setError] = useState<string | null>(null);

    const testSendType = api.notification.testSendType.useMutation({
        onSuccess: (_data, variables) => {
            setSentTypes((prev) => new Set([...prev, variables.type]));
            setSendingType(null);
            setError(null);
        },
        onError: (err) => {
            setSendingType(null);
            setError(err.message);
        },
    });

    function handleSend(type: NotificationType) {
        setSendingType(type);
        setError(null);
        testSendType.mutate({ type });
    }

    return (
        <div className="space-y-6">
            <section className="rounded-lg border border-border/80 bg-card/96 p-6">
                <div className="text-xs tracking-[0.16em] text-primary">
                    Notification Preview
                </div>
                <h1 className="mt-4 font-[family:var(--font-display)] text-5xl leading-none tracking-[-0.05em] text-foreground sm:text-6xl">
                    Test every alert format.
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                    Send each notification type to your Telegram to verify
                    formatting. Make sure you have a chat ID configured in
                    settings first.
                </p>
            </section>

            {error ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-200">
                    {error}
                </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                {NOTIFICATION_TYPES.map((notif) => (
                    <section
                        key={notif.type}
                        className="flex flex-col rounded-lg border border-border/80 bg-card/96 p-5"
                    >
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-medium text-foreground">
                                {notif.label}
                            </span>
                            <span className="text-[11px] tracking-[0.12em] text-muted-foreground">
                                {notif.description}
                            </span>
                        </div>

                        <pre className="mt-3 flex-1 overflow-x-auto whitespace-pre-wrap rounded-md border border-border/50 bg-background/40 p-3 font-mono text-xs leading-5 text-muted-foreground">
                            {notif.preview
                                .replace(/<b>/g, '')
                                .replace(/<\/b>/g, '')
                                .replace(/<a href="[^"]*">/g, '')
                                .replace(/<\/a>/g, '')}
                        </pre>

                        <Button
                            className="mt-3"
                            variant={
                                sentTypes.has(notif.type)
                                    ? 'outline'
                                    : 'default'
                            }
                            disabled={sendingType === notif.type}
                            onClick={() => handleSend(notif.type)}
                        >
                            {sendingType === notif.type
                                ? 'Sending...'
                                : sentTypes.has(notif.type)
                                  ? 'Sent — Send Again'
                                  : 'Send'}
                        </Button>
                    </section>
                ))}
            </div>
        </div>
    );
}
