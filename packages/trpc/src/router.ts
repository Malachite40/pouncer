import { watchRouter } from './routers/watch';
import { notificationRouter } from './routers/notification';
import { createCallerFactory, createTRPCRouter } from './trpc';

export const appRouter = createTRPCRouter({
    watch: watchRouter,
    notification: notificationRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
