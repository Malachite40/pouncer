import dotenv from 'dotenv';

dotenv.config();

export const scraperUrl = process.env.SCRAPER_URL ?? 'http://localhost:8001';

export const redisConnection = (() => {
    const parsed = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');

    return {
        host: parsed.hostname,
        port: Number(parsed.port) || 6379,
    };
})();

export const workerConcurrency = 5;
