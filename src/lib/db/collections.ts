import { pool } from './pool';
import { cached } from '../cache';
import type { Collection, Video, PaginatedResult } from '../types';

// ============================================
// Collections
// ============================================

export async function getCollections(
    page: number = 1,
    limit: number = 24
): Promise<PaginatedResult<Collection>> {
    return cached(`collections:${page}:${limit}`, async () => {
        const offset = (page - 1) * limit;

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT * FROM collections
                 ORDER BY sort_order ASC, created_at DESC
                 LIMIT $1 OFFSET $2`,
                [limit, offset]
            ),
            pool.query(`SELECT COUNT(*) FROM collections`),
        ]);

        const total = parseInt(countResult.rows[0].count);
        return {
            data: dataResult.rows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }, 120);
}

export async function getFeaturedCollections(limit: number = 6): Promise<Collection[]> {
    return cached(`collections:featured:${limit}`, async () => {
        const result = await pool.query(
            `SELECT * FROM collections
             WHERE featured = true AND videos_count > 0
             ORDER BY sort_order ASC, created_at DESC
             LIMIT $1`,
            [limit]
        );
        return result.rows;
    }, 120);
}

export async function getCollectionBySlug(slug: string): Promise<Collection | null> {
    const result = await pool.query(
        `SELECT * FROM collections WHERE slug = $1 LIMIT 1`,
        [slug]
    );
    return result.rows[0] || null;
}

export async function getCollectionsForVideo(videoId: string): Promise<Collection[]> {
    const result = await pool.query(
        `SELECT c.* FROM collections c
         JOIN collection_videos cv ON cv.collection_id = c.id
         WHERE cv.video_id = $1
         ORDER BY c.sort_order ASC`,
        [videoId]
    );
    return result.rows;
}

export async function getVideosForCollection(
    collectionId: number,
    page: number = 1,
    limit: number = 24
): Promise<PaginatedResult<Video>> {
    return cached(`collection_videos:${collectionId}:${page}:${limit}`, async () => {
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
    }, 60);
}
