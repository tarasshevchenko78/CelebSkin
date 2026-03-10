import { createClient } from 'redis';
import { config } from './config';
import { logger } from './logger';

const redisUrl = config.redis.password
    ? `redis://:${config.redis.password}@${config.redis.host}:${config.redis.port}`
    : `redis://${config.redis.host}:${config.redis.port}`;

const redisClient = createClient({ url: redisUrl });

let isConnected = false;

async function getClient() {
    if (!isConnected) {
        await redisClient.connect();
        isConnected = true;
    }
    return redisClient;
}

redisClient.on('error', (err) => {
    logger.warn('Redis connection error', { error: err.message });
    isConnected = false;
});

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

// ============================================
// Invalidation helpers (SCAN-based, non-blocking)
// ============================================

/**
 * Delete all Redis keys matching a glob pattern using SCAN (non-blocking).
 */
async function deleteByPattern(pattern: string): Promise<number> {
    try {
        const client = await getClient();
        let deleted = 0;
        let cursor: string = '0';
        do {
            const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
            cursor = result.cursor;
            if (result.keys.length > 0) {
                await client.del(result.keys);
                deleted += result.keys.length;
            }
        } while (cursor !== '0');
        return deleted;
    } catch {
        return 0;
    }
}

/**
 * Invalidate cache after a video is published.
 * Clears all list caches and stats.
 */
export async function invalidateAfterPublish(): Promise<void> {
    try {
        await Promise.all([
            deleteByPattern('latest:*'),
            deleteByPattern('latest_videos:*'),
            deleteByPattern('videos:*'),
            deleteByPattern('trending:*'),
            deleteByPattern('trending_celebs:*'),
            deleteByPattern('movies:*'),
            deleteByPattern('celebs:*'),
            deleteByPattern('dashboard_stats'),
        ]);
    } catch {
        // Redis down — silently continue
    }
}

/**
 * Invalidate cache after a video/celebrity/movie is edited.
 * If slug provided, clears that specific video cache.
 */
export async function invalidateAfterEdit(slug?: string): Promise<void> {
    try {
        const tasks: Promise<number>[] = [
            deleteByPattern('dashboard_stats'),
        ];
        if (slug) {
            tasks.push(deleteByPattern(`video:${slug}:*`));
        }
        await Promise.all(tasks);
    } catch {
        // Redis down — silently continue
    }
}

/**
 * Invalidate cache after a video is deleted.
 * Full cache flush for all lists.
 */
export async function invalidateAfterDelete(): Promise<void> {
    return invalidateAfterPublish();
}

/**
 * Legacy invalidation by pattern (kept for backwards compatibility).
 */
export async function invalidateCache(pattern: string): Promise<void> {
    try {
        await deleteByPattern(pattern);
    } catch {
        // Redis down — silently continue
    }
}
