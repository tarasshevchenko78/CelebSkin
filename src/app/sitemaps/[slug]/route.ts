/**
 * Dynamic child sitemaps
 * /sitemaps/en-videos.xml → videos for EN locale
 * /sitemaps/en-celebrities.xml → celebrities for EN locale
 * /sitemaps/en-movies.xml → movies for EN locale
 * /sitemaps/en-collections.xml → collections for EN locale
 * /sitemaps/en-tags.xml → tags with 10+ videos for EN locale
 * /sitemaps/en-static.xml → static pages for EN locale
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const SITE_URL = 'https://celeb.skin';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(loc: string, lastmod: string, changefreq: string, priority: string): string {
  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

interface SlugRow {
  slug: string | Record<string, string>;
  updated_at: string | Date | null;
}

async function generateVideosSitemap(lang: string): Promise<string[]> {
  const { rows } = await pool.query<SlugRow>(
    `SELECT slug, updated_at FROM videos WHERE status = 'published' ORDER BY published_at DESC NULLS LAST`
  );
  return rows.map(r => {
    const slug = typeof r.slug === 'object' ? (r.slug[lang] || r.slug['en']) : r.slug;
    const lastmod = r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    return urlEntry(`${SITE_URL}/${lang}/video/${slug}`, lastmod, 'weekly', '0.6');
  });
}

async function generateCelebritiesSitemap(lang: string): Promise<string[]> {
  const { rows } = await pool.query<SlugRow>(
    `SELECT slug, updated_at FROM celebrities WHERE status = 'published' ORDER BY updated_at DESC NULLS LAST`
  );
  return rows.map(r => {
    const slug = typeof r.slug === 'string' ? r.slug : r.slug['en'];
    const lastmod = r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    return urlEntry(`${SITE_URL}/${lang}/celebrity/${slug}`, lastmod, 'weekly', '0.7');
  });
}

async function generateMoviesSitemap(lang: string): Promise<string[]> {
  const { rows } = await pool.query<SlugRow>(
    `SELECT slug, updated_at FROM movies WHERE status = 'published' ORDER BY updated_at DESC NULLS LAST`
  );
  return rows.map(r => {
    const slug = typeof r.slug === 'string' ? r.slug : r.slug['en'];
    const lastmod = r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    return urlEntry(`${SITE_URL}/${lang}/movie/${slug}`, lastmod, 'monthly', '0.5');
  });
}

async function generateCollectionsSitemap(lang: string): Promise<string[]> {
  const { rows } = await pool.query<SlugRow>(
    `SELECT slug, updated_at FROM collections WHERE videos_count > 0 ORDER BY sort_order`
  );
  return rows.map(r => {
    const slug = typeof r.slug === 'string' ? r.slug : r.slug['en'];
    const lastmod = r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    return urlEntry(`${SITE_URL}/${lang}/collection/${slug}`, lastmod, 'weekly', '0.6');
  });
}

async function generateTagsSitemap(lang: string): Promise<string[]> {
  const { rows } = await pool.query<SlugRow>(
    `SELECT slug, NULL AS updated_at FROM tags WHERE is_canonical = true AND videos_count >= 10`
  );
  return rows.map(r => {
    const slug = typeof r.slug === 'string' ? r.slug : r.slug['en'];
    return urlEntry(`${SITE_URL}/${lang}/tag/${slug}`, new Date().toISOString().split('T')[0], 'weekly', '0.5');
  });
}

function generateStaticSitemap(lang: string): string[] {
  const now = new Date().toISOString().split('T')[0];
  const pages = [
    { path: '', changefreq: 'daily', priority: '1.0' },
    { path: '/video', changefreq: 'daily', priority: '0.9' },
    { path: '/celebrity', changefreq: 'weekly', priority: '0.8' },
    { path: '/movie', changefreq: 'weekly', priority: '0.8' },
    { path: '/collection', changefreq: 'weekly', priority: '0.7' },
  ];
  return pages.map(p => urlEntry(`${SITE_URL}/${lang}${p.path}`, now, p.changefreq, p.priority));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    // Parse: en-videos.xml → lang=en, type=videos
    const match = slug.match(/^([a-z]{2})-(\w+)\.xml$/);
    if (!match) {
      return new NextResponse('Not Found', { status: 404 });
    }

    const [, lang, type] = match;
    let entries: string[];

    switch (type) {
      case 'videos':
        entries = await generateVideosSitemap(lang);
        break;
      case 'celebrities':
        entries = await generateCelebritiesSitemap(lang);
        break;
      case 'movies':
        entries = await generateMoviesSitemap(lang);
        break;
      case 'collections':
        entries = await generateCollectionsSitemap(lang);
        break;
      case 'tags':
        entries = await generateTagsSitemap(lang);
        break;
      case 'static':
        entries = generateStaticSitemap(lang);
        break;
      default:
        return new NextResponse('Not Found', { status: 404 });
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;

    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (error) {
    logger.error('Sitemap generation error', { error: error instanceof Error ? error.message : String(error) });
    const emptyXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>`;
    return new NextResponse(emptyXml, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      status: 500,
    });
  }
}
