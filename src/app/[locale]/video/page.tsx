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
    en: 'All Videos', ru: 'Все видео', de: 'Alle Videos', fr: 'Toutes les vidéos',
    es: 'Todos los vídeos', pt: 'Todos os vídeos', it: 'Tutti i video',
    pl: 'Wszystkie wideo', nl: "Alle video's", tr: 'Tüm Videolar',
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
    rated: 'rated',
    longest: 'duration_seconds',
};

// ============================================
// Metadata
// ============================================

const descriptions: Record<string, string> = {
    en: 'Celebrity nude scenes from movies and TV shows. Watch HD clips on CelebSkin.',
    ru: 'Обнажённые сцены знаменитостей из фильмов и сериалов. Смотрите HD клипы на CelebSkin.',
    de: 'Nacktszenen von Prominenten aus Filmen und Serien. HD-Clips auf CelebSkin.',
    fr: 'Scènes de nu de célébrités dans les films et séries. Clips HD sur CelebSkin.',
    es: 'Escenas de desnudos de celebridades en películas y series. Clips HD en CelebSkin.',
    pt: 'Cenas de nudez de celebridades em filmes e séries. Clips HD no CelebSkin.',
    it: 'Scene di nudo di celebrità in film e serie TV. Clip HD su CelebSkin.',
    pl: 'Nagie sceny celebrytów z filmów i seriali. Klipy HD na CelebSkin.',
    nl: 'Naaktscènes van beroemdheden uit films en series. HD-clips op CelebSkin.',
    tr: 'Film ve dizilerden ünlü çıplak sahneleri. CelebSkin\'de HD klipler.',
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    const title = `${titles[locale] || titles.en} — CelebSkin`;
    const description = descriptions[locale] || descriptions.en;
    return {
        title,
        description,
        alternates: buildAlternates(locale, '/video'),
        openGraph: {
            title,
            description,
            url: `https://celeb.skin/${locale}/video`,
            siteName: 'CelebSkin',
            type: 'website',
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
        },
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
    const perPage = 40;

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

    // Sort tabs (server-rendered <a> links)
    const sortTabs = Object.entries(sortLabels).map(([key, lbl]) => ({
        key,
        label: lbl[locale] || lbl.en,
        href: (() => {
            const p = new URLSearchParams();
            if (key !== 'latest') p.set('sort', key);
            if (tagSlug) p.set('tag', tagSlug);
            const qs = p.toString();
            return qs ? `/${locale}/video?${qs}` : `/${locale}/video`;
        })(),
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
            <div className="sticky top-[84px] md:top-[96px] z-40 -mx-4 px-4 bg-brand-bg/95 backdrop-blur-sm border-b border-brand-accent/20 shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
                {/* Sort tabs */}
                <div className="flex items-center gap-1 pt-1 pb-0 overflow-x-auto scrollbar-hide">
                    {sortTabs.map(({ key, label, href }) => (
                        <a
                            key={key}
                            href={href}
                            className={`shrink-0 px-3.5 py-1.5 text-sm font-medium transition-colors border-b-2 ${
                                sort === key
                                    ? 'text-brand-gold-light border-brand-accent'
                                    : 'text-gray-400 border-transparent hover:text-gray-200'
                            }`}
                        >
                            {label}
                        </a>
                    ))}
                </div>
                {/* Tag chips */}
                <div className="py-1">
                    <VideoCatalogFilters
                        tags={tagChips}
                        selectedTag={tagSlug}
                    />
                </div>
            </div>

            {/* ── SSR tag links for SEO (hidden visually, crawlable by Googlebot) ── */}
            <nav className="sr-only" aria-label="Tags">
                {allTags.map((t) => (
                    <a key={t.id} href={`/${locale}/tag/${t.slug}`}>
                        {getLocalizedField(t.name_localized, locale) || t.name}
                    </a>
                ))}
            </nav>

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
