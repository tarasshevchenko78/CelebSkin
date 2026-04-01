import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocalizedField } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import {
    getCelebrityBySlug,
    celebrityNeedsEnrichment,
    getVideosForCelebrity,
    getMoviesForCelebrity,
    getSimilarCelebrities,
    getTagsForCelebrity,
} from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Video, Movie, Celebrity, Tag } from '@/lib/types';
import VideoCard from '@/components/VideoCard';
import JsonLd from '@/components/JsonLd';
import ExpandableText from '@/components/ExpandableText';
import CelebrityTabs from '@/components/CelebrityTabs';
import SafeImage from '@/components/SafeImage';
import FavoriteButton from '@/components/FavoriteButton';

// ============================================
// i18n
// ============================================

const topScenesLabel: Record<string, string> = {
    en: 'Top Scenes', ru: 'Лучшие сцены', de: 'Top-Szenen', fr: 'Meilleures scènes',
    es: 'Mejores escenas', pt: 'Melhores cenas', it: 'Scene migliori',
    pl: 'Najlepsze sceny', nl: 'Topscènes', tr: 'En İyi Sahneler',
};

const tagsLabel: Record<string, string> = {
    en: 'Tags', ru: 'Теги', de: 'Tags', fr: 'Tags',
    es: 'Etiquetas', pt: 'Tags', it: 'Tag',
    pl: 'Tagi', nl: 'Tags', tr: 'Etiketler',
};

const scenesWord: Record<string, string> = {
    en: 'scenes', ru: 'сцен', de: 'Szenen', fr: 'scènes',
    es: 'escenas', pt: 'cenas', it: 'scene',
    pl: 'scen', nl: 'scènes', tr: 'sahne',
};

const moviesWord: Record<string, string> = {
    en: 'movies', ru: 'фильмов', de: 'Filme', fr: 'films',
    es: 'películas', pt: 'filmes', it: 'film',
    pl: 'filmów', nl: 'films', tr: 'film',
};

// ============================================
// Metadata
// ============================================

export async function generateMetadata({
    params,
}: {
    params: { locale: string; slug: string };
}): Promise<Metadata> {
    let celeb;
    try {
        celeb = await getCelebrityBySlug(params.slug);
    } catch (error) {
        logger.error('Celebrity detail metadata DB error', { page: 'celebrity/detail', error: error instanceof Error ? error.message : String(error) });
    }
    const name = celeb ? celeb.name : 'Celebrity';
    const title = `${name} Nude Scenes — CelebSkin`;
    const description = celeb
        ? `Watch ${name}'s nude and sex scenes from movies and TV shows. HD quality clips on CelebSkin.`
        : undefined;
    const photoUrl = celeb?.photo_url || null;

    // noindex only if 0 videos (thin content)
    const noindex = celeb ? celebrityNeedsEnrichment(celeb) : false;

    return {
        title,
        description,
        ...(noindex && { robots: { index: false, follow: true } }),
        alternates: buildAlternates(params.locale, `/celebrity/${params.slug}`),
        openGraph: {
            title,
            description,
            type: 'profile',
            url: `https://celeb.skin/${params.locale}/celebrity/${params.slug}`,
            siteName: 'CelebSkin',
            ...(photoUrl && { images: [{ url: photoUrl, width: 400, height: 600, alt: name }] }),
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            ...(photoUrl && { images: [photoUrl] }),
        },
    };
}

// ============================================
// Page
// ============================================

