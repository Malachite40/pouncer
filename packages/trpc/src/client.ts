import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from './router';

export type { AppRouter } from './router';
export { createQueryClient } from './query-client';

export const trpc = createTRPCReact<AppRouter>();
