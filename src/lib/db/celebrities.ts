import { pool } from './pool';
import { cached } from '../cache';
import type { Celebrity, Tag, PaginatedResult } from '../types';

// ============================================
// Celebrities
// ============================================

export async function getCelebrityBySlug(slug: string): Promise<Celebrity | null> {
    const result = await pool.query(
        `SELECT * FROM celebrities WHERE slug = $1 AND status IN ('published', 'draft') LIMIT 1`,
        [slug]
    );
    return result.rows[0] || null;
}

/**
 * Check if celebrity page should be noindex (only if 0 videos — thin content)
 */
export function celebrityNeedsEnrichment(celeb: Celebrity): boolean {
    return (celeb.videos_count || 0) === 0;
}

export async function getCelebrities(
    page: number = 1,
    limit: number = 24,
    orderBy: string = 'videos_count',
    letterFilter?: string
): Promise<PaginatedResult<Celebrity>> {
    const allowedOrder = ['videos_count', 'total_views', 'name', 'created_at'];
    const order = allowedOrder.includes(orderBy) ? orderBy : 'videos_count';

    return cached(`celebs:${page}:${limit}:${order}:${letterFilter || ''}`, async () => {
        const offset = (page - 1) * limit;
        const dir = order === 'name' ? 'ASC' : 'DESC';
        // Put celebrities with photos first (except A-Z sort where name order takes priority)
        const photoFirst = order !== 'name' ? '(photo_url IS NULL) ASC, ' : '';
        // For popular sort, use videos_count as primary + total_views as tiebreaker
        const orderClause = order === 'videos_count'
            ? `${photoFirst}videos_count DESC, total_views DESC`
            : `${photoFirst}${order} ${dir}`;

        const dataParams = letterFilter
            ? [limit, offset, letterFilter.toUpperCase()]
            : [limit, offset];
        const dataWhere = letterFilter
            ? `WHERE status = 'published' AND UPPER(LEFT(name, 1)) = $3`
            : `WHERE status = 'published'`;
        const countWhere = letterFilter
            ? `WHERE status = 'published' AND UPPER(LEFT(name, 1)) = $1`
            : `WHERE status = 'published'`;

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT * FROM celebrities
                 ${dataWhere}
                 ORDER BY ${orderClause}
                 LIMIT $1 OFFSET $2`,
                dataParams
            ),
            pool.query(
                `SELECT COUNT(*) FROM celebrities ${countWhere}`,
                letterFilter ? [letterFilter.toUpperCase()] : []
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
    }, 120);
}

export async function getTrendingCelebrities(limit: number = 10): Promise<Celebrity[]> {
    return cached(`trending_celebs:${limit}`, async () => {
        const result = await pool.query(
            `SELECT * FROM celebrities
         WHERE status = 'published' AND videos_count > 0 AND photo_url IS NOT NULL
         ORDER BY videos_count DESC, total_views DESC NULLS LAST
         LIMIT $1`,
            [limit]
        );
        return result.rows;
    }, 300);
}

// Celebrities that appear in the same movies as the given celebrity
export async function getSimilarCelebrities(
    celebrityId: number,
    limit: number = 12
): Promise<Celebrity[]> {
    return cached(`similar_celebs:${celebrityId}:${limit}`, async () => {
        const result = await pool.query(
            `SELECT DISTINCT c.* FROM celebrities c
             JOIN movie_celebrities mc ON mc.celebrity_id = c.id
             WHERE mc.movie_id IN (
                 SELECT movie_id FROM movie_celebrities WHERE celebrity_id = $1
             )
             AND c.id != $1
             AND c.status = 'published'
             AND c.videos_count > 0
             ORDER BY c.total_views DESC
             LIMIT $2`,
            [celebrityId, limit]
        );
        return result.rows;
    }, 300);
}

// Most common tags across all videos for a celebrity
export async function getTagsForCelebrity(
    celebrityId: number,
    limit: number = 20
): Promise<Tag[]> {
    return cached(`celeb_tags:${celebrityId}:${limit}`, async () => {
        const result = await pool.query(
            `SELECT t.*, COUNT(*)::int as tag_count FROM tags t
             JOIN video_tags vt ON vt.tag_id = t.id
             JOIN video_celebrities vc ON vc.video_id = vt.video_id
             JOIN videos v ON v.id = vt.video_id
             WHERE vc.celebrity_id = $1
               AND v.status = 'published'
             GROUP BY t.id
             ORDER BY tag_count DESC
             LIMIT $2`,
            [celebrityId, limit]
        );
        return result.rows;
    }, 300);
}
