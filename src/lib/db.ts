// CelebSkin Database Layer
import { Pool } from 'pg';
import type {
    Video,
    Celebrity,
    Movie,
    Tag,
    PaginatedResult,
    SearchResult,
    LocalizedField,
} from './types';

// PostgreSQL connection pool
const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'celebskin',
    user: process.env.DB_USER || 'celebskin',
    password: process.env.DB_PASSWORD || '',
    max: 20,
    idleTimeoutMillis: 30000,
});

export { pool };

// ============================================
// Helper: get localized value from JSONB field
// ============================================
export function getLocalized(
    field: LocalizedField | null | undefined,
    locale: string,
    fallback: string = 'en'
): string {
    if (!field || typeof field !== 'object') return '';
    return field[locale] || field[fallback] || field['en'] || Object.values(field)[0] || '';
}

// ============================================
// Videos
// ============================================

export async function getVideoBySlug(slug: string, locale: string): Promise<Video | null> {
    const result = await pool.query(
        `SELECT v.*
     FROM videos v
     WHERE v.slug->>$1 = $2
       AND v.status = 'published'
     LIMIT 1`,
        [locale, slug]
    );

    if (result.rows.length === 0) {
        // Fallback: try English slug
        const fallback = await pool.query(
            `SELECT v.*
       FROM videos v
       WHERE v.slug->>'en' = $1
         AND v.status = 'published'
       LIMIT 1`,
            [slug]
        );
        if (fallback.rows.length === 0) return null;
        return enrichVideoWithRelations(fallback.rows[0]);
    }

    return enrichVideoWithRelations(result.rows[0]);
}

export async function getVideos(
    page: number = 1,
    limit: number = 24,
    orderBy: string = 'published_at'
): Promise<PaginatedResult<Video>> {
    const offset = (page - 1) * limit;
    const allowedOrder = ['published_at', 'views_count', 'created_at'];
    const order = allowedOrder.includes(orderBy) ? orderBy : 'published_at';

    const [dataResult, countResult] = await Promise.all([
        pool.query(
            `SELECT * FROM videos
       WHERE status = 'published'
       ORDER BY ${order} DESC
       LIMIT $1 OFFSET $2`,
            [limit, offset]
        ),
        pool.query(`SELECT COUNT(*) FROM videos WHERE status = 'published'`),
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

export async function getLatestVideos(limit: number = 12): Promise<Video[]> {
    const result = await pool.query(
        `SELECT * FROM videos
     WHERE status = 'published'
     ORDER BY published_at DESC
     LIMIT $1`,
        [limit]
    );
    return result.rows;
}

export async function getFeaturedVideo(): Promise<Video | null> {
    const result = await pool.query(
        `SELECT * FROM videos
     WHERE status = 'published'
     ORDER BY views_count DESC
     LIMIT 1`
    );
    return result.rows[0] || null;
}

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
    orderBy: string = 'videos_count'
): Promise<PaginatedResult<Celebrity>> {
    const offset = (page - 1) * limit;
    const allowedOrder = ['videos_count', 'total_views', 'name', 'created_at'];
    const order = allowedOrder.includes(orderBy) ? orderBy : 'videos_count';
    const dir = order === 'name' ? 'ASC' : 'DESC';

    const [dataResult, countResult] = await Promise.all([
        pool.query(
            `SELECT * FROM celebrities
       ORDER BY ${order} ${dir}
       LIMIT $1 OFFSET $2`,
            [limit, offset]
        ),
        pool.query(`SELECT COUNT(*) FROM celebrities`),
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

export async function getTrendingCelebrities(limit: number = 10): Promise<Celebrity[]> {
    const result = await pool.query(
        `SELECT * FROM celebrities
     WHERE is_featured = true OR videos_count > 0
     ORDER BY total_views DESC, videos_count DESC
     LIMIT $1`,
        [limit]
    );
    return result.rows;
}

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
    const offset = (page - 1) * limit;
    const allowedOrder = ['scenes_count', 'total_views', 'year', 'title', 'created_at'];
    const order = allowedOrder.includes(orderBy) ? orderBy : 'scenes_count';
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
}

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
        // Search celebrities
        pool.query(
            `SELECT c.*, similarity(c.name, $1) AS sim
       FROM celebrities c
       WHERE similarity(c.name, $1) > 0.2
          OR $1 = ANY(c.aliases)
       ORDER BY sim DESC
       LIMIT $2`,
            [searchTerm, limit]
        ),
        // Search movies
        pool.query(
            `SELECT m.*, similarity(m.title, $1) AS sim
       FROM movies m
       WHERE similarity(m.title, $1) > 0.2
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

// ============================================
// Helpers
// ============================================

async function enrichVideoWithRelations(video: Video): Promise<Video> {
    const [celebResult, tagResult] = await Promise.all([
        pool.query(
            `SELECT c.* FROM celebrities c
       JOIN video_celebrities vc ON vc.celebrity_id = c.id
       WHERE vc.video_id = $1`,
            [video.id]
        ),
        pool.query(
            `SELECT t.* FROM tags t
       JOIN video_tags vt ON vt.tag_id = t.id
       WHERE vt.video_id = $1`,
            [video.id]
        ),
    ]);

    return {
        ...video,
        celebrities: celebResult.rows,
        tags: tagResult.rows,
    };
}

// Get videos for a specific celebrity
export async function getVideosForCelebrity(
    celebrityId: number,
    page: number = 1,
    limit: number = 24
): Promise<PaginatedResult<Video>> {
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
        pool.query(
            `SELECT v.* FROM videos v
       JOIN video_celebrities vc ON vc.video_id = v.id
       WHERE vc.celebrity_id = $1 AND v.status = 'published'
       ORDER BY v.published_at DESC
       LIMIT $2 OFFSET $3`,
            [celebrityId, limit, offset]
        ),
        pool.query(
            `SELECT COUNT(*) FROM videos v
       JOIN video_celebrities vc ON vc.video_id = v.id
       WHERE vc.celebrity_id = $1 AND v.status = 'published'`,
            [celebrityId]
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

// Get videos for a specific movie
export async function getVideosForMovie(
    movieId: number,
    page: number = 1,
    limit: number = 24
): Promise<PaginatedResult<Video>> {
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
        pool.query(
            `SELECT v.* FROM videos v
       JOIN movie_scenes ms ON ms.video_id = v.id
       WHERE ms.movie_id = $1 AND v.status = 'published'
       ORDER BY ms.scene_number ASC, v.published_at DESC
       LIMIT $2 OFFSET $3`,
            [movieId, limit, offset]
        ),
        pool.query(
            `SELECT COUNT(*) FROM videos v
       JOIN movie_scenes ms ON ms.video_id = v.id
       WHERE ms.movie_id = $1 AND v.status = 'published'`,
            [movieId]
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

// Get videos by tag
export async function getVideosByTag(
    tagSlug: string,
    page: number = 1,
    limit: number = 24
): Promise<PaginatedResult<Video>> {
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
        pool.query(
            `SELECT v.* FROM videos v
       JOIN video_tags vt ON vt.video_id = v.id
       JOIN tags t ON t.id = vt.tag_id
       WHERE t.slug = $1 AND v.status = 'published'
       ORDER BY v.published_at DESC
       LIMIT $2 OFFSET $3`,
            [tagSlug, limit, offset]
        ),
        pool.query(
            `SELECT COUNT(*) FROM videos v
       JOIN video_tags vt ON vt.video_id = v.id
       JOIN tags t ON t.id = vt.tag_id
       WHERE t.slug = $1 AND v.status = 'published'`,
            [tagSlug]
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
