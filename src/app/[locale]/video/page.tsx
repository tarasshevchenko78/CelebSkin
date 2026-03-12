import type { Metadata } from 'next';
import { type SupportedLocale, getLocalizedField } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import { getVideos, getAllTags } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Video, PaginatedResult } from '@/lib/types';
import VideoCard from '@/components/VideoCard';
import VideoCatalogFilters from '@/components/VideoCatalogFilters';

// ============================================
// i18n labels
// ============================================

const titles: Record<string, string> = {
    en: 'All Scenes', ru: 'Все сцены', de: 'Alle Szenen', fr: 'Toutes les scènes',
    es: 'Todas las escenas', pt: 'Todas as cenas', it: 'Tutte le scene',
    pl: 'Wszystkie sceny', nl: 'Alle scènes', tr: 'Tüm Sahneler',
};

const sortLabels: Record<string, Record<string, string>> = {
    latest: { en: 'Newest', ru: 'Новые', de: 'Neueste', fr: 'Récentes', es: 'Recientes', pt: 'Recentes', it: 'Recenti', pl: 'Najnowsze', nl: 'Nieuwste', tr: 'En Yeni' },
    views: { en: 'Most Viewed', ru: 'Популярные', de: 'Meistgesehen', fr: 'Plus vues', es: 'Más vistas', pt: 'Mais vistas', it: 'Più viste', pl: 'Najpopularniejsze', nl: 'Meest bekeken', tr: 'En Çok İzlenen' },
    rated: { en: 'Top Rated', ru: 'Лучшие', de: 'Bestbewertet', fr: 'Mieux notées', es: 'Mejor valoradas', pt: 'Melhor avaliadas', it: 'Più votate', pl: 'Najlepsze', nl: 'Best beoordeeld', tr: 'En Beğenilen' },
    longest: { en: 'Longest', ru: 'Длинные', de: 'Längste', fr: 'Plus longues', es: 'Más largas', pt: 'Mais longas', it: 'Più lunghe', pl: 'Najdłuższe', nl: 'Langste', tr: 'En Uzun' },
};

const scenesLabel: Record<string, string> = {
    en: 'scenes', ru: 'сцен', de: 'Szenen', fr: 'scènes',
    es: 'escenas', pt: 'cenas', it: 'scene',
    pl: 'scen', nl: 'scènes', tr: 'sahne',
};

// ============================================
// Sort mapping
// ============================================

const sortMap: Record<string, string> = {
    latest: 'published_at',
    views: 'views_count',
    rated: 'likes_count',
    longest: 'duration_seconds',
};

// ============================================
// Metadata
// ============================================

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: `${titles[locale] || titles.en} — CelebSkin`,
        alternates: buildAlternates(locale, '/video'),
    };
}

// ============================================
// Page
// ============================================

