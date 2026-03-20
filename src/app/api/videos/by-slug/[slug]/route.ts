import { NextRequest, NextResponse } from 'next/server';
import { getVideoBySlug } from '@/lib/db';
import { getAdjacentVideos } from '@/lib/db/videos';
import { getLocalizedSlug } from '@/lib/i18n';

export async function GET(
    req: NextRequest,
    { params }: { params: { slug: string } }
) {
    const locale = req.nextUrl.searchParams.get('locale') || 'en';
    const { slug } = params;

    try {
        const video = await getVideoBySlug(slug, locale);
        if (!video) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const adjacent = video.published_at
            ? await getAdjacentVideos(video.published_at, locale)
            : { prevSlug: null, nextSlug: null };

        return NextResponse.json({
            video_url: video.video_url || null,
            poster: video.thumbnail_url || null,
            title: video.title,
            duration_seconds: video.duration_seconds || null,
            screenshots: video.screenshots || [],
            hot_moments: video.hot_moments || [],
            slug: getLocalizedSlug(video.slug, locale),
            published_at: video.published_at,
            prevSlug: adjacent.prevSlug,
            nextSlug: adjacent.nextSlug,
        });
    } catch {
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
