'use client';

import { signOut, useSession } from '@/lib/auth-client';
import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from '@pounce/ui/components/avatar';
import { Button } from '@pounce/ui/components/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@pounce/ui/components/dropdown-menu';
import { LogOutIcon } from 'lucide-react';
import Link from 'next/link';

export function UserButton() {
    const { data: session, isPending } = useSession();

    if (isPending) {
        return (
            <div className="h-8 w-8 animate-pulse rounded-full border border-border/70 bg-card/70 sm:h-9 sm:w-9" />
        );
    }

    if (!session) {
        return (
            <Button asChild variant="outline" size="sm">
                <Link href="/login">Sign in</Link>
            </Button>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-full border border-border/70 hover:border-primary/55 hover:bg-transparent focus-visible:ring-ring/40 sm:size-9"
                    aria-label="Open user menu"
                >
                    <Avatar size="lg" className="size-8 sm:size-9">
                        <AvatarImage
                            src={session.user.image ?? undefined}
                            alt={session.user.name}
                        />
                        <AvatarFallback className="bg-muted text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            {session.user.name.slice(0, 1)}
                        </AvatarFallback>
                    </Avatar>
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                        {session.user.name}
                    </div>
                    {session.user.email ? (
                        <div className="truncate text-[11px] font-medium text-muted-foreground">
                            {session.user.email}
                        </div>
                    ) : null}
                </DropdownMenuLabel>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                    variant="destructive"
                    onSelect={() =>
                        signOut({
                            fetchOptions: {
                                onSuccess: () =>
                                    window.location.assign('/login'),
                            },
                        })
                    }
                >
                    <LogOutIcon />
                    Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
