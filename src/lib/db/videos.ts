import { pool } from './pool';
import { cached } from '../cache';
import type { Video, PaginatedResult } from '../types';

// ============================================
// Videos
// ============================================

export async function getVideoBySlug(slug: string, locale: string): Promise<Video | null> {
    return cached(`video:${slug}:${locale}`, async () => {
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
            if (fallback.rows.length === 0) {
                // Fallback 2: extract short UUID from end of slug (e.g. "...-6b89de15")
                const shortId = slug.match(/([0-9a-f]{8})$/)?.[1];
                if (shortId) {
                    const idFallback = await pool.query(
                        `SELECT v.*
                         FROM videos v
                         WHERE v.id::text LIKE $1
                           AND v.status = 'published'
                         LIMIT 1`,
                        [shortId + '%']
                    );
                    if (idFallback.rows.length > 0) {
                        return enrichVideoWithRelations(idFallback.rows[0]);
                    }
                }
                return null;
            }
            return enrichVideoWithRelations(fallback.rows[0]);
        }

        return enrichVideoWithRelations(result.rows[0]);
    }, 300);
}

export async function getVideos(
    page: number = 1,
    limit: number = 24,
    orderBy: string = 'published_at',
    tagSlug?: string
): Promise<PaginatedResult<Video>> {
    const allowedOrder = ['published_at', 'views_count', 'created_at', 'duration_seconds', 'likes_count', 'rated'];
    const order = allowedOrder.includes(orderBy) ? orderBy : 'published_at';
    const cacheKey = `videos:${page}:${limit}:${order}:${tagSlug || 'all'}`;
    const orderClause = order === 'rated'
        ? `(v.likes_count - v.dislikes_count) DESC NULLS LAST, v.views_count DESC NULLS LAST`
        : `v.${order} DESC NULLS LAST`;

    return cached(cacheKey, async () => {
        const offset = (page - 1) * limit;
        const params: (string | number)[] = [limit, offset];

        let tagJoin = '';
        let dataTagWhere = '';
        let countTagWhere = '';
        if (tagSlug) {
            tagJoin = `JOIN video_tags vt ON vt.video_id = v.id
                        JOIN tags t ON t.id = vt.tag_id`;
            dataTagWhere = `AND t.slug = $3`;
            countTagWhere = `AND t.slug = $1`;
            params.push(tagSlug);
        }

        const dataQuery = `
            SELECT v.* FROM videos v
            ${tagJoin}
            WHERE v.status = 'published' ${dataTagWhere}
            ORDER BY ${orderClause}
            LIMIT $1 OFFSET $2`;

        const countQuery = `
            SELECT COUNT(*) FROM videos v
            ${tagJoin}
            WHERE v.status = 'published' ${countTagWhere}`;

        const countParams = tagSlug ? [tagSlug] : [];

        const [dataResult, countResult] = await Promise.all([
            pool.query(dataQuery, params),
            pool.query(countQuery, countParams),
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

export async function getPopularVideos(limit: number = 10): Promise<Video[]> {
    return cached(`popular_videos:${limit}`, async () => {
        const result = await pool.query(
            `SELECT * FROM videos
         WHERE status = 'published'
           AND published_at < NOW() - INTERVAL '3 days'
         ORDER BY likes_count DESC NULLS LAST, views_count DESC NULLS LAST, published_at DESC
         LIMIT $1`,
            [limit]
        );
        return result.rows;
    }, 300);
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

// Similar / Related videos — priority: same celebrity > same movie > same tags > same collection > random
// Uses partial randomization within tiers so different pages show different results
export async function getRelatedVideos(videoId: string, locale: string, limit: number = 12): Promise<Video[]> {
    const collected: Video[] = [];
    const collectedIds: string[] = [videoId];

    // Step 1: Same celebrities (highest priority)
    if (collected.length < limit) {
        const remaining = limit - collected.length;
        const result = await pool.query(
            `SELECT v.* FROM videos v
             WHERE v.id IN (
               SELECT DISTINCT vc2.video_id FROM video_celebrities vc2
               WHERE vc2.celebrity_id IN (
                 SELECT celebrity_id FROM video_celebrities WHERE video_id = $1
               )
             )
             AND v.id != ALL($3::uuid[])
             AND v.status = 'published'
             ORDER BY v.views_count DESC, RANDOM()
             LIMIT $2`,
            [videoId, remaining, collectedIds]
        );
        for (const row of result.rows) {
            collected.push(row);
            collectedIds.push(row.id);
        }
    }

    // Step 2: Same movie
    if (collected.length < limit) {
        const remaining = limit - collected.length;
        const result = await pool.query(
            `SELECT v.* FROM videos v
             WHERE v.id IN (
               SELECT DISTINCT ms2.video_id FROM movie_scenes ms2
               WHERE ms2.movie_id IN (
                 SELECT movie_id FROM movie_scenes WHERE video_id = $1
               )
             )
             AND v.id != ALL($3::uuid[])
             AND v.status = 'published'
             ORDER BY v.views_count DESC, RANDOM()
             LIMIT $2`,
            [videoId, remaining, collectedIds]
        );
        for (const row of result.rows) {
            collected.push(row);
            collectedIds.push(row.id);
        }
    }

    // Step 3: Same tags (ranked by overlap count)
    if (collected.length < limit) {
        const remaining = limit - collected.length;
        const result = await pool.query(
            `SELECT v.* FROM videos v
             JOIN video_tags vt ON vt.video_id = v.id
             WHERE vt.tag_id IN (
               SELECT tag_id FROM video_tags WHERE video_id = $1
             )
             AND v.id != ALL($3::uuid[])
             AND v.status = 'published'
             GROUP BY v.id
             ORDER BY COUNT(*) DESC, RANDOM()
             LIMIT $2`,
            [videoId, remaining, collectedIds]
        );
        for (const row of result.rows) {
            collected.push(row);
            collectedIds.push(row.id);
        }
    }

    // Step 4: Same collection/category
    if (collected.length < limit) {
        const remaining = limit - collected.length;
        const result = await pool.query(
            `SELECT v.* FROM videos v
             JOIN video_categories vc2 ON vc2.video_id = v.id
             WHERE vc2.category_id IN (
               SELECT category_id FROM video_categories WHERE video_id = $1
             )
             AND v.id != ALL($3::uuid[])
             AND v.status = 'published'
             GROUP BY v.id
             ORDER BY COUNT(*) DESC, RANDOM()
             LIMIT $2`,
            [videoId, remaining, collectedIds]
        );
        for (const row of result.rows) {
            collected.push(row);
            collectedIds.push(row.id);
        }
    }

    // Step 5: Random fallback
    if (collected.length < limit) {
        const remaining = limit - collected.length;
        const result = await pool.query(
            `SELECT v.* FROM videos v
             WHERE v.id != ALL($2::uuid[])
             AND v.status = 'published'
             ORDER BY RANDOM()
             LIMIT $1`,
            [remaining, collectedIds]
        );
        collected.push(...result.rows);
    }

    return collected;
}

// Get other videos by the same celebrity (excluding current video)
export async function getOtherVideosByCelebrity(
    celebrityId: number,
    excludeVideoId: string,
    limit: number = 4
): Promise<Video[]> {
    const result = await pool.query(
        `SELECT v.* FROM videos v
         JOIN video_celebrities vc ON vc.video_id = v.id
         WHERE vc.celebrity_id = $1
           AND v.id != $2
           AND v.status = 'published'
         ORDER BY v.views_count DESC
         LIMIT $3`,
        [celebrityId, excludeVideoId, limit]
    );
    return result.rows;
}

// Get other videos from the same movie (excluding current video)
export async function getOtherVideosByMovie(
    movieId: number,
    excludeVideoId: string,
    limit: number = 4
): Promise<Video[]> {
    const result = await pool.query(
        `SELECT v.* FROM videos v
         JOIN movie_scenes ms ON ms.video_id = v.id
         WHERE ms.movie_id = $1
           AND v.id != $2
           AND v.status = 'published'
         ORDER BY v.views_count DESC
         LIMIT $3`,
        [movieId, excludeVideoId, limit]
    );
    return result.rows;
}

// ============================================
// Private helper
// ============================================

async function enrichVideoWithRelations(video: Video): Promise<Video> {
    const [celebResult, tagResult, movieResult, rawResult, collResult, catResult] = await Promise.all([
        pool.query(
            `SELECT c.* FROM celebrities c
       JOIN video_celebrities vc ON vc.celebrity_id = c.id
       WHERE vc.video_id = $1`,
            [video.id]
        ),
        pool.query(
            `SELECT t.* FROM tags t
       JOIN video_tags vt ON vt.tag_id = t.id
       WHERE vt.video_id = $1
         AND t.is_canonical = true`,
            [video.id]
        ),
        pool.query(
            `SELECT m.* FROM movies m
       JOIN movie_scenes ms ON ms.movie_id = m.id
       WHERE ms.video_id = $1
       LIMIT 1`,
            [video.id]
        ),
        video.raw_video_id
            ? pool.query(
                `SELECT embed_code, video_file_url FROM raw_videos WHERE id = $1`,
                [video.raw_video_id]
            )
            : Promise.resolve({ rows: [] }),
        pool.query(
            `SELECT c.* FROM collections c
             JOIN collection_videos cv ON cv.collection_id = c.id
             WHERE cv.video_id = $1
             ORDER BY c.sort_order ASC`,
            [video.id]
        ),
        pool.query(
            `SELECT c.* FROM categories c
             JOIN video_categories vc ON vc.category_id = c.id
             WHERE vc.video_id = $1`,
            [video.id]
        ),
    ]);

    const raw = rawResult.rows[0] || null;

    // Fallback chain: CDN watermarked → CDN original (NEVER use raw source URL)
    const videoUrl = video.video_url
        || video.video_url_watermarked
        || null;
    const videoUrlWatermarked = video.video_url_watermarked || null;

    return {
        ...video,
        video_url: videoUrl,
        video_url_watermarked: videoUrlWatermarked,
        celebrities: celebResult.rows,
        tags: tagResult.rows,
        categories: catResult.rows,
        collections: collResult.rows,
        movie: movieResult.rows[0] || null,
        embed_code: raw?.embed_code || null,
    } as Video;
}

export async function getAdjacentVideos(
    publishedAt: string,
    locale: string
): Promise<{ prevSlug: string | null; nextSlug: string | null }> {
    const [prevRes, nextRes] = await Promise.all([
        pool.query(
            `SELECT slug->>'en' as en, slug->>$2 as loc FROM videos
             WHERE published_at < $1 AND status = 'published'
             ORDER BY published_at DESC LIMIT 1`,
            [publishedAt, locale]
        ),
        pool.query(
            `SELECT slug->>'en' as en, slug->>$2 as loc FROM videos
             WHERE published_at > $1 AND status = 'published'
             ORDER BY published_at ASC LIMIT 1`,
            [publishedAt, locale]
        ),
    ]);
    const slug = (row: { loc: string; en: string } | undefined) =>
        row ? (row.loc || row.en || null) : null;

    let nextSlug = slug(nextRes.rows[0]);
    // Cyclic: if this is the newest video, wrap around to oldest
    if (!nextSlug) {
        const oldestRes = await pool.query(
            `SELECT slug->>'en' as en, slug->>$1 as loc FROM videos
             WHERE status = 'published'
             ORDER BY published_at ASC LIMIT 1`,
            [locale]
        );
        nextSlug = slug(oldestRes.rows[0]);
    }

    return {
        prevSlug: slug(prevRes.rows[0]),
        nextSlug,
    };
}
