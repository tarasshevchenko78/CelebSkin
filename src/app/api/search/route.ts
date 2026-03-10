import { NextRequest, NextResponse } from 'next/server';
import { searchAll } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const query = request.nextUrl.searchParams.get('q') || '';
    if (query.length < 2) {
        return NextResponse.json({ videos: [], celebrities: [], movies: [] });
    }
    try {
        const results = await searchAll(query, 24);
        return NextResponse.json(results);
    } catch (error) {
        logger.error('Search failed', { route: '/api/search', query, error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ videos: [], celebrities: [], movies: [] }, { status: 500 });
    }
}
