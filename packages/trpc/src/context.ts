import { getDb } from '@pounce/db';

export interface Session {
    userId: string;
    user: {
        id: string;
        name: string;
        email: string;
        image: string | null | undefined;
    };
}

export interface BaseContext {
    db: ReturnType<typeof getDb>;
    session: Session | null;
}

export async function createNextTRPCContext(opts: {
    headers: Headers;
    session: Session | null;
}): Promise<BaseContext> {
    return { db: getDb(), session: opts.session };
}

export function createQueueContext(): BaseContext {
    return { db: getDb(), session: null };
}

export function createContext(): BaseContext {
    return { db: getDb(), session: null };
}
