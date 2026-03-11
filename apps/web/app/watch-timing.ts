const LOCAL_TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
};

const LOCAL_TIME_FORMAT: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
};

export function getNextCheckAt(
    lastCheckedAt: Date | string | null,
    checkIntervalSeconds: number,
) {
    if (!lastCheckedAt) {
        return new Date(0);
    }

    return new Date(
        new Date(lastCheckedAt).getTime() + checkIntervalSeconds * 1000,
    );
}

export function formatNextCheckLabel(
    lastCheckedAt: Date | string | null,
    isActive: boolean,
    checkIntervalSeconds: number,
) {
    if (!isActive) {
        return 'Paused';
    }

    if (!lastCheckedAt) {
        return 'Next check ready now';
    }

    return `Next check ${formatNextRunTimestamp(
        getNextCheckAt(lastCheckedAt, checkIntervalSeconds),
        { overdueLabel: null },
    )}`;
}

export function formatNextRunTimestamp(
    nextRunAt: Date | string,
    options?: { overdueLabel?: string | null },
) {
    const date = new Date(nextRunAt);

    if (options?.overdueLabel !== null && date.getTime() <= Date.now()) {
        return options?.overdueLabel ?? 'now';
    }

    return date.toLocaleString([], LOCAL_TIMESTAMP_FORMAT);
}

export function formatNextRunTime(
    nextRunAt: Date | string,
    options?: { overdueLabel?: string | null },
) {
    const date = new Date(nextRunAt);

    if (options?.overdueLabel !== null && date.getTime() <= Date.now()) {
        return options?.overdueLabel ?? 'now';
    }

    return date
        .toLocaleTimeString([], LOCAL_TIME_FORMAT)
        .replace(/\s?(AM|PM)$/, (match) => match.toLowerCase());
}
