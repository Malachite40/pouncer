export const TASK_NAMES = {
    CHECK_WATCH: 'CHECK_WATCH',
} as const;

export type TaskName = (typeof TASK_NAMES)[keyof typeof TASK_NAMES];

export interface TaskMap {
    [TASK_NAMES.CHECK_WATCH]: {
        watchId: string;
        userId: string;
        manual?: boolean;
    };
}

export type TaskPayload<T extends TaskName> = TaskMap[T];
