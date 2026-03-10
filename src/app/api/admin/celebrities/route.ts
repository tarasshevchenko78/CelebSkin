import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '25');
    const q = searchParams.get('q') || '';
    const offset = (page - 1) * limit;

    try {
        const whereClause = q ? `WHERE c.name ILIKE $3` : '';
        const params = q ? [limit, offset, `%${q}%`] : [limit, offset];

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT c.* FROM celebrities c ${whereClause} ORDER BY c.total_views DESC LIMIT $1 OFFSET $2`,
                params
            ),
            pool.query(
                `SELECT COUNT(*) FROM celebrities c ${q ? `WHERE c.name ILIKE $1` : ''}`,
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
        logger.error('Admin celebrities list failed', { route: '/api/admin/celebrities', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, name, bio, photo_url, is_featured } = body;

        if (!id) {
            return NextResponse.json({ error: 'Celebrity ID required' }, { status: 400 });
        }

        const updates: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramIndex++}`);
            params.push(name);
        }
        if (bio !== undefined) {
            updates.push(`bio = $${paramIndex++}`);
            params.push(bio);
        }
        if (photo_url !== undefined) {
            updates.push(`photo_url = $${paramIndex++}`);
            params.push(photo_url);
        }
        if (is_featured !== undefined) {
            updates.push(`is_featured = $${paramIndex++}`);
            params.push(is_featured);
        }

        if (updates.length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        updates.push(`updated_at = NOW()`);
        params.push(id);

        const result = await pool.query(
            `UPDATE celebrities SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            params
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Celebrity not found' }, { status: 404 });
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        logger.error('Admin celebrities update failed', { route: '/api/admin/celebrities', action: 'PUT', error: error instanceof Error ? error.message : String(error) });
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

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Nullify non-cascading FK references
            await client.query(`UPDATE ai_chat_sessions SET celebrity_id = NULL WHERE celebrity_id = ANY($1::int[])`, [ids]);
            await client.query(`UPDATE ai_stories SET celebrity_id = NULL WHERE celebrity_id = ANY($1::int[])`, [ids]);
            await client.query(`UPDATE blog_posts SET celebrity_id = NULL WHERE celebrity_id = ANY($1::int[])`, [ids]);
            // Delete celebrities (video_celebrities, movie_celebrities, celebrity_photos cascade)
            const result = await client.query(
                `DELETE FROM celebrities WHERE id = ANY($1::int[]) RETURNING id`,
                [ids]
            );
            await client.query('COMMIT');
            return NextResponse.json({ deleted: true, count: result.rowCount, ids: result.rows.map((r: { id: number }) => r.id) });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Admin celebrities delete failed', { route: '/api/admin/celebrities', action: 'DELETE', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
