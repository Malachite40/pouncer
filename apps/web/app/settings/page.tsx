'use client';

import { api } from '@/trpc/react';
import { Button } from '@pounce/ui/components/button';
import { Input } from '@pounce/ui/components/input';
import { type ReactNode, useEffect, useState } from 'react';

export default function SettingsPage() {
    const { data: settings, refetch } = api.notification.getSettings.useQuery();
    const [chatId, setChatId] = useState('');

    useEffect(() => {
        if (settings) {
            setChatId(settings.telegramChatId);
        }
    }, [settings]);

    const updateSettings = api.notification.updateSettings.useMutation({
        onSuccess: () => refetch(),
    });
    const testSend = api.notification.testSend.useMutation();

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(24rem,0.8fr)]">
            <section className="rounded-lg border border-border/80 bg-card/96 p-6">
                <div className="text-xs tracking-[0.16em] text-primary">
                    Alert Channel
                </div>
                <h1 className="mt-4 font-[family:var(--font-display)] text-5xl leading-none tracking-[-0.05em] text-foreground sm:text-6xl">
                    Wire Telegram into the watch loop.
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                    Save the destination chat ID once. Pounce will use that
                    route whenever a price breaks lower or an item comes back
                    in stock.
                </p>

                <div className="mt-8 grid gap-4">
                    <InfoRow
                        label="Chat ID"
                        value="Open a chat with the bot, then confirm the ID with @userinfobot."
                    />
                    <InfoRow
                        label="Test send"
                        value="Verify delivery before relying on live alerts."
                    />
                </div>
            </section>

            <section className="rounded-lg border border-border/80 bg-card/96 p-6">
                <form
                    className="space-y-5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        updateSettings.mutate({
                            telegramChatId: chatId,
                        });
                    }}
                >
                    <Field
                        label="Telegram chat ID"
                        hint="Private chat or group destination."
                    >
                        <Input
                            id="chatId"
                            type="text"
                            required
                            placeholder="1991969961"
                            value={chatId}
                            onChange={(e) => setChatId(e.target.value)}
                            className="font-mono"
                        />
                    </Field>

                    {updateSettings.error ? (
                        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-200">
                            {updateSettings.error.message}
                        </p>
                    ) : null}

                    {updateSettings.isSuccess ? (
                        <p className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                            Settings saved.
                        </p>
                    ) : null}

                    <div className="flex flex-col gap-3 sm:flex-row">
                        <Button
                            type="submit"
                            className="sm:flex-1"
                            disabled={updateSettings.isPending}
                        >
                            {updateSettings.isPending
                                ? 'Saving...'
                                : 'Save Channel'}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="sm:flex-1"
                            disabled={testSend.isPending || !settings}
                            onClick={() => testSend.mutate()}
                        >
                            {testSend.isPending
                                ? 'Sending Test...'
                                : testSend.isSuccess
                                  ? 'Test Sent'
                                  : 'Send Test'}
                        </Button>
                    </div>

                    {testSend.error ? (
                        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-200">
                            {testSend.error.message}
                        </p>
                    ) : null}
                </form>
            </section>
        </div>
    );
}

function Field({
    label,
    hint,
    children,
}: {
    label: string;
    hint: string;
    children: ReactNode;
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-foreground">
                    {label}
                </span>
                <span className="text-[11px] tracking-[0.12em] text-muted-foreground">
                    {hint}
                </span>
            </div>
            {children}
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-sm border border-border/70 bg-background/26 p-4">
            <div className="text-[11px] tracking-[0.14em] text-primary">
                {label}
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {value}
            </p>
        </div>
    );
}
