import { pool } from './pool';
import type { Collection, Video, PaginatedResult } from '../types';

// ============================================
// Collections
// ============================================

export async function getCollections(limit: number = 20): Promise<Collection[]> {
    const result = await pool.query(
        `SELECT * FROM collections ORDER BY sort_order ASC, created_at DESC LIMIT $1`,
        [limit]
    );
    return result.rows;
}

export async function getCollectionBySlug(slug: string): Promise<Collection | null> {
    const result = await pool.query(
        `SELECT * FROM collections WHERE slug = $1 LIMIT 1`,
        [slug]
    );
    return result.rows[0] || null;
}

export async function getVideosForCollection(
    collectionId: number,
    page: number = 1,
    limit: number = 24
): Promise<PaginatedResult<Video>> {
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
        pool.query(
            `SELECT v.* FROM videos v
             JOIN collection_videos cv ON cv.video_id = v.id
             WHERE cv.collection_id = $1 AND v.status = 'published'
             ORDER BY cv.sort_order ASC, v.published_at DESC
             LIMIT $2 OFFSET $3`,
            [collectionId, limit, offset]
        ),
        pool.query(
            `SELECT COUNT(*) FROM videos v
             JOIN collection_videos cv ON cv.video_id = v.id
             WHERE cv.collection_id = $1 AND v.status = 'published'`,
            [collectionId]
        ),
    ]);

    const total = parseInt(countResult.rows[0].count);
    return {
        data: dataResult.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
    };
}
