import { MetadataRoute } from 'next';
import { pool } from '@/lib/db';
import { publicConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const SITE_URL = publicConfig.siteUrl;
const LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];

interface VideoSlugRow {
  slug: Record<string, string>;
  updated_at: string | Date | null;
}

interface SimpleSlugRow {
  slug: string;
  updated_at: string | Date | null;
}

function buildLocalizedEntries(
  basePath: string,
  lastModified: Date,
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'],
  priority: number
): MetadataRoute.Sitemap {
  return LOCALES.map((locale) => ({
    url: `${SITE_URL}/${locale}${basePath}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}

function getStaticEntries(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: {
    path: string;
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
    priority: number;
  }[] = [
    { path: '', changeFrequency: 'daily', priority: 1.0 },
    { path: '/video', changeFrequency: 'daily', priority: 0.9 },
    { path: '/celebrity', changeFrequency: 'weekly', priority: 0.8 },
    { path: '/movie', changeFrequency: 'weekly', priority: 0.8 },
    { path: '/blog', changeFrequency: 'weekly', priority: 0.7 },
    { path: '/collection', changeFrequency: 'weekly', priority: 0.7 },
  ];

  return staticPages.flatMap((page) =>
    buildLocalizedEntries(page.path, now, page.changeFrequency, page.priority)
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries = getStaticEntries();

  try {
    const [videosResult, celebritiesResult, moviesResult, blogResult, collectionsResult, tagsResult] = await Promise.all([
      pool.query<VideoSlugRow>(
        `SELECT slug, updated_at FROM videos WHERE status = 'published' ORDER BY published_at DESC LIMIT 10000`
      ),
      pool.query<SimpleSlugRow>(
        `SELECT slug, updated_at FROM celebrities WHERE status = 'published' LIMIT 5000`
      ),
      pool.query<SimpleSlugRow>(
        `SELECT slug, updated_at FROM movies WHERE status = 'published' LIMIT 5000`
      ),
      pool.query<SimpleSlugRow>(
        `SELECT slug, published_at AS updated_at FROM blog_posts WHERE is_published = true ORDER BY published_at DESC LIMIT 1000`
      ),
      pool.query<SimpleSlugRow>(
        `SELECT slug, updated_at FROM collections WHERE videos_count > 0 ORDER BY sort_order LIMIT 500`
      ),
      pool.query<SimpleSlugRow>(
        `SELECT slug, NULL AS updated_at FROM tags LIMIT 1000`
      ),
    ]);

    const videoEntries: MetadataRoute.Sitemap = videosResult.rows.flatMap(
      (video) =>
        LOCALES.map((locale) => {
          const localizedSlug = video.slug[locale] || video.slug['en'];
          return {
            url: `${SITE_URL}/${locale}/video/${localizedSlug}`,
            lastModified: video.updated_at
              ? new Date(video.updated_at)
              : new Date(),
            changeFrequency: 'weekly' as const,
            priority: 0.6,
          };
        })
    );

    const celebrityEntries: MetadataRoute.Sitemap =
      celebritiesResult.rows.flatMap((celebrity) =>
        LOCALES.map((locale) => ({
          url: `${SITE_URL}/${locale}/celebrity/${celebrity.slug}`,
          lastModified: celebrity.updated_at
            ? new Date(celebrity.updated_at)
            : new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        }))
      );

    const movieEntries: MetadataRoute.Sitemap = moviesResult.rows.flatMap(
      (movie) =>
        LOCALES.map((locale) => ({
          url: `${SITE_URL}/${locale}/movie/${movie.slug}`,
          lastModified: movie.updated_at
            ? new Date(movie.updated_at)
            : new Date(),
          changeFrequency: 'monthly' as const,
          priority: 0.5,
        }))
    );

    const blogEntries: MetadataRoute.Sitemap = blogResult.rows.flatMap(
      (post) =>
        LOCALES.map((locale) => ({
          url: `${SITE_URL}/${locale}/blog/${post.slug}`,
          lastModified: post.updated_at
            ? new Date(post.updated_at)
            : new Date(),
          changeFrequency: 'monthly' as const,
          priority: 0.5,
        }))
    );

    const collectionEntries: MetadataRoute.Sitemap = collectionsResult.rows.flatMap(
      (collection) =>
        LOCALES.map((locale) => ({
          url: `${SITE_URL}/${locale}/collection/${collection.slug}`,
          lastModified: collection.updated_at
            ? new Date(collection.updated_at)
            : new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        }))
    );

    const tagEntries: MetadataRoute.Sitemap = tagsResult.rows.flatMap(
      (tag) =>
        LOCALES.map((locale) => ({
          url: `${SITE_URL}/${locale}/tag/${tag.slug}`,
          lastModified: new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.5,
        }))
    );

    return [
      ...staticEntries,
      ...videoEntries,
      ...celebrityEntries,
      ...movieEntries,
      ...blogEntries,
      ...collectionEntries,
      ...tagEntries,
    ];
  } catch (error) {
    logger.error('Sitemap generation error', { error: error instanceof Error ? error.message : String(error) });
    return staticEntries;
  }
}
