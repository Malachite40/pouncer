export { TASK_NAMES } from './queue/index';
export type { TaskName, TaskPayload, TaskMap } from './queue/index';

export { getQueue, QUEUE_NAME } from './queue/client';
export { getRedisConnection } from './queue/redis';
export {
    enqueueTask,
    enqueueWatchCheck,
    getWatchCheckJobId,
} from './queue/enqueue';
export {
    WATCH_CHECK_ERROR_TYPES,
    claimDueWatchesForScheduling,
    claimWatchCheck,
    completeWatchCheck,
    failWatchCheckTerminal,
    failWatchCheckWithBackoff,
    markWatchCheckStarted,
    recoverExpiredWatchClaims,
    releaseClaimsForWatches,
    releaseWatchCheckClaim,
    touchWatchCheckLease,
} from './queue/watch-checks';
export type { ClaimedWatch, WatchCheckErrorType } from './queue/watch-checks';
