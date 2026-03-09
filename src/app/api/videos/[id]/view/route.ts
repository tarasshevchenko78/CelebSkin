import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/videos/:id/view — increment view count
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!id || id.length < 8) {
            return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
        }

        const { rows } = await pool.query(
            `UPDATE videos SET views_count = views_count + 1, updated_at = NOW()
             WHERE id = $1 AND status = 'published'
             RETURNING views_count`,
            [id]
        );

        if (rows.length === 0) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        return NextResponse.json({ views: rows[0].views_count });
    } catch {
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}
