import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/videos/:id/like — like or dislike a video
// Body: { action: 'like' | 'dislike' }
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!id || id.length < 8) {
            return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
        }

        const body = await request.json().catch(() => ({}));
        const action = body.action || 'like';

        if (action !== 'like' && action !== 'dislike') {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }

        const column = action === 'like' ? 'likes_count' : 'dislikes_count';
        const { rows } = await pool.query(
            `UPDATE videos SET ${column} = ${column} + 1, updated_at = NOW()
             WHERE id = $1 AND status = 'published'
             RETURNING likes_count, dislikes_count`,
            [id]
        );

        if (rows.length === 0) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        return NextResponse.json({
            likes: rows[0].likes_count,
            dislikes: rows[0].dislikes_count,
        });
    } catch {
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}
