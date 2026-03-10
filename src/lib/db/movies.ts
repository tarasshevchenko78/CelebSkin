import { pool } from './pool';
import { cached } from '../cache';
import type { Movie, Celebrity, PaginatedResult } from '../types';

// ============================================
// Movies
// ============================================

export async function getMovieBySlug(slug: string): Promise<Movie | null> {
    const result = await pool.query(
        `SELECT * FROM movies WHERE slug = $1 LIMIT 1`,
        [slug]
    );
    return result.rows[0] || null;
}

export async function getMovies(
    page: number = 1,
    limit: number = 24,
    orderBy: string = 'scenes_count'
): Promise<PaginatedResult<Movie>> {
    const allowedOrder = ['scenes_count', 'total_views', 'year', 'title', 'created_at'];
    const order = allowedOrder.includes(orderBy) ? orderBy : 'scenes_count';

    return cached(`movies:${page}:${limit}:${order}`, async () => {
        const offset = (page - 1) * limit;
        const dir = order === 'title' ? 'ASC' : 'DESC';

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT * FROM movies
           ORDER BY ${order} ${dir}
           LIMIT $1 OFFSET $2`,
                [limit, offset]
            ),
            pool.query(`SELECT COUNT(*) FROM movies`),
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

// Movies — celebrity relations

export async function getMoviesForCelebrity(celebrityId: number): Promise<Movie[]> {
    const result = await pool.query(
        `SELECT DISTINCT m.* FROM movies m
         JOIN movie_celebrities mc ON mc.movie_id = m.id
         WHERE mc.celebrity_id = $1
         ORDER BY m.year DESC NULLS LAST`,
        [celebrityId]
    );
    return result.rows;
}

export async function getCelebritiesForMovie(movieId: number): Promise<Celebrity[]> {
    const result = await pool.query(
        `SELECT c.* FROM celebrities c
         JOIN movie_celebrities mc ON mc.celebrity_id = c.id
         WHERE mc.movie_id = $1
         ORDER BY c.total_views DESC`,
        [movieId]
    );
    return result.rows;
}
