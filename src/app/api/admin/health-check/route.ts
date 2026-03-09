import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface CheckResult {
    video_id: string;
    title: string;
    slug: string;
    status: string;
    checks: {
        video_url: { url: string | null; status: number | null; ok: boolean; error?: string; content_type?: string; size?: number };
        video_url_watermarked: { url: string | null; status: number | null; ok: boolean; error?: string; content_type?: string; size?: number };
        thumbnail_url: { url: string | null; status: number | null; ok: boolean; error?: string; content_type?: string; size?: number };
        sprite_url: { url: string | null; status: number | null; ok: boolean; error?: string };
        preview_gif_url: { url: string | null; status: number | null; ok: boolean; error?: string };
    };
    playable: boolean;
    issues: string[];
}

async function checkUrl(url: string | null): Promise<{ status: number | null; ok: boolean; error?: string; content_type?: string; size?: number }> {
    if (!url) return { status: null, ok: false, error: 'URL is null' };
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
        clearTimeout(timeout);
        const ct = res.headers.get('content-type') || undefined;
        const cl = res.headers.get('content-length');
        return {
            status: res.status,
            ok: res.status >= 200 && res.status < 400,
            content_type: ct,
            size: cl ? parseInt(cl) : undefined,
        };
    } catch (err: unknown) {
        return { status: null, ok: false, error: String(err && typeof err === 'object' && 'message' in err ? err.message : err) };
    }
}

export async function GET() {
    try {
        const { rows: videos } = await pool.query(`
            SELECT id, title->>'en' as title, slug->>'en' as slug, status,
                   video_url, video_url_watermarked, thumbnail_url,
                   sprite_url, preview_gif_url,
                   screenshots
            FROM videos
            WHERE status = 'published'
            ORDER BY published_at DESC
        `);

        const results: CheckResult[] = [];
        let totalOk = 0;
        let totalBroken = 0;

        // Process in batches of 5 to avoid overwhelming
        for (let i = 0; i < videos.length; i += 5) {
            const batch = videos.slice(i, i + 5);
            const batchResults = await Promise.all(batch.map(async (v: Record<string, unknown>) => {
                const [videoCheck, wmCheck, thumbCheck, spriteCheck, gifCheck] = await Promise.all([
                    checkUrl(v.video_url as string | null),
                    checkUrl(v.video_url_watermarked as string | null),
                    checkUrl(v.thumbnail_url as string | null),
                    checkUrl(v.sprite_url as string | null),
                    checkUrl(v.preview_gif_url as string | null),
                ]);

                const issues: string[] = [];

                // Check video playability
                const videoSrc = v.video_url_watermarked || v.video_url;
                if (!videoSrc) issues.push('No video URL at all');
                if (v.video_url_watermarked && !wmCheck.ok) issues.push(`Watermarked video not accessible: ${wmCheck.status || wmCheck.error}`);
                if (v.video_url && !videoCheck.ok) issues.push(`Video URL not accessible: ${videoCheck.status || videoCheck.error}`);
                if (wmCheck.ok && wmCheck.content_type && !wmCheck.content_type.startsWith('video/')) issues.push(`Wrong content-type for video: ${wmCheck.content_type}`);
                if (wmCheck.ok && wmCheck.size && wmCheck.size < 1000) issues.push(`Video file suspiciously small: ${wmCheck.size} bytes`);
                if (!thumbCheck.ok) issues.push(`Thumbnail not accessible: ${thumbCheck.status || thumbCheck.error}`);
                if (!spriteCheck.ok) issues.push(`Sprite not accessible`);
                if (!gifCheck.ok) issues.push(`Preview GIF not accessible`);

                // Check for non-CDN URLs
                if (v.video_url && typeof v.video_url === 'string' && !v.video_url.includes('b-cdn.net')) issues.push(`video_url is not CDN: ${(v.video_url as string).substring(0, 60)}`);
                if (v.thumbnail_url && typeof v.thumbnail_url === 'string' && !v.thumbnail_url.includes('b-cdn.net')) issues.push(`thumbnail is not CDN: ${(v.thumbnail_url as string).substring(0, 60)}`);

                const playable = (wmCheck.ok || videoCheck.ok) && thumbCheck.ok;

                return {
                    video_id: v.id as string,
                    title: (v.title as string) || 'Unknown',
                    slug: (v.slug as string) || '',
                    status: v.status as string,
                    checks: {
                        video_url: { url: v.video_url as string | null, ...videoCheck },
                        video_url_watermarked: { url: v.video_url_watermarked as string | null, ...wmCheck },
                        thumbnail_url: { url: v.thumbnail_url as string | null, ...thumbCheck },
                        sprite_url: { url: v.sprite_url as string | null, ...spriteCheck },
                        preview_gif_url: { url: v.preview_gif_url as string | null, ...gifCheck },
                    },
                    playable,
                    issues,
                };
            }));

            for (const r of batchResults) {
                results.push(r);
                if (r.playable) totalOk++;
                else totalBroken++;
            }
        }

        return NextResponse.json({
            summary: {
                total: videos.length,
                playable: totalOk,
                broken: totalBroken,
                timestamp: new Date().toISOString(),
            },
            broken: results.filter(r => !r.playable),
            all: results,
        });
    } catch (err: unknown) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
