import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocalizedField, getLocalizedSlug } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import { getVideoBySlug, getRelatedVideos, getOtherVideosByCelebrity, getOtherVideosByMovie, getAdjacentVideos } from '@/lib/db';
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

    const thumbnailUrl = video?.thumbnail_url || null;
    const videoUrl = video?.video_url_watermarked || video?.video_url || null;
    const pageUrl = `https://celeb.skin/${params.locale}/video/${params.slug}`;

    return {
        title: `${title} — CelebSkin`,
        description,
        alternates: buildAlternates(params.locale, `/video/${params.slug}`),
        openGraph: {
            title: `${title} — CelebSkin`,
            description: description || undefined,
            type: 'video.other',
            url: pageUrl,
            siteName: 'CelebSkin',
            ...(thumbnailUrl && { images: [{ url: thumbnailUrl, width: 1280, height: 720, alt: title }] }),
            ...(videoUrl && { videos: [{ url: videoUrl, type: 'video/mp4', width: 1920, height: 1080 }] }),
        },
        twitter: {
            card: 'summary_large_image',
            title: `${title} — CelebSkin`,
            description: description || undefined,
            ...(thumbnailUrl && { images: [thumbnailUrl] }),
        },
    };
}

// ============================================
// i18n
// ============================================

const moreFromLabel: Record<string, string> = {
    en: 'More from', ru: 'Ещё с', de: 'Mehr von', fr: 'Plus de',
    es: 'Más de', pt: 'Mais de', it: 'Altro di',
    pl: 'Więcej od', nl: 'Meer van', tr: 'Daha fazlası',
};

const viewAllLabel: Record<string, string> = {
    en: 'View all', ru: 'Все видео', de: 'Alle anzeigen', fr: 'Voir tout',
    es: 'Ver todo', pt: 'Ver tudo', it: 'Vedi tutto',
    pl: 'Zobacz wszystko', nl: 'Alles bekijken', tr: 'Tümünü gör',
};

