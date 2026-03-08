import { Separator } from '@pounce/ui/components/separator';
import Link from 'next/link';

export function Footer() {
    return (
        <footer className="pb-8 pt-12">
            <Separator />
            <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
                <span>&copy; {new Date().getFullYear()} Pounce</span>
                <Link
                    href="/login"
                    className="transition-colors hover:text-foreground"
                >
                    Sign in
                </Link>
            </div>
        </footer>
    );
}
