import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { invalidateCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const result = await pool.query(
            `SELECT id, title, slug, cover_url, videos_count, is_auto, featured, sort_order
             FROM collections
             ORDER BY videos_count DESC, id DESC`
        );
        return NextResponse.json(result.rows);
    } catch (error) {
        logger.error('Collections fetch failed', { route: 'GET /api/admin/collections', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// PATCH /api/admin/collections  { id, cover_url }
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { id, cover_url, featured, sort_order } = body;

        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (cover_url !== undefined) { fields.push(`cover_url = $${idx++}`); values.push(cover_url || null); }
        if (featured !== undefined) { fields.push(`featured = $${idx++}`); values.push(!!featured); }
        if (sort_order !== undefined) { fields.push(`sort_order = $${idx++}`); values.push(Number(sort_order)); }

        if (fields.length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

        fields.push(`updated_at = NOW()`);
        values.push(id);

        await pool.query(
            `UPDATE collections SET ${fields.join(', ')} WHERE id = $${idx}`,
            values
        );

        await invalidateCache('collections:*');

        return NextResponse.json({ ok: true });
    } catch (error) {
        logger.error('Collection update failed', { route: 'PATCH /api/admin/collections', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
