import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const LOCALES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'nl', 'tr', 'ru'] as const;

function toSlug(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip accents
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 190);
}

function buildJsonb(values: Record<string, string>): string {
    return JSON.stringify(values);
}

function allLocalesOf(value: string): Record<string, string> {
    return Object.fromEntries(LOCALES.map((l) => [l, value]));
}

// ─── GET /api/admin/xcadr ────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status') || null;
    const search = searchParams.get('search') || null;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const offset = (page - 1) * limit;

    try {
        const [dataResult, countResult, statsResult] = await Promise.all([
            pool.query(
                `SELECT * FROM xcadr_imports
                 WHERE ($1::text IS NULL OR status = $1)
                   AND ($2::text IS NULL OR
                        title_ru          ILIKE '%' || $2 || '%' OR
                        title_en          ILIKE '%' || $2 || '%' OR
                        celebrity_name_ru ILIKE '%' || $2 || '%' OR
                        celebrity_name_en ILIKE '%' || $2 || '%' OR
                        movie_title_ru    ILIKE '%' || $2 || '%' OR
                        movie_title_en    ILIKE '%' || $2 || '%'
                   )
                 ORDER BY created_at DESC
                 LIMIT $3 OFFSET $4`,
                [status, search, limit, offset]
            ),
            pool.query(
                `SELECT COUNT(*)::int AS count FROM xcadr_imports
                 WHERE ($1::text IS NULL OR status = $1)
                   AND ($2::text IS NULL OR
                        title_ru          ILIKE '%' || $2 || '%' OR
                        title_en          ILIKE '%' || $2 || '%' OR
                        celebrity_name_ru ILIKE '%' || $2 || '%' OR
                        celebrity_name_en ILIKE '%' || $2 || '%' OR
                        movie_title_ru    ILIKE '%' || $2 || '%' OR
                        movie_title_en    ILIKE '%' || $2 || '%'
                   )`,
                [status, search]
            ),
            pool.query(
                `SELECT status, COUNT(*)::int AS count FROM xcadr_imports GROUP BY status`
            ),
        ]);

        const rawStats = statsResult.rows.reduce<Record<string, number>>((acc, r) => {
            acc[r.status] = r.count;
            return acc;
        }, {});

        const allStatuses = ['parsed', 'translated', 'matched', 'no_match', 'imported', 'skipped', 'duplicate'];
        const stats: Record<string, number> = { total: 0 };
        for (const s of allStatuses) {
            stats[s] = rawStats[s] || 0;
            stats.total += stats[s];
        }

        return NextResponse.json({
            imports: dataResult.rows,
            total: countResult.rows[0].count,
            page,
            stats,
        });
    } catch (error) {
        logger.error('xcadr imports list failed', {
            route: '/api/admin/xcadr',
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// ─── POST /api/admin/xcadr ───────────────────────────────────────────────────
export async function POST(request: NextRequest) {
    let body: { action?: string; ids?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { action, ids } = body;

    const ALLOWED_ACTIONS = ['skip', 'retry', 'delete', 'import'];
    if (!action || !ALLOWED_ACTIONS.includes(action)) {
        return NextResponse.json(
            { error: `action must be one of: ${ALLOWED_ACTIONS.join(', ')}` },
            { status: 400 }
        );
    }

    if (!Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 });
    }

    const safeIds = (ids as unknown[])
        .map((id) => parseInt(String(id)))
        .filter((id) => !isNaN(id));

    if (safeIds.length === 0) {
        return NextResponse.json({ error: 'No valid ids provided' }, { status: 400 });
    }

    try {
        // ── skip ──────────────────────────────────────────────────────────────
        if (action === 'skip') {
            const result = await pool.query(
                `UPDATE xcadr_imports SET status = 'skipped', updated_at = NOW() WHERE id = ANY($1::int[])`,
                [safeIds]
            );
            return NextResponse.json({ success: true, updated: result.rowCount });
        }

        // ── retry ─────────────────────────────────────────────────────────────
        if (action === 'retry') {
            const result = await pool.query(
                `UPDATE xcadr_imports
                 SET status = 'parsed',
                     title_en = NULL, celebrity_name_en = NULL, movie_title_en = NULL,
                     matched_video_id = NULL, matched_celebrity_id = NULL,
                     matched_movie_id = NULL, boobsradar_url = NULL,
                     updated_at = NOW()
                 WHERE id = ANY($1::int[])`,
                [safeIds]
            );
            return NextResponse.json({ success: true, updated: result.rowCount });
        }

        // ── delete ────────────────────────────────────────────────────────────
        if (action === 'delete') {
            const result = await pool.query(
                `DELETE FROM xcadr_imports WHERE id = ANY($1::int[])`,
                [safeIds]
            );
            return NextResponse.json({ success: true, deleted: result.rowCount });
        }

        // ── import ────────────────────────────────────────────────────────────
        if (action === 'import') {
            const importRows = await pool.query(
                `SELECT * FROM xcadr_imports WHERE id = ANY($1::int[]) AND status = 'matched'`,
                [safeIds]
            );

            if (importRows.rows.length === 0) {
                return NextResponse.json({ error: 'No matched items found for the given ids' }, { status: 400 });
            }

            const videoIds: string[] = [];
            let importedCount = 0;

            logger.info('xcadr import started', { count: importRows.rows.length, ids: safeIds });

            for (const row of importRows.rows) {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    // STEP 1: Celebrity
                    let celebrityId: number | null = row.matched_celebrity_id || null;
                    if (!celebrityId && row.celebrity_name_en) {
                        const celebSlug = toSlug(row.celebrity_name_en);
                        const celebRes = await client.query(
                            `INSERT INTO celebrities (name, slug, status)
                             VALUES ($1, $2, 'draft')
                             ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                             RETURNING id`,
                            [row.celebrity_name_en, celebSlug]
                        );
                        celebrityId = celebRes.rows[0]?.id ?? null;
                    }

                    // STEP 2: Movie
                    let movieId: number | null = row.matched_movie_id || null;
                    if (!movieId && row.movie_title_en) {
                        // Check if movie exist by title first (to prevent duplicate slugs with different suffixes)
                        const existingByTitle = await client.query(
                            'SELECT id FROM movies WHERE title = $1 LIMIT 1',
                            [row.movie_title_en]
                        );

                        if (existingByTitle.rows.length > 0) {
                            movieId = existingByTitle.rows[0].id;
                        } else {
                            const yearSuffix = row.movie_year ? `-${row.movie_year}` : '';
                            const movieSlug = toSlug(row.movie_title_en) + yearSuffix;
                            const titleLocalizedJson = buildJsonb(allLocalesOf(row.movie_title_en));

                            const movieRes = await client.query(
                                `INSERT INTO movies (title, title_localized, slug, year, status)
                                 VALUES ($1, $2::jsonb, $3, $4, 'draft')
                                 ON CONFLICT (slug) DO NOTHING
                                 RETURNING id`,
                                [row.movie_title_en, titleLocalizedJson, movieSlug, row.movie_year || null]
                            );
                            if (movieRes.rows.length > 0) {
                                movieId = movieRes.rows[0].id;
                            } else {
                                const existing = await client.query(
                                    'SELECT id FROM movies WHERE slug = $1',
                                    [movieSlug]
                                );
                                movieId = existing.rows[0]?.id ?? null;
                            }
                        }
                    }

                    // STEP 3: Video record
                    const titleEn = row.title_en || (
                        row.celebrity_name_en && row.movie_title_en
                            ? `${row.celebrity_name_en} nude scene - ${row.movie_title_en}${row.movie_year ? ` (${row.movie_year})` : ''}`
                            : row.celebrity_name_en
                                ? `${row.celebrity_name_en} nude scene`
                                : row.title_ru
                    );

                    const videoTitle = buildJsonb({ ...allLocalesOf(titleEn), ru: row.title_ru || titleEn });

                    // Build seo_description from description_en (all locales same value for now)
                    const seoDescJson = row.description_en
                        ? buildJsonb({ ...allLocalesOf(row.description_en), ru: row.description_ru || row.description_en })
                        : null;

                    // Insert with placeholder slug first to get the UUID.
                    // video_url intentionally omitted — stays NULL so download-and-process.js picks it up.
                    // boobsradar_url from xcadr_imports is NOT written to videos.video_url.
                    const placeholderSlug = buildJsonb(allLocalesOf('importing'));
                    const videoRes = await client.query(
                        `INSERT INTO videos (title, slug, original_title, duration_seconds, seo_description, status)
                         VALUES ($1::jsonb, $2::jsonb, $3, $4, $5::jsonb, 'new')
                         RETURNING id`,
                        [videoTitle, placeholderSlug, titleEn, row.duration_seconds || null, seoDescJson]
                    );
                    const videoId: string = videoRes.rows[0].id;
                    const shortId = videoId.replace(/-/g, '').substring(0, 8);

                    // Update slug with UUID suffix (prevents collision between similar titles)
                    const slugBase = toSlug(titleEn);
                    const videoSlug = buildJsonb(allLocalesOf(`${slugBase}-${shortId}`));
                    await client.query(
                        `UPDATE videos SET slug = $1::jsonb WHERE id = $2`,
                        [videoSlug, videoId]
                    );

                    // STEP 4: Link celebrity
                    if (celebrityId) {
                        await client.query(
                            `INSERT INTO video_celebrities (video_id, celebrity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                            [videoId, celebrityId]
                        );
                    }

                    // STEP 5: Link movie
                    if (movieId) {
                        await client.query(
                            `INSERT INTO movie_scenes (movie_id, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                            [movieId, videoId]
                        );
                    }

                    // STEP 6: Apply tags from xcadr_tag_mapping
                    // Fallback: if no mapping, try direct Russian name match in tags table
                    const tagsRu = Array.isArray(row.tags_ru) ? (row.tags_ru as string[]) : [];
                    let tagsLinked = 0;
                    logger.info('xcadr import step6 tags', {
                        videoId, xcadrId: row.id, total: tagsRu.length,
                    });
                    for (const tagRu of tagsRu) {
                        let tagId: number | null = null;

                        // Primary: xcadr_tag_mapping lookup
                        const mapping = await client.query(
                            `SELECT our_tag_slug FROM xcadr_tag_mapping
                             WHERE xcadr_tag_ru = $1 AND our_tag_slug IS NOT NULL`,
                            [tagRu]
                        );
                        if (mapping.rows.length > 0) {
                            const tagRow = await client.query(
                                `SELECT id FROM tags WHERE slug = $1`,
                                [mapping.rows[0].our_tag_slug]
                            );
                            if (tagRow.rows.length > 0) tagId = tagRow.rows[0].id;
                        }

                        // Fallback: match by Russian name in name_localized
                        if (!tagId) {
                            const tagByName = await client.query(
                                `SELECT id FROM tags WHERE name_localized->>'ru' ILIKE $1`,
                                [tagRu]
                            );
                            if (tagByName.rows.length > 0) tagId = tagByName.rows[0].id;
                        }

                        if (tagId) {
                            await client.query(
                                `INSERT INTO video_tags (video_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                                [videoId, tagId]
                            );
                            tagsLinked++;
                        } else {
                            logger.warn('xcadr import tag not found', { videoId, tagRu });
                        }
                    }
                    if (tagsRu.length > 0) {
                        logger.info('xcadr import step6 done', { videoId, linked: tagsLinked, of: tagsRu.length });
                    }

                    // STEP 7: Apply collections from xcadr_collection_mapping
                    const collectionsRu = Array.isArray(row.collections_ru) ? (row.collections_ru as string[]) : [];
                    let collectionsLinked = 0;
                    logger.info('xcadr import step7 collections', {
                        videoId, xcadrId: row.id, total: collectionsRu.length,
                        collections: collectionsRu,
                    });
                    for (const colRu of collectionsRu) {
                        const mapping = await client.query(
                            `SELECT our_collection_id FROM xcadr_collection_mapping
                             WHERE xcadr_collection_ru = $1 AND our_collection_id IS NOT NULL`,
                            [colRu]
                        );
                        if (mapping.rows.length > 0) {
                            await client.query(
                                `INSERT INTO collection_videos (collection_id, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                                [mapping.rows[0].our_collection_id, videoId]
                            );
                            collectionsLinked++;
                            logger.info('xcadr import collection linked', {
                                videoId, colRu, collectionId: mapping.rows[0].our_collection_id,
                            });
                        } else {
                            logger.warn('xcadr import collection not mapped', { videoId, colRu });
                        }
                    }
                    if (collectionsRu.length > 0) {
                        logger.info('xcadr import step7 done', {
                            videoId, linked: collectionsLinked, of: collectionsRu.length,
                        });
                    }

                    // STEP 8: Mark xcadr_import as imported
                    await client.query(
                        `UPDATE xcadr_imports
                         SET status = 'imported', matched_video_id = $1, updated_at = NOW()
                         WHERE id = $2`,
                        [videoId, row.id]
                    );

                    await client.query('COMMIT');
                    videoIds.push(videoId);
                    importedCount++;
                } catch (err) {
                    await client.query('ROLLBACK');
                    logger.error('xcadr import row failed', {
                        xcadr_id: row.id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                } finally {
                    client.release();
                }
            }

            // STEP 9: Invalidate caches
            if (importedCount > 0) {
                try {
                    const { invalidateAfterEdit } = await import('@/lib/cache');
                    await invalidateAfterEdit();
                } catch {
                    // non-critical
                }
            }

            return NextResponse.json({ success: true, imported: importedCount, video_ids: videoIds });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error) {
        logger.error('xcadr bulk action failed', {
            route: '/api/admin/xcadr',
            action,
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
