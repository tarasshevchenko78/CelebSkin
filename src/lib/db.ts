// CelebSkin Database Layer
import { Pool } from 'pg';
import { cached } from './cache';
import type {
    Video,
    Celebrity,
    Movie,
    Tag,
    Collection,
    BlogPost,
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
    return cached(`latest_videos:${limit}`, async () => {
        const result = await pool.query(
            `SELECT * FROM videos
         WHERE status = 'published'
         ORDER BY published_at DESC
         LIMIT $1`,
            [limit]
        );
        return result.rows;
    }, 120);
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
    orderBy: string = 'videos_count',
    letterFilter?: string
): Promise<PaginatedResult<Celebrity>> {
    const offset = (page - 1) * limit;
    const allowedOrder = ['videos_count', 'total_views', 'name', 'created_at'];
    const order = allowedOrder.includes(orderBy) ? orderBy : 'videos_count';
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

// ============================================
// Tags — additional queries
// ============================================

export async function getAllTags(limit: number = 50): Promise<Tag[]> {
    const result = await pool.query(
        `SELECT * FROM tags ORDER BY videos_count DESC LIMIT $1`,
        [limit]
    );
    return result.rows;
}

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

// ============================================
// Movies — celebrity relations
// ============================================

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

// ============================================
// Admin — Dashboard stats
// ============================================

export async function getDashboardStats(): Promise<{
    totalVideos: number;
    publishedVideos: number;
    totalCelebrities: number;
    totalMovies: number;
    totalViews: number;
    pendingVideos: number;
    totalBlogPosts: number;
}> {
    return cached('dashboard_stats', async () => {
        const [videos, published, celebs, movies, views, pending, blogs] = await Promise.all([
            pool.query(`SELECT COUNT(*) FROM videos`),
            pool.query(`SELECT COUNT(*) FROM videos WHERE status = 'published'`),
            pool.query(`SELECT COUNT(*) FROM celebrities`),
            pool.query(`SELECT COUNT(*) FROM movies`),
            pool.query(`SELECT COALESCE(SUM(views_count), 0) AS total FROM videos WHERE status = 'published'`),
            pool.query(`SELECT COUNT(*) FROM videos WHERE status IN ('new', 'processing', 'enriched', 'needs_review')`),
            pool.query(`SELECT COUNT(*) FROM blog_posts WHERE is_published = true`),
        ]);

        return {
            totalVideos: parseInt(videos.rows[0].count),
            publishedVideos: parseInt(published.rows[0].count),
            totalCelebrities: parseInt(celebs.rows[0].count),
            totalMovies: parseInt(movies.rows[0].count),
            totalViews: parseInt(views.rows[0].total),
            pendingVideos: parseInt(pending.rows[0].count),
            totalBlogPosts: parseInt(blogs.rows[0].count),
        };
    }, 60);
}

// ============================================
// Similar / Related videos
// ============================================

export async function getRelatedVideos(videoId: string, limit: number = 4): Promise<Video[]> {
    const result = await pool.query(
        `SELECT v.* FROM videos v
         WHERE v.id != $1 AND v.status = 'published'
         ORDER BY v.views_count DESC
         LIMIT $2`,
        [videoId, limit]
    );
    return result.rows;
}