export default async function CelebrityDetailPage({
    params,
}: {
    params: { locale: string; slug: string };
}) {
    const locale = params.locale;

    let celeb: Celebrity | null | undefined;
    try {
        celeb = await getCelebrityBySlug(params.slug);
    } catch (error) {
        logger.error('Celebrity detail DB error', { page: 'celebrity/detail', error: error instanceof Error ? error.message : String(error) });
    }

    if (!celeb) {
        notFound();
    }

    const name = getLocalizedField(celeb.name_localized, locale) || celeb.name;
    const bio = getLocalizedField(celeb.bio, locale);

    // Fetch all data in parallel
    let videos: Video[] = [];
    let celebMovies: Movie[] = [];
    let similarCelebs: Celebrity[] = [];
    let celebTags: Tag[] = [];

    try {
        const [videosResult, moviesResult, similarResult, tagsResult] = await Promise.all([
            getVideosForCelebrity(celeb.id, 1, 100),
            getMoviesForCelebrity(celeb.id),
            getSimilarCelebrities(celeb.id, 12),
            getTagsForCelebrity(celeb.id, 20),
        ]);
        videos = videosResult.data;
        celebMovies = moviesResult;
        similarCelebs = similarResult;
        celebTags = tagsResult;
    } catch (error) {
        logger.error('Celebrity detail relations error', { page: 'celebrity/detail', error: error instanceof Error ? error.message : String(error) });
    }

    // Top scenes: top 4 by views
    const topScenes = [...videos]
        .sort((a, b) => (b.views_count || 0) - (a.views_count || 0))
        .slice(0, 4);
    const showTopScenes = videos.length > 4;

    // "New" label: all videos added in last 14 days
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const isNewCeleb = videos.length > 0 && videos.every(v =>
        new Date(v.created_at).getTime() > fourteenDaysAgo
    );

    // JSON-LD
    const personLd = {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: celeb.name,
        url: `https://celeb.skin/${locale}/celebrity/${celeb.slug}`,
        ...(celeb.photo_url && { image: celeb.photo_url }),
        ...(celeb.birth_date && { birthDate: celeb.birth_date }),
        ...(celeb.nationality && { nationality: celeb.nationality }),
    };

    // Birth year
    const birthYear = celeb.birth_date ? new Date(celeb.birth_date).getFullYear() : null;

    return (
        <div className="mx-auto max-w-6xl px-4 py-4 md:py-6">
            <JsonLd data={personLd} />

            {/* Breadcrumbs */}
            <nav className="mb-4 text-sm text-brand-muted" aria-label="Breadcrumb">
                <ol className="flex flex-wrap items-center gap-1">
                    <li><a href={`/${locale}`} className="hover:text-brand-accent transition-colors">Home</a></li>
                    <li className="text-brand-border">/</li>
                    <li><a href={`/${locale}/celebrity`} className="hover:text-brand-accent transition-colors">{locale === 'ru' ? 'Знаменитости' : 'Celebrities'}</a></li>
                    <li className="text-brand-border">/</li>
                    <li className="text-brand-text">{name}</li>
                </ol>
            </nav>

            {/* ── 1. HERO SECTION ── */}
            <div className="flex flex-col items-center md:items-start md:flex-row gap-5 md:gap-6">
                {/* Photo */}
                <div className="w-32 h-32 md:w-40 md:h-40 rounded-2xl overflow-hidden border-2 border-gray-800 shrink-0 bg-gray-800">
                    {(celeb.photo_url || videos[0]?.thumbnail_url) ? (
                        <SafeImage
                            src={celeb.photo_url || videos[0]?.thumbnail_url || ''}
                            alt={name}
                            loading="eager"
                            className="w-full h-full object-cover"
                            fallback={
                                <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-700 flex items-center justify-center">
                                    <span className="text-3xl md:text-4xl font-bold text-gray-500">
                                        {celeb.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                                    </span>
                                </div>
                            }
                        />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-700 flex items-center justify-center">
                            <span className="text-3xl md:text-4xl font-bold text-gray-500">
                                {celeb.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                            </span>
                        </div>
                    )}
                </div>

                {/* Info */}
                <div className="text-center md:text-left flex-1">
                    <div className="flex items-center justify-center md:justify-start gap-2 flex-wrap">
                        <h1 className="text-2xl md:text-3xl font-bold text-white">{name}</h1>
                        {isNewCeleb && (
                            <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                                NEW
                            </span>
                        )}
                        <FavoriteButton itemType="celebrity" itemId={String(celeb.id)} compact />
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center justify-center md:justify-start gap-4 text-sm text-gray-400 mt-2 flex-wrap">
                        {celeb.videos_count > 0 && (
                            <span>{celeb.videos_count} {scenesWord[locale] || scenesWord.en}</span>
                        )}
                        {celeb.movies_count > 0 && (
                            <span>{celeb.movies_count} {moviesWord[locale] || moviesWord.en}</span>
                        )}
                        {celeb.nationality && <span>{celeb.nationality}</span>}
                        {birthYear && <span>{birthYear}</span>}
                    </div>

                    {/* Bio */}
                    {bio && (
                        <div className="mt-3 max-w-2xl">
                            <ExpandableText text={bio} />
                        </div>
                    )}
                </div>
            </div>

            {/* ── 2. TOP SCENES ── */}
            {showTopScenes && (
                <section className="mt-6 pt-6 border-t border-gray-800/50">
                    <h2 className="text-lg font-semibold text-white mb-3">
                        {topScenesLabel[locale] || topScenesLabel.en}
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {topScenes.map((v) => (
                            <VideoCard key={v.id} video={v} locale={locale} />
                        ))}
                    </div>
                </section>
            )}

            {/* ── 2b. FILMOGRAPHY (SSR for SEO) ── */}
            {celebMovies.length > 0 && (
                <nav className="mt-6 pt-6 border-t border-gray-800/50" aria-label="Filmography">
                    <h2 className="text-lg font-semibold text-white mb-3">
                        {locale === 'ru' ? 'Фильмография' : 'Filmography'}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {celebMovies.map((m) => {
                            const mTitle = getLocalizedField(m.title_localized, locale) || m.title;
                            return (
                                <a
                                    key={m.id}
                                    href={`/${locale}/movie/${m.slug}`}
                                    className="px-3 py-1.5 rounded-lg text-sm bg-gray-800/40 text-gray-300 border border-gray-700 hover:border-gray-500 hover:text-white transition-colors"
                                >
                                    {mTitle}{m.year ? ` (${m.year})` : ''}
                                </a>
                            );
                        })}
                    </div>
                </nav>
            )}

            {/* ── 3. TABS ── */}
            <section className="mt-6 pt-6 border-t border-gray-800/50">
                <CelebrityTabs
                    locale={locale}
                    videos={videos}
                    movies={celebMovies}
                    similarCelebrities={similarCelebs}
                />
            </section>

            {/* ── 4. TAGS ── */}
            {celebTags.length > 0 && (
                <section className="mt-6 pt-6 border-t border-gray-800/50">
                    <h2 className="text-lg font-semibold text-white mb-3">
                        {tagsLabel[locale] || tagsLabel.en}
                    </h2>
                    <div className="flex flex-wrap gap-1.5">
                        {celebTags.map((tag) => {
                            const tagName = getLocalizedField(tag.name_localized, locale) || tag.name;
                            return (
                                <a
                                    key={tag.id}
                                    href={`/${locale}/tag/${tag.slug}`}
                                    className="px-2.5 py-1 rounded-full text-xs bg-gray-800/50 text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-300 transition-colors"
                                >
                                    {tagName}
                                </a>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}
