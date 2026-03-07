import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const doCheck = req.nextUrl.searchParams.get('check') === 'true';

    // Get all published videos
    const { rows: videos } = await pool.query(`
        SELECT id,
               COALESCE(title->>'en', id::text) as title,
               video_url,
               video_url_watermarked,
               thumbnail_url,
               sprite_url,
               preview_gif_url
        FROM videos
        WHERE status = 'published'
        ORDER BY published_at DESC
    `);

    if (!doCheck) {
        // Just return video list for the test page
        return NextResponse.json({
            total: videos.length,
            videos: videos.map(v => ({
                id: v.id,
                title: v.title,
                video_url: v.video_url_watermarked || v.video_url,
                thumb: v.thumbnail_url,
            })),
        });
    }

    // Full server-side check: HEAD request each URL
    const results: Array<{
        id: string;
        title: string;
        checks: Record<string, { status: number | string; contentType?: string; size?: string; ok: boolean }>;
    }> = [];

    for (const v of videos) {
        const checks: Record<string, { status: number | string; contentType?: string; size?: string; ok: boolean }> = {};

        const urls: Record<string, string | null> = {
            video: v.video_url_watermarked || v.video_url,
            thumbnail: v.thumbnail_url,
            sprite: v.sprite_url,
            gif: v.preview_gif_url,
        };

        for (const [name, url] of Object.entries(urls)) {
            if (!url) {
                checks[name] = { status: 'missing', ok: false };
                continue;
            }

            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                const res = await fetch(url, {
                    method: 'HEAD',
                    signal: controller.signal,
                });
                clearTimeout(timeout);

                const contentType = res.headers.get('content-type') || '';
                const contentLength = res.headers.get('content-length') || '0';
                const cors = res.headers.get('access-control-allow-origin') || '';
                const acceptRanges = res.headers.get('accept-ranges') || '';

                const sizeKB = Math.round(parseInt(contentLength) / 1024);
                const sizeStr = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)}MB` : `${sizeKB}KB`;

                checks[name] = {
                    status: res.status,
                    contentType,
                    size: sizeStr,
                    ok: res.status === 200,
                    ...(name === 'video' ? { cors, acceptRanges } : {}),
                } as typeof checks[string];
            } catch (err: unknown) {
                const e = err as Error;
                checks[name] = {
                    status: e.name === 'AbortError' ? 'timeout' : e.message,
                    ok: false,
                };
            }
        }

        results.push({ id: v.id, title: v.title, checks });
    }

    const totalOk = results.filter(r =>
        Object.values(r.checks).every(c => c.ok)
    ).length;

    return NextResponse.json({
        total: results.length,
        allOk: totalOk,
        issues: results.length - totalOk,
        results,
    });
}
