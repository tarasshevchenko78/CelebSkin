import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
    _request: NextRequest,
    { params }: { params: { id: string } }
) {
    const { id } = params;

    try {
        const videoResult = await pool.query(
            `SELECT v.* FROM videos v WHERE v.id = $1`,
            [id]
        );

        if (videoResult.rows.length === 0) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        const video = videoResult.rows[0];

        const [celebResult, tagResult, movieResult, rawResult] = await Promise.all([
            pool.query(
                `SELECT c.* FROM celebrities c
                 JOIN video_celebrities vc ON vc.celebrity_id = c.id
                 WHERE vc.video_id = $1`,
                [id]
            ),
            pool.query(
                `SELECT t.* FROM tags t
                 JOIN video_tags vt ON vt.tag_id = t.id
                 WHERE vt.video_id = $1`,
                [id]
            ),
            pool.query(
                `SELECT m.*, ms.scene_number FROM movies m
                 JOIN movie_scenes ms ON ms.movie_id = m.id
                 WHERE ms.video_id = $1
                 LIMIT 1`,
                [id]
            ),
            video.raw_video_id
                ? pool.query(
                      `SELECT * FROM raw_videos WHERE id = $1`,
                      [video.raw_video_id]
                  )
                : Promise.resolve({ rows: [] }),
        ]);

        return NextResponse.json({
            video,
            celebrities: celebResult.rows,
            tags: tagResult.rows,
            movie: movieResult.rows[0] || null,
            rawVideo: rawResult.rows[0] || null,
        });
    } catch (error) {
        console.error('[API AdminVideo GET] error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    const { id } = params;

    try {
        const body = await request.json();
        const {
            title, review, seo_title, seo_description,
            status, quality, original_title,
            thumbnail_url, video_url, video_url_watermarked,
        } = body;

        const updates: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        const addField = (name: string, value: unknown) => {
            if (value !== undefined) {
                updates.push(`${name} = $${idx++}`);
                values.push(value);
            }
        };

        addField('title', title);
        addField('review', review);
        addField('seo_title', seo_title);
        addField('seo_description', seo_description);
        addField('status', status);
        addField('quality', quality);
        addField('original_title', original_title);
        addField('thumbnail_url', thumbnail_url);
        addField('video_url', video_url);
        addField('video_url_watermarked', video_url_watermarked);

        if (updates.length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        // Auto-set published_at when publishing
        if (status === 'published') {
            updates.push(`published_at = COALESCE(published_at, NOW())`);
        }

        updates.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query(
            `UPDATE videos SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        console.error('[API AdminVideo PUT] error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: { id: string } }
) {
    const { id } = params;

    try {
        const result = await pool.query(
            `DELETE FROM videos WHERE id = $1 RETURNING id`,
            [id]
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        return NextResponse.json({ deleted: true, id });
    } catch (error) {
        console.error('[API AdminVideo DELETE] error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
