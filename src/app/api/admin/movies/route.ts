import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '25');
    const q = searchParams.get('q') || '';
    const enrichment = searchParams.get('enrichment'); // 'needed' to filter
    const offset = (page - 1) * limit;

    try {
        const conditions: string[] = [];
        const params: unknown[] = [limit, offset];
        let paramIndex = 3;

        if (q) {
            conditions.push(`m.title ILIKE $${paramIndex++}`);
            params.push(`%${q}%`);
        }
        if (enrichment === 'needed') {
            conditions.push(`(m.poster_url IS NULL OR m.poster_url = '')`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT m.*,
                    CASE WHEN (m.poster_url IS NULL OR m.poster_url = '')
                         THEN true ELSE false END AS needs_enrichment
                 FROM movies m ${whereClause}
                 ORDER BY GREATEST(m.created_at, m.updated_at) DESC LIMIT $1 OFFSET $2`,
                params
            ),
            pool.query(
                `SELECT COUNT(*) FROM movies m ${whereClause}`,
                params.slice(2)
            ),
        ]);

        return NextResponse.json({
            data: dataResult.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit,
        });
    } catch (error) {
        logger.error('Admin movies list failed', { route: '/api/admin/movies', error: error instanceof Error ? error.message : String(error) });
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
        logger.error('Admin movies delete failed', { route: '/api/admin/movies', action: 'DELETE', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
