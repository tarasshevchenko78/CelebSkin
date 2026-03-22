/**
 * Sitemap Index — points to child sitemaps
 * Start with EN only. Expand SITEMAP_LANGUAGES to add more locales.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SITE_URL = 'https://celeb.skin';

// Control which languages are in the sitemap index
// Start with EN only to focus crawl budget. Add more later: ['en', 'ru', 'de', ...]
const SITEMAP_LANGUAGES = ['en'];

const SITEMAP_TYPES = ['videos', 'celebrities', 'movies', 'collections', 'tags', 'static'];

export async function GET() {
  const now = new Date().toISOString();

  const entries = SITEMAP_LANGUAGES.flatMap(lang =>
    SITEMAP_TYPES.map(type =>
      `  <sitemap>
    <loc>${SITE_URL}/sitemaps/${lang}-${type}.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`
    )
  );

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
