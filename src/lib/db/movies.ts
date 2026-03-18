import { pool } from './pool';
import { cached } from '../cache';
import type { Movie, Celebrity, PaginatedResult } from '../types';

// ============================================
// Movies
// ============================================

export async function getMovieBySlug(slug: string): Promise<Movie | null> {
    const result = await pool.query(
        `SELECT * FROM movies WHERE slug = $1 AND status IN ('published', 'draft') LIMIT 1`,
        [slug]
    );
    return result.rows[0] || null;
}

/**
 * Check if a movie needs enrichment (missing poster or description)
 * Used to add noindex meta tag on detail pages
 */
export function movieNeedsEnrichment(movie: Movie): boolean {
    if (!movie.poster_url) return true;
    const desc = movie.description;
    if (!desc) return true;
    const descObj = typeof desc === 'string' ? JSON.parse(desc) : desc;
    return !descObj?.en;
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
           WHERE status = 'published'
           ORDER BY ${order} ${dir}
           LIMIT $1 OFFSET $2`,
                [limit, offset]
            ),
            pool.query(`SELECT COUNT(*) FROM movies WHERE status = 'published'`),
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

export async function getNewMovies(limit: number = 12): Promise<Movie[]> {
    return cached(`new_movies:${limit}`, async () => {
        const result = await pool.query(
            `SELECT * FROM movies
             WHERE status = 'published' AND poster_url IS NOT NULL
             ORDER BY year DESC NULLS LAST, scenes_count DESC NULLS LAST
             LIMIT $1`,
            [limit]
        );
        return result.rows;
    }, 300);
}

// Movies — celebrity relations

export async function getMoviesForCelebrity(celebrityId: number): Promise<Movie[]> {
    const result = await pool.query(
        `SELECT m.* FROM movies m
         JOIN movie_celebrities mc ON mc.movie_id = m.id
         WHERE mc.celebrity_id = $1 AND m.status = 'published'
         GROUP BY m.id
         ORDER BY MAX(m.year) DESC NULLS LAST`,
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

// Movies that share celebrities with the given movie
export async function getSimilarMovies(
    movieId: number,
    limit: number = 6
): Promise<Movie[]> {
    return cached(`similar_movies:${movieId}:${limit}`, async () => {
        const result = await pool.query(
            `SELECT DISTINCT m.* FROM movies m
             JOIN movie_celebrities mc ON mc.movie_id = m.id
             WHERE mc.celebrity_id IN (
                 SELECT celebrity_id FROM movie_celebrities WHERE movie_id = $1
             )
             AND m.id != $1
             AND m.status = 'published'
             AND m.scenes_count > 0
             ORDER BY m.total_views DESC
             LIMIT $2`,
            [movieId, limit]
        );
        return result.rows;
    }, 300);
}
