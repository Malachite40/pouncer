import 'server-only';

import { auth } from '@/auth';
import { createCaller, createNextTRPCContext } from '@pounce/trpc/server';
import type { AppRouter } from '@pounce/trpc/server';
import { createHydrationHelpers } from '@trpc/react-query/rsc';
import { headers } from 'next/headers';
import { cache } from 'react';
import { createQueryClient } from './query-client';

const createContext = cache(async () => {
    const heads = new Headers(await headers());
    heads.set('x-trpc-source', 'rsc');
    const betterAuthSession = await auth.api.getSession({
        headers: heads,
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
    return createNextTRPCContext({ headers: heads, session });
});

const getQueryClient = cache(createQueryClient);
const caller = createCaller(createContext);

export const { trpc: api, HydrateClient } = createHydrationHelpers<AppRouter>(
    caller,
    getQueryClient,
);
