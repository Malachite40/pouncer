import { Queue } from 'bullmq';

export const QUEUE_NAME = 'default';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const parsed = new URL(redisUrl);

export const queue = new Queue(QUEUE_NAME, {
    connection: {
        host: parsed.hostname,
        port: Number(parsed.port) || 6379,
    },
});
