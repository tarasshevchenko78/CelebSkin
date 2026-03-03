import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

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
        console.error('[API AdminTags GET] error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
