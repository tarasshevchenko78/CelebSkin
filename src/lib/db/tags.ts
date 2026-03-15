import { pool } from './pool';
import type { Tag } from '../types';

// ============================================
// Tags
// ============================================

export async function getTagBySlug(slug: string): Promise<Tag | null> {
    const result = await pool.query(
        `SELECT * FROM tags WHERE slug = $1 LIMIT 1`,
        [slug]
    );
    return result.rows[0] || null;
}

export async function getAllTags(limit: number = 50): Promise<Tag[]> {
    const result = await pool.query(
        `SELECT * FROM tags
         WHERE is_canonical = true AND videos_count > 0
         ORDER BY videos_count DESC
         LIMIT $1`,
        [limit]
    );
    return result.rows;
}
