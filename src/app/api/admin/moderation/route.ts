import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const contentType = request.headers.get('content-type') || '';
        let videoId: string | null = null;
        let action: string | null = null;

        if (contentType.includes('application/json')) {
            const body = await request.json();
            videoId = body.videoId;
            action = body.action;
        } else {
            const formData = await request.formData();
            videoId = formData.get('videoId') as string;
            action = formData.get('action') as string;
        }

        if (!videoId || !action) {
            return NextResponse.json({ error: 'videoId and action are required' }, { status: 400 });
        }

        if (!['approve', 'reject'].includes(action)) {
            return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
        }

        const newStatus = action === 'approve' ? 'published' : 'rejected';
        const publishedAt = action === 'approve' ? ', published_at = NOW()' : '';

        const result = await pool.query(
            `UPDATE videos SET status = $1, updated_at = NOW()${publishedAt} WHERE id = $2 RETURNING id, status`,
            [newStatus, videoId]
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        // For form submissions, redirect back to moderation
        if (!contentType.includes('application/json')) {
            return NextResponse.redirect(new URL('/admin/moderation', request.url));
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        console.error('[API AdminModeration] error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
