import { auth } from '@/auth';
import { appRouter, createNextTRPCContext } from '@pounce/trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { type NextRequest, NextResponse } from 'next/server';

function getCorsHeaders(req: NextRequest): Record<string, string> {
    const origin = req.headers.get('origin') ?? '';
    if (origin.startsWith('chrome-extension://')) {
        return {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Cookie',
            'Access-Control-Allow-Credentials': 'true',
        };
    }
    return {};
}

const handler = (req: NextRequest) => {
    const corsHeaders = getCorsHeaders(req);

    return fetchRequestHandler({
        endpoint: '/api/trpc',
        req,
        router: appRouter,
        createContext: async () => {
            const betterAuthSession = await auth.api.getSession({
                headers: req.headers,
            });
            const session = betterAuthSession
                ? {
                      userId: betterAuthSession.user.id,
                      user: {
                          id: betterAuthSession.user.id,
                          name: betterAuthSession.user.name,
                          email: betterAuthSession.user.email,
                          image: betterAuthSession.user.image,
                      },
                  }
                : null;
            return createNextTRPCContext({
                headers: req.headers,
                session,
            });
        },
        responseMeta: () => ({
            headers: corsHeaders,
        }),
        onError:
            process.env.NODE_ENV === 'development'
                ? ({ path, error }) => {
                      console.error(
                          `tRPC failed on ${path ?? '<no-path>'}: ${error.message}`,
                      );
                  }
                : undefined,
    });
};

export function OPTIONS(req: NextRequest) {
    const corsHeaders = getCorsHeaders(req);
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export { handler as GET, handler as POST };
