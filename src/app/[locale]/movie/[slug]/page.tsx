import type { Metadata } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/i18n';
import { getLocalizedField } from '@/lib/i18n';
import { getMovieBySlug, getVideosForMovie, getCelebritiesForMovie } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Video, Celebrity } from '@/lib/types';
import VideoCard from '@/components/VideoCard';

import CelebrityCard from '@/components/CelebrityCard';
import JsonLd from '@/components/JsonLd';

function formatViews(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
}

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
        alternates: { languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}/movie/${params.slug}`])) },
    };
}

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
            <div className="mx-auto max-w-7xl px-4 py-20 text-center">
                <h1 className="text-2xl font-bold text-white mb-4">Movie not found</h1>
                <a href={`/${locale}/movie`} className="text-brand-accent hover:underline">← Back to movies</a>
            </div>
        );
    }

    const title = getLocalizedField(movie.title_localized, locale) || movie.title;
    const description = getLocalizedField(movie.description, locale);

    let videos: Video[] = [];
    let cast: Celebrity[] = [];
    try {
        const videosResult = await getVideosForMovie(movie.id);
        videos = videosResult.data;
        cast = await getCelebritiesForMovie(movie.id);
    } catch (error) {
        logger.error('Movie detail relations error', { page: 'movie/detail', error: error instanceof Error ? error.message : String(error) });
    }

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
        <div className="mx-auto max-w-7xl px-4 py-8">
            <JsonLd data={movieLd} />
            <div className="flex flex-col gap-6 md:flex-row md:gap-8 mb-10">
                {/* Poster */}
                <div className="w-48 md:w-56 shrink-0 aspect-[2/3] rounded-2xl overflow-hidden border border-brand-border bg-brand-card">
                    {movie.poster_url ? (
                        <img src={movie.poster_url} alt={title} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-br from-brand-card via-brand-hover to-brand-card flex flex-col items-center justify-center p-4">
                            <svg className="w-12 h-12 text-brand-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" /></svg>
                            <span className="text-sm text-brand-muted text-center">{title}</span>
                        </div>
                    )}
                </div>

                <div className="flex-1">
                    <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">{title}</h1>
                    <div className="flex flex-wrap gap-4 mb-4 text-sm text-brand-secondary">
                        {movie.year && <span>{movie.year}</span>}
                        {movie.director && <span>Dir: {movie.director}</span>}
                        {movie.studio && <span>{movie.studio}</span>}
                    </div>
                    {movie.genres.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                            {movie.genres.map((g) => (
                                <span key={g} className="text-xs bg-brand-card border border-brand-border text-brand-secondary px-2.5 py-1 rounded-full">{g}</span>
                            ))}
                        </div>
                    )}
                    <div className="flex gap-6 mb-5">
                        <div className="text-center">
                            <span className="block text-2xl font-bold text-brand-accent">{movie.scenes_count}</span>
                            <span className="text-xs text-brand-secondary">Scenes</span>
                        </div>
                        <div className="text-center">
                            <span className="block text-2xl font-bold text-white">{formatViews(movie.total_views)}</span>
                            <span className="text-xs text-brand-secondary">Views</span>
                        </div>
                    </div>
                    {description && <p className="text-sm text-brand-text/80 leading-relaxed max-w-2xl">{description}</p>}
                </div>
            </div>

            {/* Scenes */}
            <section className="mb-10">
                <h2 className="text-xl font-bold text-white mb-4">Scenes</h2>
                {videos.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {videos.map((v) => (<VideoCard key={v.id} video={v} locale={locale} />))}
                    </div>
                ) : (
                    <p className="text-brand-secondary text-sm">No scenes available yet.</p>
                )}
            </section>

            {/* Cast */}
            {cast.length > 0 && (
                <section>
                    <h2 className="text-xl font-bold text-white mb-4">Cast</h2>
                    <div className="flex gap-4 overflow-x-auto pb-4">
                        {cast.map((c) => (<CelebrityCard key={c.id} celebrity={c} locale={locale} />))}
                    </div>
                </section>
            )}
        </div>
    );
}
