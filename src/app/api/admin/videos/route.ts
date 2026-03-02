import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '25');
    const status = searchParams.get('status') || '';
    const offset = (page - 1) * limit;

    try {
        const whereClause = status ? `WHERE v.status = $3` : '';
        const params = status ? [limit, offset, status] : [limit, offset];

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT v.* FROM videos v ${whereClause} ORDER BY v.created_at DESC LIMIT $1 OFFSET $2`,
                params
            ),
            pool.query(
                `SELECT COUNT(*) FROM videos v ${status ? `WHERE v.status = $1` : ''}`,
                status ? [status] : []
            ),
        ]);

        return NextResponse.json({
            data: dataResult.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit,
        });
    } catch (error) {
        console.error('[API AdminVideos] error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, status, title, seo_title, seo_description } = body;

        if (!id) {
            return NextResponse.json({ error: 'Video ID required' }, { status: 400 });
        }

        const updates: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (status) {
            updates.push(`status = $${paramIndex++}`);
            params.push(status);
        }
        if (title !== undefined) {
            updates.push(`title = $${paramIndex++}`);
            params.push(title);
        }
        if (seo_title !== undefined) {
            updates.push(`seo_title = $${paramIndex++}`);
            params.push(seo_title);
        }
        if (seo_description !== undefined) {
            updates.push(`seo_description = $${paramIndex++}`);
            params.push(seo_description);
        }

        if (updates.length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        updates.push(`updated_at = NOW()`);
        params.push(id);

        const result = await pool.query(
            `UPDATE videos SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            params
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        console.error('[API AdminVideos PUT] error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');

    if (!id) {
        return NextResponse.json({ error: 'Video ID required' }, { status: 400 });
    }

    try {
        const result = await pool.query(`DELETE FROM videos WHERE id = $1 RETURNING id`, [id]);

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        return NextResponse.json({ deleted: true, id });
    } catch (error) {
        console.error('[API AdminVideos DELETE] error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
