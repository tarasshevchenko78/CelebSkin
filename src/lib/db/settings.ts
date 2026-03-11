import { pool } from './pool';
import { cached, invalidateCache } from '../cache';
import { config } from '../config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SettingRow {
    key: string;
    value: string;
    description: string | null;
    is_secret: boolean;
    updated_at: Date;
}

export interface SettingInfo {
    value: string;
    is_secret: boolean;
    description: string | null;
}

// ── Map DB key → env fallback ────────────────────────────────────────────────

const ENV_FALLBACKS: Record<string, string> = {
    gemini_api_key: config.geminiApiKey,
    tmdb_api_key: config.tmdbApiKey,
};

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
    const res = await pool.query<SettingRow>(
        'SELECT value FROM settings WHERE key = $1',
        [key]
    );
    return res.rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
    await pool.query(
        `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2`,
        [value, key]
    );
    // Invalidate Redis cache for this setting
    await invalidateCache(`setting:${key}`);
}

export async function getAllSettings(): Promise<Record<string, SettingInfo>> {
    const res = await pool.query<SettingRow>(
        'SELECT key, value, is_secret, description FROM settings ORDER BY key'
    );
    const result: Record<string, SettingInfo> = {};
    for (const row of res.rows) {
        result[row.key] = {
            value: row.value,
            is_secret: row.is_secret,
            description: row.description,
        };
    }
    return result;
}

/**
 * Get setting from DB (with Redis cache), fall back to env variable.
 * This is the primary function for runtime API key access.
 */
export async function getSettingOrEnv(dbKey: string, envFallback?: string): Promise<string> {
    const fallback = envFallback ?? ENV_FALLBACKS[dbKey] ?? '';
    try {
        const value = await cached<string | null>(
            `setting:${dbKey}`,
            () => getSetting(dbKey),
            60 // 60s TTL
        );
        // Return DB value if non-empty, otherwise env fallback
        return (value && value.trim()) ? value : fallback;
    } catch {
        return fallback;
    }
}
