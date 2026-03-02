import { NextRequest, NextResponse } from 'next/server';
import { searchAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const query = request.nextUrl.searchParams.get('q') || '';
    if (query.length < 2) {
        return NextResponse.json({ videos: [], celebrities: [], movies: [] });
    }
    try {
        const results = await searchAll(query, 10);
        return NextResponse.json(results);
    } catch (error) {
        console.error('[Search API] error:', error);
        return NextResponse.json({ videos: [], celebrities: [], movies: [] }, { status: 500 });
    }
}