export default async function VideosPage({
    params,
    searchParams,
}: {
    params: { locale: string };
    searchParams: { sort?: string; tag?: string; page?: string };
}) {
    const locale = params.locale;
    const sort = searchParams.sort || 'latest';
    const tagSlug = searchParams.tag || '';
    const page = Math.max(1, parseInt(searchParams.page || '1') || 1);
    const perPage = 20;

    const orderBy = sortMap[sort] || 'published_at';

    // Fetch videos + tags in parallel
    let result: PaginatedResult<Video> = { data: [], total: 0, page: 1, limit: perPage, totalPages: 0 };
    let allTags: Array<{ id: number; name: string; name_localized: Record<string, string>; slug: string; videos_count: number }> = [];

    try {
        [result, allTags] = await Promise.all([
            getVideos(page, perPage, orderBy, tagSlug || undefined),
            getAllTags(40),
        ]);
    } catch (error) {
        logger.error('Videos page DB error', { page: 'videos', error: error instanceof Error ? error.message : String(error) });
    }

    const videos = result.data;
    const totalPages = result.totalPages;

    // Build tag chips for FilterBar
    const tagChips = allTags.map((t) => ({
        label: getLocalizedField(t.name_localized, locale) || t.name,
        value: t.slug,
        count: t.videos_count,
    }));

    // Build sort options for FilterBar
    const sortOptions = Object.entries(sortLabels).map(([key, labels]) => ({
        label: labels[locale] || labels.en,
        value: key,
    }));

    // Active tag name (for result count label)
    const activeTag = tagSlug ? allTags.find(t => t.slug === tagSlug) : null;
    const activeTagName = activeTag
        ? (getLocalizedField(activeTag.name_localized, locale) || activeTag.name)
        : null;

    // Build pagination URL helper
    const buildPageUrl = (p: number) => {
        const params = new URLSearchParams();
        if (sort && sort !== 'latest') params.set('sort', sort);
        if (tagSlug) params.set('tag', tagSlug);
        if (p > 1) params.set('page', String(p));
        const qs = params.toString();
        return qs ? `/${locale}/video?${qs}` : `/${locale}/video`;
    };

    return (
        <div className="mx-auto max-w-[1600px] px-4 py-4 md:py-6">

            {/* ── Header ── */}
            <div className="mb-4">
                <h1 className="text-xl sm:text-2xl font-bold text-white">
                    {titles[locale] || titles.en}
                </h1>
            </div>

            {/* ── Sticky Filter Bar ── */}
            <div className="sticky top-14 z-10 -mx-4 px-4 py-2.5 bg-[#08060a]/95 backdrop-blur-sm border-b border-gray-800/50">
                <VideoCatalogFilters
                    tags={tagChips}
                    sortOptions={sortOptions}
                    selectedTag={tagSlug}
                    selectedSort={sort}
                />
            </div>

            {/* ── Result count ── */}
            <div className="mt-4 mb-3">
                <p className="text-sm text-gray-500">
                    {result.total} {scenesLabel[locale] || scenesLabel.en}
                    {activeTagName && (
                        <span className="text-gray-400"> &mdash; {activeTagName}</span>
                    )}
                </p>
            </div>

            {/* ── Video Grid ── */}
            {videos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {videos.map((video) => (
                        <VideoCard key={video.id} video={video} locale={locale} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-20">
                    <p className="text-gray-500 text-base">
                        {locale === 'ru' ? 'Сцены не найдены' : 'No scenes found'}
                    </p>
                    {tagSlug && (
                        <a
                            href={`/${locale}/video`}
                            className="inline-block mt-3 text-sm text-red-400 hover:text-red-300 transition-colors"
                        >
                            {locale === 'ru' ? '← Показать все' : '← Show all'}
                        </a>
                    )}
                </div>
            )}

            {/* ── Pagination ── */}
            {totalPages > 1 && (
                <nav className="mt-8 flex items-center justify-center gap-1.5" aria-label="Pagination">
                    {/* Previous */}
                    {page > 1 ? (
                        <a
                            href={buildPageUrl(page - 1)}
                            className="px-3 py-1.5 text-sm rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                        >
                            ←
                        </a>
                    ) : (
                        <span className="px-3 py-1.5 text-sm rounded-lg bg-gray-800/50 text-gray-600 cursor-not-allowed">
                            ←
                        </span>
                    )}

                    {/* Page numbers */}
                    {generatePageNumbers(page, totalPages).map((p, i) =>
                        p === '...' ? (
                            <span key={`ellipsis-${i}`} className="px-2 py-1.5 text-sm text-gray-600">
                                …
                            </span>
                        ) : (
                            <a
                                key={p}
                                href={buildPageUrl(p as number)}
                                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                    p === page
                                        ? 'bg-red-600 text-white font-medium'
                                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                                }`}
                            >
                                {p}
                            </a>
                        )
                    )}

                    {/* Next */}
                    {page < totalPages ? (
                        <a
                            href={buildPageUrl(page + 1)}
                            className="px-3 py-1.5 text-sm rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                        >
                            →
                        </a>
                    ) : (
                        <span className="px-3 py-1.5 text-sm rounded-lg bg-gray-800/50 text-gray-600 cursor-not-allowed">
                            →
                        </span>
                    )}
                </nav>
            )}
        </div>
    );
}

// ============================================
// Pagination helper — generates page numbers with ellipsis
// ============================================

function generatePageNumbers(current: number, total: number): (number | '...')[] {
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages: (number | '...')[] = [1];

    if (current > 3) {
        pages.push('...');
    }

    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    for (let i = start; i <= end; i++) {
        pages.push(i);
    }

    if (current < total - 2) {
        pages.push('...');
    }

    pages.push(total);

    return pages;
}
