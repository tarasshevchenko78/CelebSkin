import type { Metadata } from 'next';
import { getLocalizedField } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import {
    getMovieBySlug,
    getVideosForMovie,
    getCelebritiesForMovie,
    getSimilarMovies,
} from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Video, Celebrity, Movie } from '@/lib/types';
import VideoCard from '@/components/VideoCard';
import JsonLd from '@/components/JsonLd';
import ExpandableText from '@/components/ExpandableText';
import SafeImage from '@/components/SafeImage';

// ============================================
// i18n
// ============================================

const scenesLabel: Record<string, string> = {
    en: 'Scenes', ru: 'Сцены', de: 'Szenen', fr: 'Scènes',
    es: 'Escenas', pt: 'Cenas', it: 'Scene',
    pl: 'Sceny', nl: 'Scènes', tr: 'Sahneler',
};

const castLabel: Record<string, string> = {
    en: 'Cast', ru: 'Актёры', de: 'Besetzung', fr: 'Distribution',
    es: 'Reparto', pt: 'Elenco', it: 'Cast',
    pl: 'Obsada', nl: 'Cast', tr: 'Oyuncular',
};

const similarLabel: Record<string, string> = {
    en: 'Similar Movies', ru: 'Похожие фильмы', de: 'Ähnliche Filme', fr: 'Films similaires',
    es: 'Películas similares', pt: 'Filmes semelhantes', it: 'Film simili',
    pl: 'Podobne filmy', nl: 'Vergelijkbare films', tr: 'Benzer Filmler',
};

const directedByLabel: Record<string, string> = {
    en: 'Directed by', ru: 'Режиссёр:', de: 'Regie:', fr: 'Réalisé par',
    es: 'Dirigida por', pt: 'Dirigido por', it: 'Diretto da',
    pl: 'Reżyseria:', nl: 'Regie:', tr: 'Yönetmen:',
};

const scenesWord: Record<string, string> = {
    en: 'scenes', ru: 'сцен', de: 'Szenen', fr: 'scènes',
    es: 'escenas', pt: 'cenas', it: 'scene',
    pl: 'scen', nl: 'scènes', tr: 'sahne',
};

const celebritiesWord: Record<string, string> = {
    en: 'celebrities', ru: 'актрис', de: 'Stars', fr: 'célébrités',
    es: 'celebridades', pt: 'celebridades', it: 'celebrità',
    pl: 'gwiazd', nl: 'beroemdheden', tr: 'ünlü',
};

// ============================================
// Metadata
// ============================================

export async function generateMetadata({ params }: { params: { locale: string; slug: string } }): Promise<Metadata> {
    let movie;
    try {
        movie = await getMovieBySlug(params.slug);
    } catch (error) {
        logger.error('Movie detail metadata DB error', { page: 'movie/detail', error: error instanceof Error ? error.message : String(error) });
    }
    const title = movie ? `${getLocalizedField(movie.title_localized, params.locale) || movie.title} Nude Scenes` : 'Movie';
    return {
        title: `${title} — CelebSkin`,
        alternates: buildAlternates(params.locale, `/movie/${params.slug}`),
    };
}

// ============================================
// Page
// ============================================

