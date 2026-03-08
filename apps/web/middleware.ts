import { type NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

const publicPaths = ['/login', '/api', '/_next', '/favicon.ico', '/select-button.png', '/connect-to-telegram.png', '/logo-white.png', '/logo-black.png'];

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (pathname === '/' || publicPaths.some((p) => pathname.startsWith(p))) {
        return NextResponse.next();
    }

    const sessionCookie = getSessionCookie(request);
    if (!sessionCookie) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
