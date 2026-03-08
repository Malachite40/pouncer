import { type NextRequest, NextResponse } from 'next/server';

const publicPaths = ['/login', '/api', '/_next', '/favicon.ico'];

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (publicPaths.some((p) => pathname.startsWith(p))) {
        return NextResponse.next();
    }

    if (!request.cookies.get('better-auth.session_token')) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
