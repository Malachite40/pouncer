import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { BaseContext } from './context';

const t = initTRPC.context<BaseContext>().create({
    transformer: superjson,
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

export const authenticatedProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.session) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({
        ctx: {
            ...ctx,
            session: ctx.session,
            userId: ctx.session.userId,
        },
    });
});