export default async function MovieDetailPage({ params }: { params: { locale: string; slug: string } }) {
    const locale = params.locale;

    let movie;
    try {
        movie = await getMovieBySlug(params.slug);
    } catch (error) {
        logger.error('Movie detail DB error', { page: 'movie/detail', error: error instanceof Error ? error.message : String(error) });
    }

    if (!movie) {
        return (
            <div className="mx-auto max-w-6xl px-4 py-20 text-center">
                <h1 className="text-2xl font-bold text-white mb-4">Movie not found</h1>
                <a href={`/${locale}/movie`} className="text-red-400 hover:text-red-300 transition-colors">
                    {locale === 'ru' ? '← К фильмам' : '← Back to movies'}
                </a>
            </div>
        );
    }

    const title = getLocalizedField(movie.title_localized, locale) || movie.title;
    const description = getLocalizedField(movie.description, locale);

    // Fetch all data in parallel
    let videos: Video[] = [];
    let cast: Celebrity[] = [];
    let similarMovies: Movie[] = [];

    try {
        const [videosResult, castResult, similarResult] = await Promise.all([
            getVideosForMovie(movie.id),
            getCelebritiesForMovie(movie.id),
            getSimilarMovies(movie.id, 6),
        ]);
        videos = videosResult.data;
        cast = castResult;
        similarMovies = similarResult;
    } catch (error) {
        logger.error('Movie detail relations error', { page: 'movie/detail', error: error instanceof Error ? error.message : String(error) });
    }

    // JSON-LD
    const movieLd = {
        '@context': 'https://schema.org',
        '@type': 'Movie',
        name: title,
        url: `https://celeb.skin/${locale}/movie/${movie.slug}`,
        ...(movie.poster_url && { image: movie.poster_url }),
        ...(movie.year && { datePublished: movie.year.toString() }),
        ...(movie.director && { director: { '@type': 'Person', name: movie.director } }),
        ...(movie.genres.length > 0 && { genre: movie.genres }),
    };

    return (
        <div className="mx-auto max-w-6xl px-4 py-4 md:py-6">
            <JsonLd data={movieLd} />

            {/* ── 1. HERO SECTION ── */}
            <div className="flex flex-col items-center md:items-start md:flex-row gap-6 md:gap-8">
                {/* Poster */}
                <div className="w-48 md:w-56 shrink-0 aspect-[2/3] rounded-xl overflow-hidden border border-gray-800 bg-gray-800">
                    {movie.poster_url ? (
                        <SafeImage
                            src={movie.poster_url}
                            alt={title}
                            loading="eager"
                            className="w-full h-full object-cover"
                            fallback={
                                <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-700 flex flex-col items-center justify-center p-4">
                                    <svg className="w-12 h-12 text-gray-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" />
                                    </svg>
                                    <span className="text-sm text-gray-500 text-center">{title}</span>
                                </div>
                            }
                        />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-700 flex flex-col items-center justify-center p-4">
                            <svg className="w-12 h-12 text-gray-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" />
                            </svg>
                            <span className="text-sm text-gray-500 text-center">{title}</span>
                        </div>
                    )}
                </div>

                {/* Info */}
                <div className="text-center md:text-left flex-1">
                    <div className="flex items-baseline justify-center md:justify-start gap-3">
                        <h1 className="text-2xl md:text-3xl font-bold text-white">{title}</h1>
                        {movie.year && (
                            <span className="text-lg text-gray-400">{movie.year}</span>
                        )}
                    </div>

                    {/* Director */}
                    {movie.director && (
                        <p className="text-sm text-gray-400 mt-1.5">
                            {directedByLabel[locale] || directedByLabel.en} {movie.director}
                        </p>
                    )}

                    {/* Studio */}
                    {movie.studio && (
                        <p className="text-sm text-gray-500 mt-0.5">{movie.studio}</p>
                    )}

                    {/* Stats */}
                    <div className="flex items-center justify-center md:justify-start gap-4 text-sm text-gray-400 mt-3">
                        {movie.scenes_count > 0 && (
                            <span>{movie.scenes_count} {scenesWord[locale] || scenesWord.en}</span>
                        )}
                        {cast.length > 0 && (
                            <span>{cast.length} {celebritiesWord[locale] || celebritiesWord.en}</span>
                        )}
                    </div>

                    {/* Genre chips */}
                    {movie.genres.length > 0 && (
                        <div className="flex flex-wrap justify-center md:justify-start gap-1.5 mt-3">
                            {movie.genres.map((g) => (
                                <span
                                    key={g}
                                    className="px-2.5 py-1 rounded-full text-xs bg-gray-800/50 text-gray-400 border border-gray-700"
                                >
                                    {g}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Description */}
                    {description && (
                        <div className="mt-3 max-w-2xl">
                            <ExpandableText text={description} />
                        </div>
                    )}
                </div>
            </div>

            {/* ── 2. SCENES ── */}
            <section className="mt-8 pt-6 border-t border-gray-800/50">
                <h2 className="text-lg font-semibold text-white mb-4">
                    {scenesLabel[locale] || scenesLabel.en}
                    {videos.length > 0 && (
                        <span className="text-gray-500 font-normal ml-2">({videos.length})</span>
                    )}
                </h2>
                {videos.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {videos.map((v) => (
                            <VideoCard key={v.id} video={v} locale={locale} />
                        ))}
                    </div>
                ) : (
                    <p className="text-gray-500 text-sm">
                        {locale === 'ru' ? 'Сцен пока нет.' : 'No scenes available yet.'}
                    </p>
                )}
            </section>

            {/* ── 3. CAST ── */}
            {cast.length > 0 && (
                <section className="mt-8 pt-6 border-t border-gray-800/50">
                    <h2 className="text-lg font-semibold text-white mb-4">
                        {castLabel[locale] || castLabel.en}
                    </h2>
                    <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-hide md:grid md:grid-cols-4 lg:grid-cols-6 md:overflow-visible md:pb-0">
                        {cast.map((c) => {
                            const celName = getLocalizedField(c.name_localized, locale) || c.name;
                            return (
                                <a
                                    key={c.id}
                                    href={`/${locale}/celebrity/${c.slug}`}
                                    className="group flex flex-col items-center shrink-0 w-[100px] md:w-auto transition-transform hover:scale-[1.03]"
                                >
                                    <div className="w-20 h-20 md:w-24 md:h-24 rounded-xl overflow-hidden bg-gray-800 border border-gray-700 group-hover:border-gray-500 transition-colors">
                                        {c.photo_url ? (
                                            <SafeImage
                                                src={c.photo_url}
                                                alt={celName}
                                                className="w-full h-full object-cover"
                                                fallback={
                                                    <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-700 flex items-center justify-center">
                                                        <span className="text-lg font-semibold text-gray-500">
                                                            {c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                                                        </span>
                                                    </div>
                                                }
                                            />
                                        ) : (
                                            <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-700 flex items-center justify-center">
                                                <span className="text-lg font-semibold text-gray-500">
                                                    {c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <span className="text-sm text-white text-center line-clamp-1 mt-1.5 group-hover:text-red-400 transition-colors">
                                        {celName}
                                    </span>
                                    {c.videos_count > 0 && (
                                        <span className="text-xs text-gray-500">
                                            {c.videos_count} {scenesWord[locale] || scenesWord.en}
                                        </span>
                                    )}
                                </a>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* ── 4. SIMILAR MOVIES ── */}
            {similarMovies.length > 0 && (
                <section className="mt-8 pt-6 border-t border-gray-800/50">
                    <h2 className="text-lg font-semibold text-white mb-4">
                        {similarLabel[locale] || similarLabel.en}
                    </h2>
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                        {similarMovies.map((m) => {
                            const mTitle = getLocalizedField(m.title_localized, locale) || m.title;
                            return (
                                <a
                                    key={m.id}
                                    href={`/${locale}/movie/${m.slug}`}
                                    className="group relative"
                                >
                                    <div className="aspect-[2/3] rounded-lg overflow-hidden bg-gray-800 border border-gray-700 group-hover:border-gray-500 transition-colors">
                                        {m.poster_url ? (
                                            <SafeImage
                                                src={m.poster_url}
                                                alt={mTitle}
                                                className="w-full h-full object-cover"
                                                fallback={
                                                    <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-700 flex items-center justify-center p-2">
                                                        <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" />
                                                        </svg>
                                                    </div>
                                                }
                                            />
                                        ) : (
                                            <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-700 flex items-center justify-center p-2">
                                                <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" />
                                                </svg>
                                            </div>
                                        )}
                                        {/* Title overlay on hover */}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                                            <span className="text-xs text-white font-medium line-clamp-2">{mTitle}</span>
                                        </div>
                                    </div>
                                    <div className="mt-1.5">
                                        <h3 className="text-xs font-medium text-gray-300 group-hover:text-white transition-colors line-clamp-1">{mTitle}</h3>
                                        {m.year && (
                                            <p className="text-[11px] text-gray-500">{m.year}</p>
                                        )}
                                    </div>
                                </a>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}
