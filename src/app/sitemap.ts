import { MetadataRoute } from 'next';
import { pool } from '@/lib/db';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://celeb.skin';
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
  ];

  return staticPages.flatMap((page) =>
    buildLocalizedEntries(page.path, now, page.changeFrequency, page.priority)
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries = getStaticEntries();

  try {
    const [videosResult, celebritiesResult, moviesResult] = await Promise.all([
      pool.query<VideoSlugRow>(
        `SELECT slug, updated_at FROM videos WHERE status = 'published' ORDER BY published_at DESC LIMIT 10000`
      ),
      pool.query<SimpleSlugRow>(
        `SELECT slug, updated_at FROM celebrities LIMIT 5000`
      ),
      pool.query<SimpleSlugRow>(
        `SELECT slug, updated_at FROM movies LIMIT 5000`
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

    return [
      ...staticEntries,
      ...videoEntries,
      ...celebrityEntries,
      ...movieEntries,
    ];
  } catch (error) {
    console.error('Sitemap generation error:', error);
    return staticEntries;
  }
}
