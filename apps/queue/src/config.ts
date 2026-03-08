import { getRedisConnection } from '@pounce/trpc/queue';
import dotenv from 'dotenv';

dotenv.config();

export const scraperUrl = process.env.SCRAPER_URL ?? 'http://localhost:8001';

export const redisConnection = getRedisConnection();

export const workerConcurrency = 5;
