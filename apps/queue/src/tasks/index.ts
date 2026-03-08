import { TASK_NAMES } from '@pounce/trpc/queue';

import type { TaskHandlers } from '../types';
import { handleCheckWatch } from './check-watch';

export const taskHandlers: TaskHandlers = {
    [TASK_NAMES.CHECK_WATCH]: handleCheckWatch,
};
