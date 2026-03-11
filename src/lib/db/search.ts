import { pool } from './pool';
import type { SearchResult } from '../types';

// ============================================
// Search (pg_trgm fuzzy)
// ============================================

export async function searchAll(query: string, limit: number = 10): Promise<SearchResult> {
    if (!query || query.trim().length < 2) {
        return { videos: [], celebrities: [], movies: [] };
    }

    const searchTerm = query.trim();

    const [videosResult, celebritiesResult, moviesResult] = await Promise.all([
        // Search videos by title across all locales
        pool.query(
            `SELECT v.*,
              GREATEST(
                similarity(COALESCE(v.title->>'en', ''), $1),
                similarity(COALESCE(v.title->>'ru', ''), $1),
                similarity(COALESCE(v.original_title, ''), $1)
              ) AS sim
       FROM videos v
       WHERE v.status = 'published'
         AND (
           similarity(COALESCE(v.title->>'en', ''), $1) > 0.2
           OR similarity(COALESCE(v.title->>'ru', ''), $1) > 0.2
           OR similarity(COALESCE(v.original_title, ''), $1) > 0.2
         )
       ORDER BY sim DESC
       LIMIT $2`,
            [searchTerm, limit]
        ),
        // Search celebrities (published only)
        pool.query(
            `SELECT c.*, similarity(c.name, $1) AS sim
       FROM celebrities c
       WHERE c.status = 'published'
         AND (similarity(c.name, $1) > 0.2 OR $1 = ANY(c.aliases))
       ORDER BY sim DESC
       LIMIT $2`,
            [searchTerm, limit]
        ),
        // Search movies (published only)
        pool.query(
            `SELECT m.*, similarity(m.title, $1) AS sim
       FROM movies m
       WHERE m.status = 'published'
         AND similarity(m.title, $1) > 0.2
       ORDER BY sim DESC
       LIMIT $2`,
            [searchTerm, limit]
        ),
    ]);

    return {
        videos: videosResult.rows,
        celebrities: celebritiesResult.rows,
        movies: moviesResult.rows,
    };
}
