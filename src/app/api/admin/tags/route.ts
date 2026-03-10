import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const result = await pool.query(
            `SELECT id, name, name_localized, slug, videos_count
             FROM tags
             ORDER BY videos_count DESC`
        );
        return NextResponse.json(result.rows);
    } catch (error) {
        logger.error('Tags fetch failed', { route: '/api/admin/tags', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
