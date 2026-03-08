import { Queue } from 'bullmq';
import { getRedisConnection } from './redis';

export const QUEUE_NAME = 'default';

let _queue: Queue | null = null;

export function getQueue(): Queue {
    if (!_queue) {
        _queue = new Queue(QUEUE_NAME, {
            connection: getRedisConnection(),
        });
    }
    return _queue;
}
