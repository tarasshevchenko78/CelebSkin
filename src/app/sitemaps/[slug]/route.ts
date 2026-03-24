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

const VIDEOS_PER_SITEMAP = 3000;
const LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];

interface VideoSitemapRow {
  slug: Record<string, string>;
  title: Record<string, string>;
  seo_description: Record<string, string> | null;
  thumbnail_url: string | null;
  video_url_watermarked: string | null;
  video_url: string | null;
  duration_seconds: number | null;
  published_at: string | null;
}

async function generateVideoSitemapPage(page: number): Promise<string> {
  const offset = (page - 1) * VIDEOS_PER_SITEMAP;
  const { rows } = await pool.query<VideoSitemapRow>(
    `SELECT slug, title, seo_description, thumbnail_url,
            video_url_watermarked, video_url,
            duration_seconds, published_at
     FROM videos
     WHERE status = 'published'
       AND thumbnail_url IS NOT NULL
     ORDER BY published_at DESC
     LIMIT $1 OFFSET $2`,
    [VIDEOS_PER_SITEMAP, offset]
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
  return xml;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;

    // Handle video-sitemap-N.xml
    const videoMatch = slug.match(/^video-sitemap-(\d+)\.xml$/);
    if (videoMatch) {
      const page = parseInt(videoMatch[1]);
      if (page < 1) return new NextResponse('Not Found', { status: 404 });
      const xml = await generateVideoSitemapPage(page);
      return new NextResponse(xml, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      });
    }

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
