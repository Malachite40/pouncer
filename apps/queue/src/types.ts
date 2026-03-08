import type { TaskName, TaskPayload } from '@pounce/trpc/queue';

export type TaskHandler<T extends TaskName = TaskName> = (
    payload: TaskPayload<T>,
) => Promise<unknown>;

export type TaskHandlers = {
    [K in TaskName]: TaskHandler<K>;
};

export interface ScraperCheckResult {
    price: number | null;
    stock_status: string | null;
    raw_content: string | null;
    error: string | null;
}
