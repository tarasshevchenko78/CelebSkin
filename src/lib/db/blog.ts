import { pool } from './pool';
import type { BlogPost, PaginatedResult } from '../types';

// ============================================
// Blog
// ============================================

export async function getBlogPosts(
    page: number = 1,
    limit: number = 12
): Promise<PaginatedResult<BlogPost>> {
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
        pool.query(
            `SELECT * FROM blog_posts
             WHERE is_published = true
             ORDER BY published_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        ),
        pool.query(`SELECT COUNT(*) FROM blog_posts WHERE is_published = true`),
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

export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
    const result = await pool.query(
        `SELECT * FROM blog_posts WHERE slug = $1 AND is_published = true LIMIT 1`,
        [slug]
    );
    return result.rows[0] || null;
}
