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
