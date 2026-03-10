import type { Metadata } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/i18n';
import { getLocalizedField } from '@/lib/i18n';
import { getVideoBySlug, getRelatedVideos } from '@/lib/db';
import { logger } from '@/lib/logger';
import VideoPlayer from '@/components/VideoPlayer';
import VideoCard from '@/components/VideoCard';
import VideoActions from '@/components/VideoActions';
import ScreenshotGallery from '@/components/ScreenshotGallery';
import JsonLd from '@/components/JsonLd';

export async function generateMetadata({
    params,
}: {
    params: { locale: string; slug: string };
}): Promise<Metadata> {
    let video;
    try {
        video = await getVideoBySlug(params.slug, params.locale);
    } catch (error) {
        logger.error('Video detail metadata DB error', { page: 'video/detail', error: error instanceof Error ? error.message : String(error) });
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

function formatDurationISO(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `PT${m}M${s}S`;
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
        logger.error('Video detail DB error', { page: 'video/detail', error: error instanceof Error ? error.message : String(error) });
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
        similar = await getRelatedVideos(video.id, locale, 6);
    } catch (error) {
        logger.error('Video detail related videos error', { page: 'video/detail', error: error instanceof Error ? error.message : String(error) });
    }

    const videoLd = title && video.thumbnail_url ? {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: title,
        description: getLocalizedField(video.seo_description, locale) || review || '',
        thumbnailUrl: video.thumbnail_url,
        ...(video.published_at && { uploadDate: new Date(video.published_at).toISOString() }),
        ...(video.duration_seconds && { duration: formatDurationISO(video.duration_seconds) }),
        ...((video.video_url_watermarked || video.video_url) && { contentUrl: video.video_url_watermarked || video.video_url }),
        publisher: { '@type': 'Organization', name: 'CelebSkin', url: 'https://celeb.skin' },
    } : null;

    return (
        <div className="mx-auto max-w-6xl px-4 py-6">
            {videoLd && <JsonLd data={videoLd} />}
            {/* Video Player — CDN video, or source embed, or placeholder */}
            {(video.video_url_watermarked || video.video_url) ? (
                <VideoPlayer
                    src={video.video_url_watermarked || video.video_url}
                    poster={video.thumbnail_url}
                    title={title}
                />
            ) : video.embed_code ? (
                <div
                    className="aspect-video w-full rounded-xl overflow-hidden bg-black [&_iframe]:w-full [&_iframe]:h-full"
                    dangerouslySetInnerHTML={{ __html: video.embed_code }}
                />
            ) : (
                <VideoPlayer
                    src={null}
                    poster={video.thumbnail_url}
                    title={title}
                />
            )}

            {/* Screenshots Gallery */}
            {video.screenshots && video.screenshots.length > 0 && (
                <ScreenshotGallery screenshots={video.screenshots} />
            )}

            {/* Breadcrumbs + Title & Info */}
            <div className="mt-4">
                <nav aria-label="breadcrumb" className="mb-2">
                    <ol className="flex items-center gap-1.5 text-sm flex-wrap">
                        <li><a href={`/${locale}`} className="text-brand-secondary hover:text-brand-text transition-colors">Home</a></li>
                        <li className="text-brand-muted">&gt;</li>
                        {video.celebrities?.[0] && (
                            <>
                                <li>
                                    <a href={`/${locale}/celebrity/${video.celebrities[0].slug}`}
                                       className="text-brand-secondary hover:text-brand-text transition-colors">
                                        {video.celebrities[0].name}
                                    </a>
                                </li>
                                <li className="text-brand-muted">&gt;</li>
                            </>
                        )}
                        <li className="text-brand-muted truncate max-w-[300px]">{title}</li>
                    </ol>
                </nav>
                <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">{title}</h1>

                <VideoActions
                    videoId={video.id}
                    initialViews={video.views_count}
                    initialLikes={video.likes_count}
                    initialDislikes={video.dislikes_count}
                    durationFormatted={video.duration_formatted || undefined}
                    quality={video.quality || undefined}
                />
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
                                        {celeb.photo_url ? (
                                            <img src={celeb.photo_url} alt={celeb.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                                        ) : (
                                            <div className="w-9 h-9 rounded-full bg-brand-hover flex items-center justify-center text-sm font-semibold text-brand-secondary shrink-0">
                                                {celeb.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                                            </div>
                                        )}
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
                                {video.movie.poster_url ? (
                                    <img src={video.movie.poster_url} alt={getLocalizedField(video.movie.title_localized, locale) || video.movie.title} className="w-10 h-14 rounded object-cover shrink-0" />
                                ) : (
                                    <div className="w-10 h-14 rounded bg-brand-hover flex items-center justify-center text-xs text-brand-muted shrink-0">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" /></svg>
                                    </div>
                                )}
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
                    <h2 className="text-sm font-semibold text-brand-secondary uppercase tracking-wider mb-3">Related Videos</h2>
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
