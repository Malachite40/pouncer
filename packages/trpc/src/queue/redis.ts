function getRedisUrl() {
    const fallbackUrl =
        process.env.NODE_ENV === 'production'
            ? undefined
            : 'redis://localhost:6379';

    const redisUrl = process.env.REDIS_URL ?? fallbackUrl;

    if (!redisUrl) {
        throw new Error('REDIS_URL is not set');
    }

    return redisUrl;
}

export function getRedisConnection() {
    const parsed = new URL(getRedisUrl());
    const dbSegment = parsed.pathname.replace(/^\/+/, '');
    const db = dbSegment ? Number(dbSegment) : undefined;

    if (dbSegment && Number.isNaN(db)) {
        throw new Error(
            `Invalid Redis database index in REDIS_URL: ${parsed.pathname}`,
        );
    }

    return {
        host: parsed.hostname,
        port: Number(parsed.port) || 6379,
        ...(parsed.password && {
            password: decodeURIComponent(parsed.password),
        }),
        ...(parsed.username && {
            username: decodeURIComponent(parsed.username),
        }),
        ...(db !== undefined && { db }),
        ...(parsed.protocol === 'rediss:' && { tls: {} }),
    };
}
