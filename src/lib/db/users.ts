import { pool } from './pool';
import type { Video, Celebrity } from '@/lib/types';

export interface DbUser {
    id: string;
    username: string;
    password_hash: string;
    created_at: Date;
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createUser(username: string, passwordHash: string): Promise<DbUser> {
    const { rows } = await pool.query(
        `INSERT INTO users (username, password_hash) VALUES ($1, $2)
         RETURNING id, username, password_hash, created_at`,
        [username, passwordHash]
    );
    return rows[0];
}

// ── Find ──────────────────────────────────────────────────────────────────────

export async function findUserByUsername(username: string): Promise<DbUser | null> {
    const { rows } = await pool.query(
        `SELECT id, username, password_hash, created_at FROM users WHERE LOWER(username) = LOWER($1)`,
        [username]
    );
    return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<DbUser | null> {
    const { rows } = await pool.query(
        `SELECT id, username, password_hash, created_at FROM users WHERE id = $1`,
        [id]
    );
    return rows[0] ?? null;
}

// ── Password ──────────────────────────────────────────────────────────────────

export async function updatePassword(userId: string, newHash: string): Promise<void> {
    await pool.query(
        `UPDATE users SET password_hash = $2 WHERE id = $1`,
        [userId, newHash]
    );
}

// ── Favorites ─────────────────────────────────────────────────────────────────

export async function addFavorite(userId: string, itemType: 'video' | 'celebrity', itemId: string): Promise<void> {
    await pool.query(
        `INSERT INTO user_favorites (user_id, item_type, item_id) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
        [userId, itemType, itemId]
    );
}

export async function removeFavorite(userId: string, itemType: 'video' | 'celebrity', itemId: string): Promise<void> {
    await pool.query(
        `DELETE FROM user_favorites WHERE user_id = $1 AND item_type = $2 AND item_id = $3`,
        [userId, itemType, itemId]
    );
}

export async function isFavorite(userId: string, itemType: 'video' | 'celebrity', itemId: string): Promise<boolean> {
    const { rows } = await pool.query(
        `SELECT 1 FROM user_favorites WHERE user_id = $1 AND item_type = $2 AND item_id = $3`,
        [userId, itemType, itemId]
    );
    return rows.length > 0;
}

export async function getFavoriteVideos(userId: string): Promise<Video[]> {
    const { rows } = await pool.query(
        `SELECT v.* FROM videos v
         JOIN user_favorites uf ON uf.item_id::uuid = v.id
         WHERE uf.user_id = $1 AND uf.item_type = 'video' AND v.status = 'published'
         ORDER BY uf.created_at DESC`,
        [userId]
    );
    return rows;
}

export async function getFavoriteCelebrities(userId: string): Promise<Celebrity[]> {
    const { rows } = await pool.query(
        `SELECT c.* FROM celebrities c
         JOIN user_favorites uf ON uf.item_id::integer = c.id
         WHERE uf.user_id = $1 AND uf.item_type = 'celebrity' AND c.status = 'published'
         ORDER BY uf.created_at DESC`,
        [userId]
    );
    return rows;
}

export async function getUserFavoriteIds(userId: string): Promise<{ videos: string[]; celebrities: string[] }> {
    const { rows } = await pool.query(
        `SELECT item_type, item_id FROM user_favorites WHERE user_id = $1`,
        [userId]
    );
    return {
        videos: rows.filter(r => r.item_type === 'video').map(r => r.item_id),
        celebrities: rows.filter(r => r.item_type === 'celebrity').map(r => r.item_id),
    };
}
