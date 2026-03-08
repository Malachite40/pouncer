import { Queue } from 'bullmq';
import { getRedisConnection } from './redis';

export const QUEUE_NAME = 'default';

export const queue = new Queue(QUEUE_NAME, {
    connection: getRedisConnection(),
});
