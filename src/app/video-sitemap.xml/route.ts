import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { publicConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const SITE_URL = publicConfig.siteUrl;
const LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];

interface VideoRow {
    slug: Record<string, string>;
    title: Record<string, string>;
    seo_description: Record<string, string> | null;
    thumbnail_url: string | null;
    video_url_watermarked: string | null;
    video_url: string | null;
    duration_seconds: number | null;
    published_at: string | null;
}

function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}


export async function GET() {
    try {
        const { rows } = await pool.query<VideoRow>(
            `SELECT slug, title, seo_description, thumbnail_url,
                    video_url_watermarked, video_url,
                    duration_seconds, published_at
             FROM videos
             WHERE status = 'published'
               AND thumbnail_url IS NOT NULL
             ORDER BY published_at DESC
             LIMIT 10000`
        );

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
`;

        for (const video of rows) {
            for (const locale of LOCALES) {
                const localizedSlug = video.slug['en'] || video.slug[locale];
                if (!localizedSlug) continue;

                const title = video.title[locale] || video.title['en'] || '';
                const description = video.seo_description?.[locale]
                    || video.seo_description?.['en']
                    || title
                    || '';
                const contentUrl = video.video_url_watermarked || video.video_url || '';
                const thumbnailUrl = video.thumbnail_url || '';

                if (!title || !thumbnailUrl) continue;

                xml += `  <url>
    <loc>${escapeXml(`${SITE_URL}/${locale}/video/${localizedSlug}`)}</loc>
    <video:video>
      <video:thumbnail_loc>${escapeXml(thumbnailUrl)}</video:thumbnail_loc>
      <video:title>${escapeXml(title)}</video:title>
      <video:description>${escapeXml(description.slice(0, 2048))}</video:description>
`;

                if (contentUrl) {
                    xml += `      <video:content_loc>${escapeXml(contentUrl)}</video:content_loc>\n`;
                }

                if (video.duration_seconds && video.duration_seconds > 0) {
                    xml += `      <video:duration>${video.duration_seconds}</video:duration>\n`;
                }

                if (video.published_at) {
                    xml += `      <video:publication_date>${new Date(video.published_at).toISOString()}</video:publication_date>\n`;
                }

                xml += `      <video:family_friendly>no</video:family_friendly>
    </video:video>
  </url>
`;
            }
        }

        xml += `</urlset>`;

        return new NextResponse(xml, {
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 'public, max-age=3600, s-maxage=3600',
            },
        });
    } catch (error) {
        logger.error('Video sitemap generation error', {
            error: error instanceof Error ? error.message : String(error),
        });
        // Return minimal valid sitemap on error
        return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
</urlset>`,
            {
                headers: {
                    'Content-Type': 'application/xml; charset=utf-8',
                },
            }
        );
    }
}
