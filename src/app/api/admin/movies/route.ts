import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '25');
    const q = searchParams.get('q') || '';
    const offset = (page - 1) * limit;

    try {
        const whereClause = q ? `WHERE m.title ILIKE $3` : '';
        const params = q ? [limit, offset, `%${q}%`] : [limit, offset];

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT m.* FROM movies m ${whereClause} ORDER BY m.created_at DESC LIMIT $1 OFFSET $2`,
                params
            ),
            pool.query(
                `SELECT COUNT(*) FROM movies m ${q ? `WHERE m.title ILIKE $1` : ''}`,
                q ? [`%${q}%`] : []
            ),
        ]);

        return NextResponse.json({
            data: dataResult.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit,
        });
    } catch (error) {
        console.error('[API AdminMovies] error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const body = await request.json();
        const ids: number[] = body.ids;

        if (!Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: 'ids[] required' }, { status: 400 });
        }
        if (ids.length > 100) {
            return NextResponse.json({ error: 'Maximum 100 items per batch' }, { status: 400 });
        }

        // All FK references to movies(id) have ON DELETE CASCADE
        const result = await pool.query(
            `DELETE FROM movies WHERE id = ANY($1::int[]) RETURNING id`,
            [ids]
        );

        return NextResponse.json({ deleted: true, count: result.rowCount, ids: result.rows.map((r: { id: number }) => r.id) });
    } catch (error) {
        console.error('[API AdminMovies DELETE] error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
