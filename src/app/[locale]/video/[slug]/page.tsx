import type { Metadata } from 'next';
import { getLocalizedField } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import { getVideoBySlug, getRelatedVideos, getOtherVideosByCelebrity, getOtherVideosByMovie } from '@/lib/db';
import { logger } from '@/lib/logger';
import VideoPlayer from '@/components/VideoPlayer';
import VideoCard from '@/components/VideoCard';
import VideoDetailActions from '@/components/VideoDetailActions';
import ScreenshotGallery from '@/components/ScreenshotGallery';
import ExpandableText from '@/components/ExpandableText';
import JsonLd from '@/components/JsonLd';
import type { Video } from '@/lib/types';

// ============================================
// Metadata (unchanged)
// ============================================

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
        alternates: buildAlternates(params.locale, `/video/${params.slug}`),
    };
}

// ============================================
// Helpers
// ============================================

function formatDurationISO(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `PT${m}M${s}S`;
}

// ============================================
// Page
// ============================================

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
                <a href={`/${locale}/video`} className="text-red-400 hover:underline">← Back to videos</a>
            </div>
        );
    }

    const title = getLocalizedField(video.title, locale);
    const review = getLocalizedField(video.review, locale);
    const celebrity = video.celebrities?.[0];
    const movieTitle = video.movie
        ? (getLocalizedField(video.movie.title_localized, locale) || video.movie.title)
        : null;

    // Fetch related content in parallel
    let similar: Video[] = [];
    let moreByCeleb: Video[] = [];
    let moreByMovie: Video[] = [];

    try {
        [similar, moreByCeleb, moreByMovie] = await Promise.all([
            getRelatedVideos(video.id, locale, 8),
            celebrity
                ? getOtherVideosByCelebrity(celebrity.id, video.id, 4)
                : Promise.resolve([]),
            video.movie
                ? getOtherVideosByMovie(video.movie.id, video.id, 4)
                : Promise.resolve([]),
        ]);
    } catch (error) {
        logger.error('Video detail related content error', { page: 'video/detail', error: error instanceof Error ? error.message : String(error) });
    }

    // Filter similar to exclude videos already in "More from" sections
    const moreIds = new Set([...moreByCeleb.map(v => v.id), ...moreByMovie.map(v => v.id)]);
    const filteredSimilar = similar.filter(v => !moreIds.has(v.id));

    // JSON-LD structured data (unchanged)
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
        <div className="mx-auto max-w-6xl px-4 py-4 md:py-6">
            {videoLd && <JsonLd data={videoLd} />}

            {/* ── 1. Video Player — edge-to-edge on mobile ── */}
            <div className="-mx-4 md:mx-0 [&>div]:rounded-none md:[&>div]:rounded-xl">
                {(video.video_url_watermarked || video.video_url) ? (
                    <VideoPlayer
                        src={video.video_url_watermarked || video.video_url}
                        poster={video.thumbnail_url}
                        title={title}
                    />
                ) : video.embed_code ? (
                    <div
                        className="aspect-video w-full overflow-hidden bg-black md:rounded-xl [&_iframe]:w-full [&_iframe]:h-full"
                        dangerouslySetInnerHTML={{ __html: video.embed_code }}
                    />
                ) : (
                    <VideoPlayer
                        src={null}
                        poster={video.thumbnail_url}
                        title={title}
                    />
                )}
            </div>

            {/* ── 8. Breadcrumbs ── */}
            <nav aria-label="breadcrumb" className="mt-3">
                <ol className="flex items-center gap-1.5 text-sm flex-wrap">
                    <li>
                        <a href={`/${locale}`} className="text-gray-500 hover:text-gray-300 transition-colors">Home</a>
                    </li>
                    <li className="text-gray-600">/</li>
                    <li>
                        <a href={`/${locale}/video`} className="text-gray-500 hover:text-gray-300 transition-colors">Videos</a>
                    </li>
                    {celebrity && (
                        <>
                            <li className="text-gray-600">/</li>
                            <li>
                                <a href={`/${locale}/celebrity/${celebrity.slug}`}
                                   className="text-gray-500 hover:text-gray-300 transition-colors">
                                    {celebrity.name}
                                </a>
                            </li>
                        </>
                    )}
                    <li className="text-gray-600">/</li>
                    <li className="text-gray-600 truncate max-w-[200px] sm:max-w-[300px]">{title}</li>
                </ol>
            </nav>

            {/* ── 11. Two-column layout ── */}
            <div className="mt-3 lg:grid lg:grid-cols-[1fr_340px] lg:gap-8">

                {/* ══════════════ Main Column ══════════════ */}
                <div>

                    {/* ── 2. Title + Metadata + Actions ── */}
                    <div>
                        <h1 className="text-lg md:text-xl font-bold text-white leading-tight">{title}</h1>

                        {/* Metadata row */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-400 mt-1.5">
                            {/* Celebrity badges */}
                            {video.celebrities && video.celebrities.map((celeb) => (
                                <a
                                    key={celeb.id}
                                    href={`/${locale}/celebrity/${celeb.slug}`}
                                    className="inline-flex items-center bg-gray-800 px-2 py-0.5 rounded text-xs text-gray-300 hover:text-red-400 transition-colors"
                                >
                                    {celeb.name}
                                </a>
                            ))}

                            {/* Movie link */}
                            {video.movie && (
                                <a
                                    href={`/${locale}/movie/${video.movie.slug}`}
                                    className="hover:text-red-400 transition-colors"
                                >
                                    {movieTitle}
                                </a>
                            )}

                            {/* Separator dot */}
                            {video.movie && (video.movie.year || video.duration_formatted) && (
                                <span className="text-gray-600">&middot;</span>
                            )}

                            {/* Year */}
                            {video.movie?.year && (
                                <span>{video.movie.year}</span>
                            )}

                            {/* Duration */}
                            {video.duration_formatted && (
                                <span>{video.duration_formatted}</span>
                            )}

                            {/* Quality badge */}
                            {video.quality && (
                                <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                                    {video.quality}
                                </span>
                            )}
                        </div>

                        {/* Action buttons: views, like/dislike, bookmark, share */}
                        <VideoDetailActions
                            videoId={video.id}
                            initialViews={video.views_count}
                            initialLikes={video.likes_count}
                            initialDislikes={video.dislikes_count}
                        />
                    </div>

                    {/* ── 3. Tags ── */}
                    {video.tags && video.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-5 pt-5 border-t border-gray-800/50">
                            {video.tags.map((tag) => (
                                <a
                                    key={tag.id}
                                    href={`/${locale}/tag/${tag.slug}`}
                                    className="px-2 py-0.5 rounded-full text-xs bg-gray-800/50 text-gray-400 border border-gray-700 hover:border-red-600 hover:text-red-400 transition-colors"
                                >
                                    {getLocalizedField(tag.name_localized, locale) || tag.name}
                                </a>
                            ))}
                        </div>
                    )}

                    {/* ── 4. Screenshots Gallery ── */}
                    {video.screenshots && video.screenshots.length > 0 && (
                        <div className="mt-5 pt-5 border-t border-gray-800/50">
                            <ScreenshotGallery screenshots={video.screenshots} />
                        </div>
                    )}

                    {/* ── 7. Description / Review ── */}
                    {review && (
                        <div className="mt-5 pt-5 border-t border-gray-800/50">
                            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Review</h2>
                            <ExpandableText text={review} />
                        </div>
                    )}
                </div>

                {/* ══════════════ Sidebar ══════════════ */}
                <aside className="mt-8 lg:mt-0 space-y-6">

                    {/* ── 5a. More from Celebrity ── */}
                    {moreByCeleb.length > 0 && celebrity && (
                        <section>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-sm font-semibold text-white truncate mr-2">
                                    More from {celebrity.name}
                                </h2>
                                <a
                                    href={`/${locale}/celebrity/${celebrity.slug}`}
                                    className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0"
                                >
                                    View all →
                                </a>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {moreByCeleb.map((v) => (
                                    <VideoCard key={v.id} video={v} locale={locale} />
                                ))}
                            </div>
                        </section>
                    )}

                    {/* ── 5b. More from Movie ── */}
                    {moreByMovie.length > 0 && video.movie && (
                        <section>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-sm font-semibold text-white truncate mr-2">
                                    More from {movieTitle}
                                </h2>
                                <a
                                    href={`/${locale}/movie/${video.movie.slug}`}
                                    className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0"
                                >
                                    View all →
                                </a>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {moreByMovie.map((v) => (
                                    <VideoCard key={v.id} video={v} locale={locale} />
                                ))}
                            </div>
                        </section>
                    )}

                    {/* If no "More from" sections exist, show similar in sidebar instead */}
                    {moreByCeleb.length === 0 && moreByMovie.length === 0 && filteredSimilar.length > 0 && (
                        <section>
                            <h2 className="text-sm font-semibold text-white mb-3">Similar Scenes</h2>
                            <div className="grid grid-cols-2 gap-2">
                                {filteredSimilar.slice(0, 6).map((v) => (
                                    <VideoCard key={v.id} video={v} locale={locale} />
                                ))}
                            </div>
                        </section>
                    )}
                </aside>
            </div>

            {/* ── 6. Similar Scenes — full width below two-column ── */}
            {(moreByCeleb.length > 0 || moreByMovie.length > 0) && filteredSimilar.length > 0 && (
                <section className="mt-8 pt-6 border-t border-gray-800/50">
                    <h2 className="text-lg font-semibold text-white mb-4">Similar Scenes</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {filteredSimilar.map((v) => (
                            <VideoCard key={v.id} video={v} locale={locale} />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
