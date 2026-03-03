import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';
import { getVideos } from '@/lib/db';
import type { Video, PaginatedResult } from '@/lib/types';
import VideoCard from '@/components/VideoCard';

export const dynamic = 'force-dynamic';

const titles: Record<string, string> = {
    en: 'All Videos', ru: 'Все видео', de: 'Alle Videos', fr: 'Toutes les vidéos',
    es: 'Todos los videos', pt: 'Todos os vídeos', it: 'Tutti i video',
    pl: 'Wszystkie filmy', nl: "Alle video's", tr: 'Tüm Videolar',
};
const descriptions: Record<string, string> = {
    en: 'Browse all celebrity nude scenes from movies and TV shows. Filter by latest, most viewed or top rated.',
    ru: 'Все откровенные сцены знаменитостей из фильмов и сериалов. Сортировка по дате, просмотрам и рейтингу.',
    de: 'Alle Nacktszenen von Prominenten aus Filmen und Serien durchsuchen.',
    fr: 'Parcourez toutes les scènes nues de célébrités dans les films et séries.',
    es: 'Explora todas las escenas de desnudos de celebridades en películas y series.',
    pt: 'Navegue por todas as cenas de nudez de celebridades em filmes e séries.',
    it: 'Sfoglia tutte le scene di nudo di celebrità da film e serie TV.',
    pl: 'Przeglądaj wszystkie nagie sceny celebrytów z filmów i seriali.',
    nl: 'Blader door alle naaktscènes van beroemdheden uit films en series.',
    tr: 'Film ve dizilerden tüm ünlü çıplak sahnelerine göz atın.',
};
const sortLabels: Record<string, Record<string, string>> = {
    latest: { en: 'Latest', ru: 'Новые' },
    views: { en: 'Most Viewed', ru: 'Популярные' },
    rated: { en: 'Top Rated', ru: 'С рейтингом' },
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: `${titles[locale] || titles.en} — CelebSkin`,
        description: descriptions[locale] || descriptions.en,
        alternates: { languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}/video`])) },
    };
}

export default async function VideosPage({
    params,
    searchParams,
}: {
    params: { locale: string };
    searchParams: { sort?: string; page?: string };
}) {
    const locale = params.locale;
    const sort = searchParams.sort || 'latest';
    const page = parseInt(searchParams.page || '1');
    const perPage = 12;

    const sortMap: Record<string, string> = {
        latest: 'published_at',
        views: 'views_count',
        rated: 'created_at',
    };
    const orderBy = sortMap[sort] || 'published_at';

    let result: PaginatedResult<Video> = { data: [], total: 0, page: 1, limit: perPage, totalPages: 0 };
    try {
        result = await getVideos(page, perPage, orderBy);
    } catch (error) {
        console.error('[VideosPage] DB error:', error);
    }

    const videos = result.data;
    const totalPages = result.totalPages;

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold text-white">
                    {titles[locale] || titles.en}
                </h1>
                <div className="flex gap-1.5">
                    {Object.entries(sortLabels).map(([key, labels]) => (
                        <a
                            key={key}
                            href={`/${locale}/video?sort=${key}`}
                            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${sort === key
                                ? 'bg-brand-accent text-white'
                                : 'bg-brand-card text-brand-secondary border border-brand-border hover:bg-brand-hover'
                                }`}
                        >
                            {(labels as Record<string, string>)[locale] || labels.en}
                        </a>
                    ))}
                </div>
            </div>

            {videos.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {videos.map((video) => (
                        <VideoCard key={video.id} video={video} locale={locale} />
                    ))}
                </div>
            ) : (
                <p className="text-center text-brand-secondary py-12">No videos available yet.</p>
            )}

            {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-3">
                    {page > 1 && (
                        <a
                            href={`/${locale}/video?sort=${sort}&page=${page - 1}`}
                            className="px-4 py-2 text-sm rounded-lg bg-brand-card border border-brand-border text-brand-secondary hover:bg-brand-hover transition-colors"
                        >
                            ← Previous
                        </a>
                    )}
                    <span className="text-sm text-brand-secondary">
                        Page {page} of {totalPages}
                    </span>
                    {page < totalPages && (
                        <a
                            href={`/${locale}/video?sort=${sort}&page=${page + 1}`}
                            className="px-4 py-2 text-sm rounded-lg bg-brand-card border border-brand-border text-brand-secondary hover:bg-brand-hover transition-colors"
                        >
                            Next →
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
