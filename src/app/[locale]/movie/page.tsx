import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';
import { getLocalizedField } from '@/lib/i18n';
import { getMovies } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Movie, PaginatedResult } from '@/lib/types';

const titles: Record<string, string> = {
    en: 'Movies', ru: 'Фильмы', de: 'Filme', fr: 'Films',
    es: 'Películas', pt: 'Filmes', it: 'Film',
    pl: 'Filmy', nl: 'Films', tr: 'Filmler',
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: `${titles[locale] || titles.en} — CelebSkin`,
        alternates: { languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}/movie`])) },
    };
}

export default async function MoviesPage({
    params,
    searchParams,
}: {
    params: { locale: string };
    searchParams: { sort?: string; page?: string };
}) {
    const locale = params.locale;
    const sort = searchParams.sort || 'scenes';
    const page = parseInt(searchParams.page || '1');
    const perPage = 20;

    const sortMap: Record<string, string> = {
        scenes: 'scenes_count',
        latest: 'year',
        az: 'title',
    };
    const orderBy = sortMap[sort] || 'scenes_count';

    let result: PaginatedResult<Movie> = { data: [], total: 0, page: 1, limit: perPage, totalPages: 0 };
    try {
        result = await getMovies(page, perPage, orderBy);
    } catch (error) {
        logger.error('Movies page DB error', { page: 'movies', error: error instanceof Error ? error.message : String(error) });
    }

    const movies = result.data;
    const totalPages = result.totalPages;

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold text-white">
                    {titles[locale] || titles.en}
                </h1>
                <div className="flex gap-1.5">
                    {[
                        { key: 'scenes', label: 'Most Scenes' },
                        { key: 'latest', label: 'Latest' },
                        { key: 'az', label: 'A-Z' },
                    ].map(({ key, label }) => (
                        <a
                            key={key}
                            href={`/${locale}/movie?sort=${key}`}
                            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${sort === key
                                ? 'bg-brand-accent text-white'
                                : 'bg-brand-card text-brand-secondary border border-brand-border hover:bg-brand-hover'
                                }`}
                        >
                            {label}
                        </a>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {movies.map((movie) => {
                    const movieTitle = getLocalizedField(movie.title_localized, locale) || movie.title;
                    return (
                        <a key={movie.id} href={`/${locale}/movie/${movie.slug}`} className="group rounded-lg overflow-hidden transition-transform duration-200 hover:scale-[1.02]">
                            <div className="relative aspect-[2/3] bg-brand-card rounded-lg overflow-hidden">
                                {movie.poster_url ? (
                                    <img src={movie.poster_url} alt={movieTitle} loading="lazy" className="w-full h-full object-cover transition-all duration-300 group-hover:brightness-110 group-hover:scale-105" />
                                ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-brand-card via-brand-hover to-brand-card flex flex-col items-center justify-center p-3">
                                        <svg className="w-8 h-8 text-brand-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>
                                        <span className="text-xs text-brand-muted text-center">{movieTitle}</span>
                                    </div>
                                )}
                                {movie.year && <span className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">{movie.year}</span>}
                                <span className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">{movie.scenes_count} scenes</span>
                            </div>
                            <div className="mt-2 px-0.5">
                                <h3 className="text-sm font-medium text-brand-text line-clamp-1 group-hover:text-white transition-colors">{movieTitle}</h3>
                                {movie.director && <p className="text-xs text-brand-secondary mt-0.5">{movie.director}</p>}
                            </div>
                        </a>
                    );
                })}
            </div>

            {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-3">
                    {page > 1 && <a href={`/${locale}/movie?sort=${sort}&page=${page - 1}`} className="px-4 py-2 text-sm rounded-lg bg-brand-card border border-brand-border text-brand-secondary hover:bg-brand-hover transition-colors">← Previous</a>}
                    <span className="text-sm text-brand-secondary">Page {page} of {totalPages}</span>
                    {page < totalPages && <a href={`/${locale}/movie?sort=${sort}&page=${page + 1}`} className="px-4 py-2 text-sm rounded-lg bg-brand-card border border-brand-border text-brand-secondary hover:bg-brand-hover transition-colors">Next →</a>}
                </div>
            )}
        </div>
    );
}
