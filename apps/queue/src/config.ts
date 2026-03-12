import { getRedisConnection } from '@pounce/trpc/queue';
import dotenv from 'dotenv';

dotenv.config();

export const scraperUrl = process.env.SCRAPER_URL ?? 'http://localhost:8001';

function parsePositiveInt(value: string | undefined, fallback: number) {
    if (!value) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
        return fallback;
    }

    return parsed;
}

function parseScraperRequestTimeoutMs(value: string | undefined) {
    return parsePositiveInt(value, 60_000);
}

export const redisConnection = getRedisConnection();

function parseWorkerConcurrency() {
    const raw = process.env.QUEUE_WORKER_CONCURRENCY;
    if (!raw) {
        return 1;
    }

    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
        return 1;
    }

    return parsed;
}

export const workerConcurrency = parseWorkerConcurrency();

export const scraperConcurrencyLimit = parsePositiveInt(
    process.env.SCRAPER_CONCURRENCY_LIMIT,
    1,
);

// Keep this at least 5000ms above scraper-rs SCRAPE_JOB_TIMEOUT_MS so the
// queue gets a structured 504 instead of aborting the request first.
export const scraperRequestTimeoutMs = parseScraperRequestTimeoutMs(
    process.env.SCRAPER_REQUEST_TIMEOUT_MS,
);

export const watchLeaseMs = parsePositiveInt(
    process.env.WATCH_CHECK_LEASE_MS,
    120_000,
);

export const watchRetryBackoffMs = parsePositiveInt(
    process.env.WATCH_CHECK_RETRY_BACKOFF_MS,
    60_000,
);

export const watchOverloadBackoffMs = parsePositiveInt(
    process.env.WATCH_CHECK_OVERLOAD_BACKOFF_MS,
    300_000,
);

export const __testables = {
    parsePositiveInt,
    parseScraperRequestTimeoutMs,
};
