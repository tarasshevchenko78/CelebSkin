import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';

export async function GET(req: NextRequest) {
    const sort   = req.nextUrl.searchParams.get('sort') || 'newest';
    const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') || '0'));
    const limit  = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '20')));

    const orderBy = sort === 'popular'
        ? 'likes_count DESC NULLS LAST, views_count DESC NULLS LAST, published_at DESC'
        : 'published_at DESC';

    try {
        const result = await pool.query(
            `SELECT id, slug, title, thumbnail_url, preview_url, preview_gif_url,
                    screenshots, duration_seconds, duration_formatted,
                    quality, views_count, likes_count, published_at
             FROM videos
             WHERE status = 'published'
             ORDER BY ${orderBy}
             OFFSET $1 LIMIT $2`,
            [offset, limit]
        );
        return NextResponse.json(result.rows);
    } catch {
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
