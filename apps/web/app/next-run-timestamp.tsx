'use client';

import { formatNextRunTime } from './watch-timing';

export function NextRunTimestamp({ nextRunAt }: { nextRunAt: Date | string }) {
    return formatNextRunTime(nextRunAt);
}
