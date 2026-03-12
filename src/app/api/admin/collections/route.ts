import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const result = await pool.query(
            `SELECT id, title, slug, videos_count
             FROM collections
             ORDER BY videos_count DESC, id DESC`
        );
        return NextResponse.json(result.rows);
    } catch (error) {
        logger.error('Collections fetch failed', { route: '/api/admin/collections', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
