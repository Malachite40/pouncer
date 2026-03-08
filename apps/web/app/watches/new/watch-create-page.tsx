'use client';

import { api } from '@/trpc/react';
import { Button } from '@pounce/ui/components/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@pounce/ui/components/dialog';
import { Input } from '@pounce/ui/components/input';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
    InputGroupText,
} from '@pounce/ui/components/input-group';
import { Label } from '@pounce/ui/components/label';
import { NativeSelect, NativeSelectOption } from '@pounce/ui/components/native-select';
import { Switch } from '@pounce/ui/components/switch';
import { BellIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';

export function WatchCreatePage() {
    const router = useRouter();
    const [url, setUrl] = useState('');
    const [name, setName] = useState('');
    const [checkType, setCheckType] = useState<'price' | 'stock' | 'both'>(
        'both',
    );
    const [checkIntervalSeconds, setCheckIntervalSeconds] = useState(900);
    const [cssSelector, setCssSelector] = useState('');
    const [notifyPrice, setNotifyPrice] = useState(true);
    const [notifyStock, setNotifyStock] = useState(true);
    const [priceThreshold, setPriceThreshold] = useState('');

    const createWatch = api.watch.create.useMutation({
        onSuccess: (watch) => {
            router.push(`/watches/${watch.id}`);
        },
    });

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(24rem,0.8fr)]">
            <section className="rounded-lg border border-border/80 bg-card/96 p-6">
                <div className="text-xs tracking-[0.16em] text-primary">
                    New Watch
                </div>
                <h1 className="mt-4 font-[family:var(--font-display)] text-5xl leading-none tracking-[-0.05em] text-foreground sm:text-6xl">
                    Point Pounce at the target.
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                    Enter the product page, choose whether you want cheaper
                    prices, a restock alert, or both, and add a selector only
                    when the page needs a precise hook.
                </p>

                <div className="mt-8 grid gap-4 sm:grid-cols-3">
                    <Brief
                        label="Fast scan"
                        value="Price and restock signals stay easy to scan."
                    />
                    <Brief
                        label="Operational form"
                        value="Only fields needed to start the watch."
                    />
                    <Brief
                        label="Telegram ready"
                        value="Alerts route through your existing settings."
                    />
                </div>
            </section>

            <section className="rounded-lg border border-border/80 bg-card/96 p-6">
                <form
                    className="space-y-5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        createWatch.mutate({
                            url,
                            name,
                            checkType,
                            cssSelector: cssSelector || null,
                            checkIntervalSeconds,
                            notifyPrice,
                            notifyStock,
                            priceThreshold: priceThreshold
                                ? Number(priceThreshold)
                                : null,
                        });
                    }}
                >
                    <div className="flex items-center justify-end">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="relative size-8">
                                    <BellIcon className="size-4" />
                                    {(!notifyPrice || !notifyStock || priceThreshold) ? (
                                        <span className="absolute top-1 right-1 size-2 rounded-full bg-primary" />
                                    ) : null}
                                    <span className="sr-only">Notification preferences</span>
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Notification Preferences</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <Label htmlFor="notifyPrice" className="text-sm font-medium text-foreground">
                                            Notify on price change
                                        </Label>
                                        <Switch
                                            id="notifyPrice"
                                            checked={notifyPrice}
                                            onCheckedChange={setNotifyPrice}
                                        />
                                    </div>
                                    {notifyPrice ? (
                                        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                                            <div className="flex items-baseline justify-between gap-3">
                                                <span className="text-sm font-medium text-foreground">
                                                    Price drop threshold
                                                </span>
                                                <span className="text-[11px] tracking-[0.12em] text-muted-foreground">
                                                    Only notify if price drops by at least this amount.
                                                </span>
                                            </div>
                                            <InputGroup className="bg-background">
                                                <InputGroupAddon>
                                                    <InputGroupText>$</InputGroupText>
                                                </InputGroupAddon>
                                                <InputGroupInput
                                                    id="priceThreshold"
                                                    type="number"
                                                    min="0.01"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={priceThreshold}
                                                    onChange={(e) =>
                                                        setPriceThreshold(e.target.value)
                                                    }
                                                />
                                                <InputGroupAddon align="inline-end">
                                                    <InputGroupText>USD</InputGroupText>
                                                </InputGroupAddon>
                                            </InputGroup>
                                        </div>
                                    ) : null}
                                    <div className="flex items-center justify-between gap-3">
                                        <Label htmlFor="notifyStock" className="text-sm font-medium text-foreground">
                                            Notify on availability change
                                        </Label>
                                        <Switch
                                            id="notifyStock"
                                            checked={notifyStock}
                                            onCheckedChange={setNotifyStock}
                                        />
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <Field label="Product URL" hint="Full product page link.">
                        <Input
                            id="url"
                            type="url"
                            required
                            placeholder="https://store.example.com/product"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                        />
                    </Field>

                    <Field
                        label="Watch name"
                        hint="Short, readable label for the board."
                    >
                        <Input
                            id="name"
                            type="text"
                            required
                            placeholder='MacBook Pro 14"'
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </Field>

                    <Field
                        label="Monitor"
                        hint="Choose cheaper prices, restocks, or both."
                    >
                        <NativeSelect
                            id="checkType"
                            value={checkType}
                            onChange={(e) =>
                                setCheckType(
                                    e.target.value as
                                        | 'price'
                                        | 'stock'
                                        | 'both',
                                )
                            }
                            className="w-full"
                        >
                            <NativeSelectOption value="both">Price Drops + Restocks</NativeSelectOption>
                            <NativeSelectOption value="price">Price Drops Only</NativeSelectOption>
                            <NativeSelectOption value="stock">Restocks Only</NativeSelectOption>
                        </NativeSelect>
                    </Field>

                    <Field
                        label="Check frequency"
                        hint="How often Pounce checks this product."
                    >
                        <NativeSelect
                            id="checkIntervalSeconds"
                            value={checkIntervalSeconds}
                            onChange={(e) =>
                                setCheckIntervalSeconds(
                                    Number(e.target.value),
                                )
                            }
                            className="w-full"
                        >
                            <NativeSelectOption value={5}>Every 5 seconds</NativeSelectOption>
                            <NativeSelectOption value={10}>Every 10 seconds</NativeSelectOption>
                            <NativeSelectOption value={30}>Every 30 seconds</NativeSelectOption>
                            <NativeSelectOption value={60}>Every 1 minute</NativeSelectOption>
                            <NativeSelectOption value={300}>Every 5 minutes</NativeSelectOption>
                            <NativeSelectOption value={900}>Every 15 minutes</NativeSelectOption>
                            <NativeSelectOption value={1800}>Every 30 minutes</NativeSelectOption>
                            <NativeSelectOption value={3600}>Every 1 hour</NativeSelectOption>
                            <NativeSelectOption value={21600}>Every 6 hours</NativeSelectOption>
                            <NativeSelectOption value={43200}>Every 12 hours</NativeSelectOption>
                            <NativeSelectOption value={86400}>Every 24 hours</NativeSelectOption>
                        </NativeSelect>
                    </Field>

                    <Field
                        label="CSS selector"
                        hint="Optional override for hard-to-scrape pages."
                    >
                        <Input
                            id="cssSelector"
                            type="text"
                            placeholder=".product-price"
                            value={cssSelector}
                            onChange={(e) => setCssSelector(e.target.value)}
                        />
                    </Field>

                    {createWatch.error ? (
                        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-200">
                            {createWatch.error.message}
                        </p>
                    ) : null}

                    <Button
                        type="submit"
                        className="w-full"
                        disabled={createWatch.isPending}
                    >
                        {createWatch.isPending
                            ? 'Adding Watch...'
                            : 'Start Watch'}
                    </Button>
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

function Brief({ label, value }: { label: string; value: string }) {
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
