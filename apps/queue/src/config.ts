import { getRedisConnection } from '@pounce/trpc/queue';
import dotenv from 'dotenv';

dotenv.config();

export const scraperUrl = process.env.SCRAPER_URL ?? 'http://localhost:8001';

export const redisConnection = getRedisConnection();

function parseWorkerConcurrency() {
    const raw = process.env.QUEUE_WORKER_CONCURRENCY;
    if (!raw) {
        return 2;
    }

    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
        return 2;
    }

    return parsed;
}

export const workerConcurrency = parseWorkerConcurrency();
