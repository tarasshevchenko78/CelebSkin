import { pool } from './pool';
import type { SearchResult } from '../types';
export async function searchAll(query: string, limit: number = 10): Promise<SearchResult> {
    if (!query || query.trim().length < 2) {
        return { videos: [], celebrities: [], movies: [] };
    }
    const searchTerm = query.trim();
    const [videosResult, celebritiesResult, moviesResult] = await Promise.all([
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
        pool.query(
            `SELECT c.*,
              GREATEST(
                similarity(c.name, $1),
                similarity(COALESCE(c.name_localized->>'ru', ''), $1),
                similarity(COALESCE(c.name_localized->>'de', ''), $1),
                similarity(COALESCE(c.name_localized->>'fr', ''), $1),
                similarity(COALESCE(c.name_localized->>'es', ''), $1),
                similarity(COALESCE(c.name_localized->>'pt', ''), $1),
                similarity(COALESCE(c.name_localized->>'it', ''), $1),
                similarity(COALESCE(c.name_localized->>'pl', ''), $1),
                similarity(COALESCE(c.name_localized->>'nl', ''), $1),
                similarity(COALESCE(c.name_localized->>'tr', ''), $1)
              ) AS sim
       FROM celebrities c
       WHERE c.status = 'published'
         AND (
           similarity(c.name, $1) > 0.2
           OR similarity(COALESCE(c.name_localized->>'ru', ''), $1) > 0.2
           OR similarity(COALESCE(c.name_localized->>'de', ''), $1) > 0.2
           OR similarity(COALESCE(c.name_localized->>'fr', ''), $1) > 0.2
           OR similarity(COALESCE(c.name_localized->>'es', ''), $1) > 0.2
           OR similarity(COALESCE(c.name_localized->>'pt', ''), $1) > 0.2
           OR similarity(COALESCE(c.name_localized->>'it', ''), $1) > 0.2
           OR similarity(COALESCE(c.name_localized->>'pl', ''), $1) > 0.2
           OR similarity(COALESCE(c.name_localized->>'nl', ''), $1) > 0.2
           OR similarity(COALESCE(c.name_localized->>'tr', ''), $1) > 0.2
           OR $1 = ANY(c.aliases)
         )
       ORDER BY sim DESC
       LIMIT $2`,
            [searchTerm, limit]
        ),
        pool.query(
            `SELECT m.*,
              GREATEST(
                similarity(m.title, $1),
                similarity(COALESCE(m.title_localized->>'ru', ''), $1),
                similarity(COALESCE(m.title_localized->>'de', ''), $1),
                similarity(COALESCE(m.title_localized->>'fr', ''), $1),
                similarity(COALESCE(m.title_localized->>'es', ''), $1),
                similarity(COALESCE(m.title_localized->>'pt', ''), $1),
                similarity(COALESCE(m.title_localized->>'it', ''), $1),
                similarity(COALESCE(m.title_localized->>'pl', ''), $1),
                similarity(COALESCE(m.title_localized->>'nl', ''), $1),
                similarity(COALESCE(m.title_localized->>'tr', ''), $1)
              ) AS sim
       FROM movies m
       WHERE m.status = 'published'
         AND (
           similarity(m.title, $1) > 0.2
           OR similarity(COALESCE(m.title_localized->>'ru', ''), $1) > 0.2
           OR similarity(COALESCE(m.title_localized->>'de', ''), $1) > 0.2
           OR similarity(COALESCE(m.title_localized->>'fr', ''), $1) > 0.2
           OR similarity(COALESCE(m.title_localized->>'es', ''), $1) > 0.2
           OR similarity(COALESCE(m.title_localized->>'pt', ''), $1) > 0.2
           OR similarity(COALESCE(m.title_localized->>'it', ''), $1) > 0.2
           OR similarity(COALESCE(m.title_localized->>'pl', ''), $1) > 0.2
           OR similarity(COALESCE(m.title_localized->>'nl', ''), $1) > 0.2
           OR similarity(COALESCE(m.title_localized->>'tr', ''), $1) > 0.2
         )
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
