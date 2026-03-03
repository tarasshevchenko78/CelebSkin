import { createClient, type RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

function buildClient(): RedisClientType {
    const client = createClient({
        url: `redis://:${process.env.REDIS_PASSWORD || ''}@${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || '6379'}`,
    });
    client.on('error', (err) => {
        console.error('[Redis] Error:', err.message);
    });
    return client as RedisClientType;
}

async function getClient(): Promise<RedisClientType> {
    if (!redisClient || !redisClient.isReady) {
        if (redisClient) {
            try { await redisClient.disconnect(); } catch { /* ignore */ }
        }
        redisClient = buildClient();
        await redisClient.connect();
    }
    return redisClient;
}

/**
 * Cache wrapper: returns cached data if available, otherwise calls fn() and caches result.
 * @param key - Redis key
 * @param fn - Async function to call if cache miss
 * @param ttl - Time to live in seconds (default 300 = 5 min)
 */
export async function cached<T>(key: string, fn: () => Promise<T>, ttl: number = 300): Promise<T> {
    try {
        const client = await getClient();
        const data = await client.get(key);
        if (data) {
            return JSON.parse(data) as T;
        }
    } catch {
        // Redis down — fall through to DB query
    }

    const result = await fn();

    try {
        const client = await getClient();
        await client.setEx(key, ttl, JSON.stringify(result));
    } catch {
        // Redis down — silently continue
    }

    return result;
}

/**
 * Invalidate cache by key pattern.
 */
export async function invalidateCache(pattern: string): Promise<void> {
    try {
        const client = await getClient();
        const keys = await client.keys(pattern);
        if (keys.length > 0) {
            await client.del(keys);
        }
    } catch {
        // Redis down — silently continue
    }
}
