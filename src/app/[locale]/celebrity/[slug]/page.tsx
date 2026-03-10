import type { Metadata } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/i18n';
import { getLocalizedField } from '@/lib/i18n';
import { getCelebrityBySlug, getVideosForCelebrity, getMoviesForCelebrity } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Video, Movie } from '@/lib/types';
import VideoCard from '@/components/VideoCard';
import JsonLd from '@/components/JsonLd';

function formatViews(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
}

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
    return {
        title: `${name} Nude Scenes — CelebSkin`,
        alternates: { languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}/celebrity/${params.slug}`])) },
    };
}

export default async function CelebrityDetailPage({
    params,
}: {
    params: { locale: string; slug: string };
}) {
    const locale = params.locale;

    let celeb;
    try {
        celeb = await getCelebrityBySlug(params.slug);
    } catch (error) {
        logger.error('Celebrity detail DB error', { page: 'celebrity/detail', error: error instanceof Error ? error.message : String(error) });
    }

    if (!celeb) {
        return (
            <div className="mx-auto max-w-7xl px-4 py-20 text-center">
                <h1 className="text-2xl font-bold text-white mb-4">Celebrity not found</h1>
                <a href={`/${locale}/celebrity`} className="text-brand-accent hover:underline">← Back to celebrities</a>
            </div>
        );
    }

    const name = getLocalizedField(celeb.name_localized, locale) || celeb.name;
    const bio = getLocalizedField(celeb.bio, locale);

    let videos: Video[] = [];
    let celebMovies: Movie[] = [];
    try {
        const videosResult = await getVideosForCelebrity(celeb.id);
        videos = videosResult.data;
        celebMovies = await getMoviesForCelebrity(celeb.id);
    } catch (error) {
        logger.error('Celebrity detail relations error', { page: 'celebrity/detail', error: error instanceof Error ? error.message : String(error) });
    }

    const personLd = {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: celeb.name,
        url: `https://celeb.skin/${locale}/celebrity/${celeb.slug}`,
        ...(celeb.photo_url && { image: celeb.photo_url }),
        ...(celeb.birth_date && { birthDate: celeb.birth_date }),
        ...(celeb.nationality && { nationality: celeb.nationality }),
    };

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <JsonLd data={personLd} />
            {/* Profile Header */}
            <div className="flex flex-col gap-6 md:flex-row md:gap-8 mb-10">
                <div className="w-40 h-52 md:w-52 md:h-68 shrink-0 rounded-2xl overflow-hidden border border-brand-border bg-brand-card">
                    {celeb.photo_url ? (
                        <img src={celeb.photo_url} alt={name} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-br from-brand-card via-brand-hover to-brand-card flex items-center justify-center">
                            <span className="text-4xl font-bold text-brand-muted">
                                {celeb.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex-1">
                    <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">{name}</h1>

                    <div className="flex flex-wrap gap-4 mb-4 text-sm text-brand-secondary">
                        {celeb.birth_date && (
                            <span>Born: {new Date(celeb.birth_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                        )}
                        {celeb.nationality && <span>{celeb.nationality}</span>}
                    </div>

                    {/* Stats */}
                    <div className="flex gap-6 mb-5">
                        <div className="text-center">
                            <span className="block text-2xl font-bold text-brand-accent">{celeb.videos_count}</span>
                            <span className="text-xs text-brand-secondary">Videos</span>
                        </div>
                        <div className="text-center">
                            <span className="block text-2xl font-bold text-white">{formatViews(celeb.total_views)}</span>
                            <span className="text-xs text-brand-secondary">Views</span>
                        </div>
                        <div className="text-center">
                            <span className="block text-2xl font-bold text-white">{celeb.movies_count}</span>
                            <span className="text-xs text-brand-secondary">Movies</span>
                        </div>
                    </div>

                    {bio && (
                        <p className="text-sm text-brand-text/80 leading-relaxed max-w-2xl">{bio}</p>
                    )}
                </div>
            </div>

            {/* All Scenes */}
            <section className="mb-10">
                <h2 className="text-xl font-bold text-white mb-4">All Scenes</h2>
                {videos.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {videos.map((v) => (
                            <VideoCard key={v.id} video={v} locale={locale} />
                        ))}
                    </div>
                ) : (
                    <p className="text-brand-secondary text-sm">No scenes available yet.</p>
                )}
            </section>

            {/* Filmography */}
            {celebMovies.length > 0 && (
                <section>
                    <h2 className="text-xl font-bold text-white mb-4">Filmography</h2>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                        {celebMovies.map((movie) => {
                            const movieTitle = getLocalizedField(movie.title_localized, locale) || movie.title;
                            return (
                                <a key={movie.id} href={`/${locale}/movie/${movie.slug}`} className="group">
                                    <div className="aspect-[2/3] rounded-xl overflow-hidden bg-brand-card border border-brand-border group-hover:border-brand-accent/50 transition-colors">
                                        {movie.poster_url ? (
                                            <img src={movie.poster_url} alt={movieTitle} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full bg-gradient-to-br from-brand-card to-brand-hover flex flex-col items-center justify-center p-3">
                                                <svg className="w-8 h-8 text-brand-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" /></svg>
                                                <span className="text-xs text-brand-muted text-center">{movieTitle}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="mt-2">
                                        <h3 className="text-sm font-medium text-brand-text group-hover:text-white transition-colors line-clamp-1">{movieTitle}</h3>
                                        <p className="text-xs text-brand-secondary">{movie.year} · {movie.scenes_count} scenes</p>
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