const similarLabel: Record<string, string> = {
    en: 'Similar Scenes', ru: 'Похожие сцены', de: 'Ähnliche Szenen', fr: 'Scènes similaires',
    es: 'Escenas similares', pt: 'Cenas similares', it: 'Scene simili',
    pl: 'Podobne sceny', nl: 'Vergelijkbare scènes', tr: 'Benzer Sahneler',
};

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
        notFound();
    }

    const title = getLocalizedField(video.title, locale);
    const review = getLocalizedField(video.review, locale);
    const celebrity = video.celebrities?.[0];
    const movieTitle = video.movie
        ? (getLocalizedField(video.movie.title_localized, locale) || video.movie.title)
        : null;

    // Fetch related content + adjacent videos in parallel
    let similar: Video[] = [];
    let moreByCeleb: Video[] = [];
    let moreByMovie: Video[] = [];
    let prevSlug: string | null = null;
    let nextSlug: string | null = null;

    try {
        const [sim, celeb, movie, adjacent] = await Promise.all([
            getRelatedVideos(video.id, locale, 20),
            celebrity
                ? getOtherVideosByCelebrity(celebrity.id, video.id, 6)
                : Promise.resolve([]),
            video.movie
                ? getOtherVideosByMovie(video.movie.id, video.id, 4)
                : Promise.resolve([]),
            video.published_at
                ? getAdjacentVideos(video.published_at, locale)
                : Promise.resolve({ prevSlug: null, nextSlug: null }),
        ]);
        similar     = sim;
        moreByCeleb = celeb;
        moreByMovie = movie;
        prevSlug    = adjacent.prevSlug;  // ← = older (published_at < current)
        nextSlug    = adjacent.nextSlug;  // → = newer (published_at > current)
    } catch (error) {
        logger.error('Video detail related content error', { page: 'video/detail', error: error instanceof Error ? error.message : String(error) });
    }

    // Filter similar to exclude videos already in "More from" sections
    const moreIds = new Set([...moreByCeleb.map(v => v.id), ...moreByMovie.map(v => v.id)]);
    const filteredSimilar = similar.filter(v => !moreIds.has(v.id));

    // Fallback nextSlug for the newest video (no newer adjacent exists)
    if (!nextSlug) {
        const fallback = moreByCeleb[0] || filteredSimilar[0];
        if (fallback) nextSlug = getLocalizedSlug(fallback.slug, locale);
    }

    // JSON-LD structured data
    const thumbUrl = video.thumbnail_url || (video.screenshots?.[0] as {url?: string})?.url || 'https://celeb.skin/og-default.jpg';
    const videoLd = title ? {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: title,
        description: getLocalizedField(video.seo_description, locale) || review || '',
        thumbnailUrl: thumbUrl,
        ...(video.published_at && { uploadDate: new Date(video.published_at).toISOString() }),
        ...(video.duration_seconds && { duration: formatDurationISO(video.duration_seconds) }),
        ...((video.video_url_watermarked || video.video_url) && { contentUrl: video.video_url_watermarked || video.video_url }),
        embedUrl: `https://celeb.skin/${locale}/video/${params.slug}`,
        inLanguage: locale,
        publisher: { '@type': 'Organization', name: 'CelebSkin', url: 'https://celeb.skin' },
        interactionStatistic: {
            '@type': 'InteractionCounter',
            interactionType: { '@type': 'WatchAction' },
            userInteractionCount: video.views_count || 0,
        },
    } : null;

    // BreadcrumbList JSON-LD
    const breadcrumbLd = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `https://celeb.skin/${locale}` },
            { '@type': 'ListItem', position: 2, name: 'Videos', item: `https://celeb.skin/${locale}/video` },
            ...(celebrity ? [{ '@type': 'ListItem', position: 3, name: celebrity.name, item: `https://celeb.skin/${locale}/celebrity/${celebrity.slug}` }] : []),
            { '@type': 'ListItem', position: celebrity ? 4 : 3, name: title },
        ],
    };

    return (
        <div className="mx-auto max-w-6xl px-4 py-4 md:py-6">
            {videoLd && <JsonLd data={videoLd} />}
            <JsonLd data={breadcrumbLd} />

            {/* ── 1. Video Player — edge-to-edge on mobile ── */}
            <div className="-mx-4 md:mx-0 [&>div]:rounded-none md:[&>div]:rounded-xl">
                {(video.video_url_watermarked || video.video_url) ? (
                    <VideoPlayer
                        key={video.id}
                        src={video.video_url_watermarked || video.video_url}
                        poster={video.thumbnail_url}
                        title={title}
                        durationSeconds={video.duration_seconds || undefined}
                        hotMoments={video.hot_moments || []}
                        screenshots={video.screenshots || []}
                        relatedVideos={[...moreByCeleb, ...filteredSimilar].slice(0, 20)}
                        prevSlug={prevSlug}
                        nextSlug={nextSlug}
                        locale={locale}
                        initialSlug={params.slug}
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
                        durationSeconds={video.duration_seconds || undefined}
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

                    {/* ── 3. Tags (canonical only) ── */}
                    {video.tags && video.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mt-5 pt-5 border-t border-gray-800/50">
                            {video.tags.map((tag) => (
                                <a
                                    key={`tag-${tag.id}`}
                                    href={`/${locale}/tag/${tag.slug}`}
                                    className="px-2 py-0.5 rounded-full text-xs bg-gray-800/50 text-gray-400 border border-gray-700 hover:border-red-600 hover:text-red-400 transition-colors"
                                >
                                    {getLocalizedField(tag.name_localized, locale) || tag.name}
                                </a>
                            ))}
                        </div>
                    ) : null}

                    {/* ── 3b. Collections ── */}
                    {video.collections && video.collections.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                            {video.collections.map((col) => (
                                <a
                                    key={col.id}
                                    href={`/${locale}/collection/${col.slug}`}
                                    className="px-2.5 py-1 rounded-full text-xs bg-red-900/30 text-red-300 border border-red-800/50 hover:border-red-500 hover:text-red-200 transition-colors"
                                >
                                    {getLocalizedField(col.title, locale) || col.slug}
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

                    {/* ── 5a. More from Celebrity (sidebar — up to 4) ── */}
                    {moreByCeleb.length > 0 && celebrity && (
                        <section>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-sm font-semibold text-white truncate mr-2">
                                    {moreFromLabel[locale] || moreFromLabel.en} {celebrity.name}
                                </h2>
                                <a
                                    href={`/${locale}/celebrity/${celebrity.slug}`}
                                    className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0"
                                >
                                    {viewAllLabel[locale] || viewAllLabel.en} →
                                </a>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {moreByCeleb.slice(0, 4).map((v) => (
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
                            <h2 className="text-sm font-semibold text-white mb-3">{similarLabel[locale] || similarLabel.en}</h2>
                            <div className="grid grid-cols-2 gap-2">
                                {filteredSimilar.slice(0, 6).map((v) => (
                                    <VideoCard key={v.id} video={v} locale={locale} />
                                ))}
                            </div>
                        </section>
                    )}
                </aside>
            </div>

            {/* ── 6a. More from Celebrity — full width ── */}
            {moreByCeleb.length > 0 && celebrity && (
                <section className="mt-8 pt-6 border-t border-gray-800/50">
                    <div className="flex items-center gap-2 mb-4">
                        <h2 className="text-lg font-semibold text-white">
                            {moreFromLabel[locale] || moreFromLabel.en}
                        </h2>
                        <a
                            href={`/${locale}/celebrity/${celebrity.slug}`}
                            className="text-lg font-semibold text-brand-gold-light hover:text-brand-accent transition-colors"
                        >
                            {celebrity.name} →
                        </a>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {moreByCeleb.map((v) => (
                            <VideoCard key={v.id} video={v} locale={locale} />
                        ))}
                    </div>
                </section>
            )}

            {/* ── 6b. Similar Scenes — full width below two-column ── */}
            {filteredSimilar.length > 0 && (moreByCeleb.length > 0 || moreByMovie.length > 0) && (
                <section className="mt-8 pt-6 border-t border-gray-800/50">
                    <h2 className="text-lg font-semibold text-white mb-4">{similarLabel[locale] || similarLabel.en}</h2>
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
