import type { JobsOptions } from 'bullmq';
import { getQueue } from './client';
import { TASK_NAMES, type TaskName, type TaskPayload } from './index';

type EnqueueWatchCheckOptions = JobsOptions & {
    replaceExisting?: boolean;
};

export function getWatchCheckJobId(watchId: string) {
    return `check-watch-${watchId}`;
}

export async function enqueueTask<T extends TaskName>(
    taskName: T,
    payload: TaskPayload<T>,
    options?: JobsOptions,
) {
    return getQueue().add(taskName, payload, options);
}

export async function enqueueWatchCheck(
    payload: TaskPayload<typeof TASK_NAMES.CHECK_WATCH>,
    options?: EnqueueWatchCheckOptions,
) {
    const { replaceExisting = false, ...jobOptions } = options ?? {};
    const jobId = getWatchCheckJobId(payload.watchId);

    if (replaceExisting) {
        const existingJob = await getQueue().getJob(jobId);

        if (existingJob) {
            const existingState = await existingJob.getState();

            if (
                existingState === 'waiting' ||
                existingState === 'delayed' ||
                existingState === 'prioritized'
            ) {
                await existingJob.remove();
            } else {
                return existingJob;
            }
        }
    }

    return getQueue().add(TASK_NAMES.CHECK_WATCH, payload, {
        ...jobOptions,
        jobId,
    });
}
