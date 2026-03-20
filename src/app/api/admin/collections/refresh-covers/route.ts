import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { invalidateCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const result = await pool.query(`
            UPDATE collections c SET cover_url = sub.best_thumb, updated_at = NOW()
            FROM (
                SELECT DISTINCT ON (cv.collection_id)
                    cv.collection_id,
                    v.thumbnail_url AS best_thumb
                FROM collection_videos cv
                JOIN videos v ON v.id = cv.video_id AND v.thumbnail_url IS NOT NULL
                ORDER BY cv.collection_id, v.views_count DESC NULLS LAST, v.created_at DESC
            ) sub
            WHERE c.id = sub.collection_id
            AND c.is_auto = true
            AND sub.best_thumb IS NOT NULL
        `);

        await invalidateCache('collections:*');

        logger.info('Collection covers refreshed', { updated: result.rowCount });
        return NextResponse.json({ ok: true, updated: result.rowCount });
    } catch (error) {
        logger.error('Collection covers refresh failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
