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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@pounce/ui/components/select';
import { Switch } from '@pounce/ui/components/switch';
import { BellIcon, CrosshairIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';

type ThresholdMode = 'abs' | 'pct' | 'target';

export function WatchCreatePage() {
    const router = useRouter();
    const [url, setUrl] = useState('');
    const [name, setName] = useState('');
    const [checkType, setCheckType] = useState<'price' | 'stock' | 'both'>(
        'both',
    );
    const [checkIntervalSeconds, setCheckIntervalSeconds] = useState(900);
    const [cssSelector, setCssSelector] = useState('');
    const [notifyPriceDrop, setNotifyPriceDrop] = useState(true);
    const [notifyPriceIncrease, setNotifyPriceIncrease] = useState(true);
    const [notifyStock, setNotifyStock] = useState(true);
    const [priceDropThreshold, setPriceDropThreshold] = useState('');
    const [priceDropPercentThreshold, setPriceDropPercentThreshold] = useState('');
    const [priceDropTargetPrice, setPriceDropTargetPrice] = useState('');
    const [priceIncreaseThreshold, setPriceIncreaseThreshold] = useState('');
    const [priceIncreasePercentThreshold, setPriceIncreasePercentThreshold] = useState('');
    const [priceIncreaseTargetPrice, setPriceIncreaseTargetPrice] = useState('');
    const [notifyCooldownSeconds, setNotifyCooldownSeconds] = useState<string>('none');
    const [dropMode, setDropMode] = useState<ThresholdMode>('abs');
    const [increaseMode, setIncreaseMode] = useState<ThresholdMode>('abs');

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
                            notifyPriceDrop,
                            notifyPriceIncrease,
                            notifyStock,
                            priceDropThreshold: priceDropThreshold ? Number(priceDropThreshold) : null,
                            priceDropPercentThreshold: priceDropPercentThreshold ? Number(priceDropPercentThreshold) : null,
                            priceDropTargetPrice: priceDropTargetPrice ? Number(priceDropTargetPrice) : null,
                            priceIncreaseThreshold: priceIncreaseThreshold ? Number(priceIncreaseThreshold) : null,
                            priceIncreasePercentThreshold: priceIncreasePercentThreshold ? Number(priceIncreasePercentThreshold) : null,
                            priceIncreaseTargetPrice: priceIncreaseTargetPrice ? Number(priceIncreaseTargetPrice) : null,
                            notifyCooldownSeconds: notifyCooldownSeconds !== 'none' ? Number(notifyCooldownSeconds) : null,
                        });
                    }}
                >
                    <div className="flex items-center justify-end">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="relative size-8">
                                    <BellIcon className="size-4" />
                                    {(!notifyPriceDrop || !notifyPriceIncrease || !notifyStock || priceDropThreshold || priceDropPercentThreshold || priceDropTargetPrice || priceIncreaseThreshold || priceIncreasePercentThreshold || priceIncreaseTargetPrice || (notifyCooldownSeconds !== 'none')) ? (
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
                                        <Label htmlFor="notifyPriceDrop" className="text-sm font-medium text-foreground">
                                            Notify on price drop
                                        </Label>
                                        <Switch
                                            id="notifyPriceDrop"
                                            checked={notifyPriceDrop}
                                            onCheckedChange={setNotifyPriceDrop}
                                        />
                                    </div>
                                    {notifyPriceDrop ? (
                                        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                                            <div className="flex items-center gap-2">
                                                <ModeToggle mode={dropMode} onModeChange={(m) => { setDropMode(m); if (m === 'abs') { setPriceDropPercentThreshold(''); setPriceDropTargetPrice(''); } else if (m === 'pct') { setPriceDropThreshold(''); setPriceDropTargetPrice(''); } else { setPriceDropThreshold(''); setPriceDropPercentThreshold(''); } }} />
                                                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Price Drop Alerts</span>
                                            </div>
                                            {dropMode === 'abs' ? (
                                                <ThresholdField label="Min change" hint="Skip drops smaller than this" prefix="$" placeholder="0.00" value={priceDropThreshold} onChange={setPriceDropThreshold} />
                                            ) : dropMode === 'pct' ? (
                                                <ThresholdField label="Min change" hint="Skip drops smaller than this" suffix="%" placeholder="0" value={priceDropPercentThreshold} onChange={setPriceDropPercentThreshold} />
                                            ) : (
                                                <ThresholdField label="Target price" hint="Only alert when price is at or below this" prefix="$" placeholder="0.00" value={priceDropTargetPrice} onChange={setPriceDropTargetPrice} />
                                            )}
                                        </div>
                                    ) : null}
                                    <div className="flex items-center justify-between gap-3">
                                        <Label htmlFor="notifyPriceIncrease" className="text-sm font-medium text-foreground">
                                            Notify on price increase
                                        </Label>
                                        <Switch
                                            id="notifyPriceIncrease"
                                            checked={notifyPriceIncrease}
                                            onCheckedChange={setNotifyPriceIncrease}
                                        />
                                    </div>
                                    {notifyPriceIncrease ? (
                                        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                                            <div className="flex items-center gap-2">
                                                <ModeToggle mode={increaseMode} onModeChange={(m) => { setIncreaseMode(m); if (m === 'abs') { setPriceIncreasePercentThreshold(''); setPriceIncreaseTargetPrice(''); } else if (m === 'pct') { setPriceIncreaseThreshold(''); setPriceIncreaseTargetPrice(''); } else { setPriceIncreaseThreshold(''); setPriceIncreasePercentThreshold(''); } }} />
                                                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Price Increase Alerts</span>
                                            </div>
                                            {increaseMode === 'abs' ? (
                                                <ThresholdField label="Min change" hint="Skip increases smaller than this" prefix="$" placeholder="0.00" value={priceIncreaseThreshold} onChange={setPriceIncreaseThreshold} />
                                            ) : increaseMode === 'pct' ? (
                                                <ThresholdField label="Min change" hint="Skip increases smaller than this" suffix="%" placeholder="0" value={priceIncreasePercentThreshold} onChange={setPriceIncreasePercentThreshold} />
                                            ) : (
                                                <ThresholdField label="Target price" hint="Only alert when price is at or above this" prefix="$" placeholder="0.00" value={priceIncreaseTargetPrice} onChange={setPriceIncreaseTargetPrice} />
                                            )}
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
                                    <div className="space-y-2">
                                        <div className="flex items-baseline justify-between gap-3">
                                            <span className="text-sm font-medium text-foreground">Cooldown</span>
                                            <span className="text-[11px] tracking-[0.12em] text-muted-foreground">Min time between alerts.</span>
                                        </div>
                                        <Select value={notifyCooldownSeconds} onValueChange={setNotifyCooldownSeconds}>
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder="None" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">None</SelectItem>
                                                <SelectItem value="900">15 minutes</SelectItem>
                                                <SelectItem value="1800">30 minutes</SelectItem>
                                                <SelectItem value="3600">1 hour</SelectItem>
                                                <SelectItem value="21600">6 hours</SelectItem>
                                                <SelectItem value="43200">12 hours</SelectItem>
                                                <SelectItem value="86400">24 hours</SelectItem>
                                            </SelectContent>
                                        </Select>
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
                        <Select
                            value={checkType}
                            onValueChange={(v) =>
                                setCheckType(
                                    v as 'price' | 'stock' | 'both',
                                )
                            }
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="both">Price Drops + Restocks</SelectItem>
                                <SelectItem value="price">Price Drops Only</SelectItem>
                                <SelectItem value="stock">Restocks Only</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>

                    <Field
                        label="Check frequency"
                        hint="How often Pounce checks this product."
                    >
                        <Select
                            value={String(checkIntervalSeconds)}
                            onValueChange={(v) =>
                                setCheckIntervalSeconds(Number(v))
                            }
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="5">Every 5 seconds</SelectItem>
                                <SelectItem value="10">Every 10 seconds</SelectItem>
                                <SelectItem value="30">Every 30 seconds</SelectItem>
                                <SelectItem value="60">Every 1 minute</SelectItem>
                                <SelectItem value="300">Every 5 minutes</SelectItem>
                                <SelectItem value="900">Every 15 minutes</SelectItem>
                                <SelectItem value="1800">Every 30 minutes</SelectItem>
                                <SelectItem value="3600">Every 1 hour</SelectItem>
                                <SelectItem value="21600">Every 6 hours</SelectItem>
                                <SelectItem value="43200">Every 12 hours</SelectItem>
                                <SelectItem value="86400">Every 24 hours</SelectItem>
                            </SelectContent>
                        </Select>
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

function ThresholdField({
    label,
    hint,
    prefix,
    suffix,
    placeholder,
    value,
    onChange,
}: {
    label: string;
    hint?: string;
    prefix?: string;
    suffix?: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="min-w-0 flex-1 space-y-1">
            <span className="text-[11px] tracking-[0.1em] text-muted-foreground">{label}</span>
            {hint ? <span className="block text-[10px] text-muted-foreground/70">{hint}</span> : null}
            <InputGroup className="bg-background">
                {prefix ? (
                    <InputGroupAddon>
                        <InputGroupText>{prefix}</InputGroupText>
                    </InputGroupAddon>
                ) : null}
                <InputGroupInput
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
                {suffix ? (
                    <InputGroupAddon align="inline-end">
                        <InputGroupText>{suffix}</InputGroupText>
                    </InputGroupAddon>
                ) : null}
            </InputGroup>
        </div>
    );
}

function ModeToggle({ mode, onModeChange }: { mode: ThresholdMode; onModeChange: (mode: ThresholdMode) => void }) {
    const btn = (value: ThresholdMode, children: ReactNode) => (
        <button
            type="button"
            className={`flex items-center justify-center px-2 py-1.5 text-xs font-medium transition-colors ${mode === value ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
            onClick={() => onModeChange(value)}
        >
            {children}
        </button>
    );
    return (
        <div className="flex shrink-0 overflow-hidden rounded-md border border-border/60">
            {btn('abs', '$')}
            {btn('pct', '%')}
            {btn('target', <CrosshairIcon className="size-3.5" />)}
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
