import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

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
        const movieResult = await pool.query(
            `SELECT * FROM movies WHERE id = $1`,
            [id]
        );

        if (movieResult.rows.length === 0) {
            return NextResponse.json({ error: 'Movie not found' }, { status: 404 });
        }

        const [scenesResult, castResult] = await Promise.all([
            pool.query(
                `SELECT v.id, v.title, v.status, v.thumbnail_url, v.views_count,
                        v.duration_formatted, v.ai_confidence, ms.scene_number
                 FROM videos v
                 JOIN movie_scenes ms ON ms.video_id = v.id
                 WHERE ms.movie_id = $1
                 ORDER BY ms.scene_number ASC NULLS LAST, v.created_at DESC`,
                [id]
            ),
            pool.query(
                `SELECT c.*, mc.role FROM celebrities c
                 JOIN movie_celebrities mc ON mc.celebrity_id = c.id
                 WHERE mc.movie_id = $1
                 ORDER BY c.total_views DESC`,
                [id]
            ),
        ]);

        return NextResponse.json({
            movie: movieResult.rows[0],
            scenes: scenesResult.rows,
            celebrities: castResult.rows,
        });
    } catch (error) {
        console.error('[API AdminMovie GET] error:', error);
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
        const { title, title_localized, year, poster_url, studio, director, description, genres } = body;

        const updates: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        const addField = (fieldName: string, value: unknown) => {
            if (value !== undefined) {
                updates.push(`${fieldName} = $${idx++}`);
                values.push(value);
            }
        };

        addField('title', title);
        addField('title_localized', title_localized);
        addField('year', year);
        addField('poster_url', poster_url);
        addField('studio', studio);
        addField('director', director);
        addField('description', description);
        addField('genres', genres);

        if (updates.length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        updates.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query(
            `UPDATE movies SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Movie not found' }, { status: 404 });
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        console.error('[API AdminMovie PUT] error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
