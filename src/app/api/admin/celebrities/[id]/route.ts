import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(
    _request: NextRequest,
    { params }: { params: { id: string } }
) {
    const id = parseInt(params.id);
    if (isNaN(id)) {
        return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    try {
        const celebResult = await pool.query(
            `SELECT * FROM celebrities WHERE id = $1`,
            [id]
        );

        if (celebResult.rows.length === 0) {
            return NextResponse.json({ error: 'Celebrity not found' }, { status: 404 });
        }

        const [videosResult, moviesResult] = await Promise.all([
            pool.query(
                `SELECT v.id, v.title, v.status, v.thumbnail_url, v.ai_confidence,
                        v.views_count, v.duration_formatted, v.created_at
                 FROM videos v
                 JOIN video_celebrities vc ON vc.video_id = v.id
                 WHERE vc.celebrity_id = $1
                 ORDER BY v.created_at DESC`,
                [id]
            ),
            pool.query(
                `SELECT m.* FROM movies m
                 JOIN movie_celebrities mc ON mc.movie_id = m.id
                 WHERE mc.celebrity_id = $1
                 ORDER BY m.year DESC NULLS LAST`,
                [id]
            ),
        ]);

        return NextResponse.json({
            celebrity: celebResult.rows[0],
            videos: videosResult.rows,
            movies: moviesResult.rows,
        });
    } catch (error) {
        logger.error('Admin celebrity GET failed', { route: '/api/admin/celebrities/[id]', celebrityId: id, error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    const id = parseInt(params.id);
    if (isNaN(id)) {
        return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    try {
        const body = await request.json();
        const { name, name_localized, bio, photo_url, is_featured, nationality, birth_date, status } = body;

        const ALLOWED_STATUSES = ['draft', 'published'];
        if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
        }

        const updates: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        const addField = (fieldName: string, value: unknown) => {
            if (value !== undefined) {
                updates.push(`${fieldName} = $${idx++}`);
                values.push(value);
            }
        };

        addField('name', name);
        addField('name_localized', name_localized);
        addField('bio', bio);
        addField('photo_url', photo_url);
        addField('is_featured', is_featured);
        addField('nationality', nationality);
        addField('birth_date', birth_date);
        addField('status', status);

        if (updates.length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        updates.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query(
            `UPDATE celebrities SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Celebrity not found' }, { status: 404 });
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        logger.error('Admin celebrity PUT failed', { route: '/api/admin/celebrities/[id]', celebrityId: id, error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
