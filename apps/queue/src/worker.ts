import { QUEUE_NAME } from '@pounce/trpc/queue';
import type { TaskName } from '@pounce/trpc/queue';
import { Worker } from 'bullmq';

import { redisConnection, workerConcurrency } from './config';
import { taskHandlers } from './tasks';

export const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
        const handler = taskHandlers[job.name as TaskName];

        if (!handler) {
            throw new Error(`No handler registered for task: ${job.name}`);
        }

        console.log(`[queue] Processing job ${job.id} - task: ${job.name}`);
        return handler(job.data);
    },
    {
        connection: redisConnection,
        concurrency: workerConcurrency,
    },
);

worker.on('completed', (job) => {
    console.log(`[queue] Job ${job.id} completed - task: ${job.name}`);
});

worker.on('failed', (job, error) => {
    console.error(`[queue] Job ${job?.id} failed - task: ${job?.name}`, error);
});
