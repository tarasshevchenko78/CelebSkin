import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';
import { mockVideos } from '@/lib/mockData';
import VideoCard from '@/components/VideoCard';

const titles: Record<string, string> = {
    en: 'All Videos', ru: 'Все видео', de: 'Alle Videos', fr: 'Toutes les vidéos',
    es: 'Todos los videos', pt: 'Todos os vídeos', it: 'Tutti i video',
    pl: 'Wszystkie filmy', nl: "Alle video's", tr: 'Tüm Videolar',
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
        alternates: { languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}/video`])) },
    };
}

export default function VideosPage({
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

    const sorted = [...mockVideos];
    if (sort === 'views') sorted.sort((a, b) => b.views_count - a.views_count);
    else if (sort === 'rated') sorted.sort((a, b) => b.likes_count - a.likes_count);

    const total = sorted.length;
    const totalPages = Math.ceil(total / perPage);
    const videos = sorted.slice((page - 1) * perPage, page * perPage);

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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {videos.map((video) => (
                    <VideoCard key={video.id} video={video} locale={locale} />
                ))}
            </div>

            {/* Pagination */}
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
