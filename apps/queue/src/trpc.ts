import { createCaller, createQueueContext } from '@pounce/trpc/server';

export const caller = createCaller(createQueueContext());
