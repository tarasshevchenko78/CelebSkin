import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// POST /api/admin/videos/[id]/thumbnail
// Body: { screenshot_url: string }
// Sets thumbnail_url to the provided screenshot URL (must be a CDN URL).
export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    const videoId = params.id;

    let body: { screenshot_url?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { screenshot_url } = body;

    if (!screenshot_url || typeof screenshot_url !== 'string') {
        return NextResponse.json({ error: 'screenshot_url is required' }, { status: 400 });
    }

    // Validate it's a CDN or known screenshot URL
    const isCdnUrl = screenshot_url.includes('b-cdn.net') || screenshot_url.includes('xcadr.online');
    if (!isCdnUrl) {
        return NextResponse.json(
            { error: 'screenshot_url must be a CDN URL (b-cdn.net) or xcadr screenshot URL' },
            { status: 400 }
        );
    }

    try {
        const result = await pool.query(
            `UPDATE videos SET thumbnail_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id, thumbnail_url`,
            [screenshot_url, videoId]
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        // Invalidate cache for this video
        try {
            const { invalidateAfterEdit } = await import('@/lib/cache');
            await invalidateAfterEdit();
        } catch {
            // non-critical
        }

        logger.info('Video thumbnail updated', { videoId, thumbnail_url: screenshot_url });
        return NextResponse.json({ success: true, thumbnail_url: screenshot_url });
    } catch (error) {
        logger.error('Video thumbnail update failed', {
            route: '/api/admin/videos/[id]/thumbnail',
            videoId,
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
