import type { Metadata } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/i18n';
import { getLocalizedField } from '@/lib/i18n';
import { getVideoBySlug, getRelatedVideos } from '@/lib/db';
import VideoPlayer from '@/components/VideoPlayer';
import VideoCard from '@/components/VideoCard';

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
    let video;
    try {
        video = await getVideoBySlug(params.slug, params.locale);
    } catch (error) {
        console.error('[VideoDetail] metadata DB error:', error);
    }
    const title = video
        ? getLocalizedField(video.seo_title, params.locale) || getLocalizedField(video.title, params.locale)
        : 'Video';
    const description = video ? getLocalizedField(video.seo_description, params.locale) : '';

    return {
        title: `${title} — CelebSkin`,
        description,
        alternates: {
            languages: Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `/${loc}/video/${params.slug}`])
            ),
        },
    };
}

export default async function VideoDetailPage({
    params,
}: {
    params: { locale: string; slug: string };
}) {
    const locale = params.locale;

    let video;
    try {
        video = await getVideoBySlug(params.slug, locale);
    } catch (error) {
        console.error('[VideoDetail] DB error:', error);
    }

    if (!video) {
        return (
            <div className="mx-auto max-w-7xl px-4 py-20 text-center">
                <h1 className="text-2xl font-bold text-white mb-4">Video not found</h1>
                <a href={`/${locale}/video`} className="text-brand-accent hover:underline">← Back to videos</a>
            </div>
        );
    }

    const title = getLocalizedField(video.title, locale);
    const review = getLocalizedField(video.review, locale);

    let similar: import('@/lib/types').Video[] = [];
    try {
        similar = await getRelatedVideos(video.id, 4);
    } catch (error) {
        console.error('[VideoDetail] related videos error:', error);
    }

    return (
        <div className="mx-auto max-w-6xl px-4 py-6">
            {/* Video Player */}
            <VideoPlayer
                src={video.video_url_watermarked || video.video_url}
                poster={video.thumbnail_url}
                title={title}
            />

            {/* Title & Info */}
            <div className="mt-4">
                <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">{title}</h1>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                    {video.duration_formatted && (
                        <span className="text-brand-secondary">{video.duration_formatted}</span>
                    )}
                    {video.quality && (
                        <span className="bg-brand-accent text-white text-xs font-bold px-2 py-0.5 rounded">{video.quality}</span>
                    )}
                    <span className="text-brand-secondary">{formatViews(video.views_count)} views</span>
                    <div className="flex items-center gap-2 ml-auto">
                        <button className="flex items-center gap-1 text-brand-secondary hover:text-green-400 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg>
                            <span className="text-xs">{formatViews(video.likes_count)}</span>
                        </button>
                        <button className="flex items-center gap-1 text-brand-secondary hover:text-red-400 transition-colors">
                            <svg className="w-4 h-4 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg>
                            <span className="text-xs">{video.dislikes_count}</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
                <div>
                    {/* Celebrities */}
                    {video.celebrities && video.celebrities.length > 0 && (
                        <section className="mb-6">
                            <h2 className="text-sm font-semibold text-brand-secondary uppercase tracking-wider mb-3">Celebrities</h2>
                            <div className="flex flex-wrap gap-3">
                                {video.celebrities.map((celeb) => (
                                    <a
                                        key={celeb.id}
                                        href={`/${locale}/celebrity/${celeb.slug}`}
                                        className="flex items-center gap-2.5 rounded-lg bg-brand-card border border-brand-border px-3 py-2 hover:bg-brand-hover transition-colors"
                                    >
                                        <div className="w-9 h-9 rounded-full bg-brand-hover flex items-center justify-center text-sm font-semibold text-brand-secondary shrink-0">
                                            {celeb.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                                        </div>
                                        <span className="text-sm text-brand-text">{celeb.name}</span>
                                    </a>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Movie */}
                    {video.movie && (
                        <section className="mb-6">
                            <h2 className="text-sm font-semibold text-brand-secondary uppercase tracking-wider mb-3">Movie</h2>
                            <a
                                href={`/${locale}/movie/${video.movie.slug}`}
                                className="flex items-center gap-3 rounded-lg bg-brand-card border border-brand-border px-3 py-2 hover:bg-brand-hover transition-colors w-fit"
                            >
                                <div className="w-10 h-14 rounded bg-brand-hover flex items-center justify-center text-xs text-brand-muted shrink-0">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" /></svg>
                                </div>
                                <div>
                                    <span className="text-sm text-brand-text block">{getLocalizedField(video.movie.title_localized, locale) || video.movie.title}</span>
                                    {video.movie.year && <span className="text-xs text-brand-muted">{video.movie.year}</span>}
                                </div>
                            </a>
                        </section>
                    )}

                    {/* Tags */}
                    {video.tags && video.tags.length > 0 && (
                        <section className="mb-6">
                            <h2 className="text-sm font-semibold text-brand-secondary uppercase tracking-wider mb-3">Tags</h2>
                            <div className="flex flex-wrap gap-2">
                                {video.tags.map((tag) => (
                                    <a
                                        key={tag.id}
                                        href={`/${locale}/tag/${tag.slug}`}
                                        className="text-xs bg-brand-card border border-brand-border text-brand-secondary px-3 py-1.5 rounded-full hover:bg-brand-hover hover:text-brand-text transition-colors"
                                    >
                                        {getLocalizedField(tag.name_localized, locale) || tag.name}
                                    </a>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Review */}
                    {review && (
                        <section className="mb-6">
                            <h2 className="text-sm font-semibold text-brand-secondary uppercase tracking-wider mb-3">Review</h2>
                            <p className="text-sm text-brand-text/80 leading-relaxed">{review}</p>
                        </section>
                    )}
                </div>

                {/* Sidebar — Similar Videos */}
                <aside>
                    <h2 className="text-sm font-semibold text-brand-secondary uppercase tracking-wider mb-3">Similar Videos</h2>
                    <div className="flex flex-col gap-3">
                        {similar.map((v) => (
                            <VideoCard key={v.id} video={v} locale={locale} size="sm" />
                        ))}
                    </div>
                </aside>
            </div>
        </div>
    );
}
