/**
 * Sitemap Index — points to child sitemaps including paginated video sitemaps
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

const SITE_URL = 'https://celeb.skin';
const SITEMAP_LANGUAGES = ['en'];
const SITEMAP_TYPES = ['videos', 'celebrities', 'movies', 'collections', 'tags', 'static'];
const VIDEOS_PER_SITEMAP = 3000;

export async function GET() {
    const now = new Date().toISOString();

    // Standard sitemaps (lang-type)
    const entries = SITEMAP_LANGUAGES.flatMap(lang =>
        SITEMAP_TYPES.map(type =>
            `  <sitemap>
    <loc>${SITE_URL}/sitemaps/${lang}-${type}.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`
        )
    );

    // Paginated video sitemaps (with video:video tags for Google)
    try {
        const { rows } = await pool.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM videos WHERE status = 'published' AND thumbnail_url IS NOT NULL`
        );
        const totalVideos = rows[0]?.count || 0;
        const totalPages = Math.max(1, Math.ceil(totalVideos / VIDEOS_PER_SITEMAP));

        for (let i = 1; i <= totalPages; i++) {
            entries.push(`  <sitemap>
    <loc>${SITE_URL}/sitemaps/video-sitemap-${i}.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`);
        }
    } catch {
        // Fallback: at least one video sitemap
        entries.push(`  <sitemap>
    <loc>${SITE_URL}/sitemaps/video-sitemap-1.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</sitemapindex>`;

    return new NextResponse(xml, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
    });
}
