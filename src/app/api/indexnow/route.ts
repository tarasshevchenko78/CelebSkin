/**
 * IndexNow verification endpoint
 * Serves the API key as a text file at /api/indexnow?key=xxx
 * Also handles batch URL submission from admin
 */

import { NextRequest, NextResponse } from 'next/server';

// GET /api/indexnow?key=xxx — verification file
export async function GET(request: NextRequest) {
    const key = request.nextUrl.searchParams.get('key');
    const envKey = process.env.INDEXNOW_KEY || '';

    if (!key || !envKey || key !== envKey) {
        return new NextResponse('Not found', { status: 404 });
    }

    return new NextResponse(envKey, {
        headers: { 'Content-Type': 'text/plain' },
    });
}
