import { pool } from './pool';
import { cached } from '../cache';
import type { Celebrity, PaginatedResult } from '../types';

// ============================================
// Celebrities
// ============================================

export async function getCelebrityBySlug(slug: string): Promise<Celebrity | null> {
    const result = await pool.query(
        `SELECT * FROM celebrities WHERE slug = $1 LIMIT 1`,
        [slug]
    );
    return result.rows[0] || null;
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

        const dataParams = letterFilter
            ? [limit, offset, letterFilter.toUpperCase()]
            : [limit, offset];
        const dataWhere = letterFilter
            ? `WHERE UPPER(LEFT(name, 1)) = $3`
            : '';
        const countWhere = letterFilter
            ? `WHERE UPPER(LEFT(name, 1)) = $1`
            : '';

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT * FROM celebrities
                 ${dataWhere}
                 ORDER BY ${order} ${dir}
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
         WHERE is_featured = true OR videos_count > 0
         ORDER BY total_views DESC, videos_count DESC
         LIMIT $1`,
            [limit]
        );
        return result.rows;
    }, 300);
}
