import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { invalidateAfterPublish } from '@/lib/cache';
import { logger } from '@/lib/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import slugify from 'slugify';

const execAsync = promisify(exec);

export const dynamic = 'force-dynamic';

function makeSlug(text: string): string {
    return slugify(text, { lower: true, strict: true, locale: 'en' });
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '20');
        const offset = (page - 1) * limit;

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT v.* FROM videos v
                 WHERE v.status IN ('needs_review', 'enriched', 'auto_recognized', 'unknown_with_suggestions')
                 ORDER BY
                    CASE v.status
                        WHEN 'unknown_with_suggestions' THEN 1
                        WHEN 'needs_review' THEN 2
                        WHEN 'auto_recognized' THEN 3
                        WHEN 'enriched' THEN 4
                    END,
                    v.ai_confidence ASC,
                    v.created_at DESC
                 LIMIT $1 OFFSET $2`,
                [limit, offset]
            ),
            pool.query(
                `SELECT COUNT(*) FROM videos
                 WHERE status IN ('needs_review', 'enriched', 'auto_recognized', 'unknown_with_suggestions')`
            ),
        ]);

        return NextResponse.json({
            videos: dataResult.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit,
        });
    } catch (error) {
        logger.error('Moderation GET failed', { route: '/api/admin/moderation', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const contentType = request.headers.get('content-type') || '';
        let videoId: string | null = null;
        let action: string | null = null;
        let movieTitle: string | undefined;
        let actorName: string | undefined;

        if (contentType.includes('application/json')) {
            const body = await request.json();
            videoId = body.videoId;
            action = body.action;
            movieTitle = body.movieTitle;
            actorName = body.actorName;
        } else {
            const formData = await request.formData();
            videoId = formData.get('videoId') as string;
            action = formData.get('action') as string;
        }

        if (!videoId || !action) {
            return NextResponse.json({ error: 'videoId and action are required' }, { status: 400 });
        }

        if (!['approve', 'reject', 'reanalyze'].includes(action)) {
            return NextResponse.json({ error: 'action must be "approve", "reject", or "reanalyze"' }, { status: 400 });
        }

        // --- REANALYZE: запустить визуальное распознавание на Contabo ---
        if (action === 'reanalyze') {
            try {
                // Reset recognition data
                await pool.query(
                    `UPDATE videos SET recognition_method = NULL, recognition_data = NULL, updated_at = NOW() WHERE id = $1`,
                    [videoId]
                );

                // Run visual recognition on Contabo for this specific video
                await execAsync(
                    `ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no root@161.97.142.117 "cd /opt/celebskin/scripts && node visual-recognize.js --limit=1" &`,
                    { timeout: 15000 }
                );

                return NextResponse.json({ status: 'reanalyzing', videoId });
            } catch (err) {
                logger.error('Moderation reanalyze failed', { route: '/api/admin/moderation', videoId, error: err instanceof Error ? err.message : String(err) });
                return NextResponse.json({ error: 'Failed to start reanalysis' }, { status: 500 });
            }
        }

        // --- REJECT ---
        if (action === 'reject') {
            const result = await pool.query(
                `UPDATE videos SET status = 'rejected', updated_at = NOW() WHERE id = $1 RETURNING id, status`,
                [videoId]
            );

            if (result.rows.length === 0) {
                return NextResponse.json({ error: 'Video not found' }, { status: 404 });
            }

            if (!contentType.includes('application/json')) {
                return NextResponse.redirect(new URL('/admin/moderation', request.url));
            }
            return NextResponse.json(result.rows[0]);
        }

        // --- APPROVE: обновить статус + связать movie/celebrity если указаны ---
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Update status
            await client.query(
                `UPDATE videos SET status = 'published', published_at = NOW(), recognition_method = COALESCE(recognition_method, 'manual'), updated_at = NOW() WHERE id = $1`,
                [videoId]
            );

            // Link celebrity if provided
            if (actorName && actorName.trim()) {
                const slug = makeSlug(actorName.trim());
                if (slug) {
                    const celResult = await client.query(
                        `INSERT INTO celebrities (name, slug) VALUES ($1, $2)
                         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
                        [actorName.trim(), slug]
                    );
                    if (celResult.rows[0]) {
                        await client.query(
                            `INSERT INTO video_celebrities (video_id, celebrity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                            [videoId, celResult.rows[0].id]
                        );
                    }
                }
            }

            // Link movie if provided
            if (movieTitle && movieTitle.trim()) {
                const movieSlug = makeSlug(movieTitle.trim());
                if (movieSlug) {
                    const movieResult = await client.query(
                        `INSERT INTO movies (title, slug, ai_matched) VALUES ($1, $2, true)
                         ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title RETURNING id`,
                        [movieTitle.trim(), movieSlug]
                    );
                    if (movieResult.rows[0]) {
                        await client.query(
                            `INSERT INTO movie_scenes (movie_id, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                            [movieResult.rows[0].id, videoId]
                        );
                    }
                }
            }

            // Log
            await client.query(
                `INSERT INTO processing_log (video_id, step, status, message, metadata)
                 VALUES ($1, 'moderation', 'approved', $2, $3::jsonb)`,
                [videoId, `Approved: movie=${movieTitle || 'n/a'}, actor=${actorName || 'n/a'}`,
                 JSON.stringify({ movieTitle, actorName, action: 'approve' })]
            );

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        await invalidateAfterPublish();

        if (!contentType.includes('application/json')) {
            return NextResponse.redirect(new URL('/admin/moderation', request.url));
        }

        return NextResponse.json({ status: 'approved', videoId });
    } catch (error) {
        logger.error('Moderation POST failed', { route: '/api/admin/moderation', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
