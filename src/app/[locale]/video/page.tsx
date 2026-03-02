import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';

const titles: Record<string, string> = {
    en: 'All Videos — CelebSkin',
    ru: 'Все видео — CelebSkin',
    de: 'Alle Videos — CelebSkin',
    fr: 'Toutes les vidéos — CelebSkin',
    es: 'Todos los videos — CelebSkin',
    pt: 'Todos os vídeos — CelebSkin',
    it: 'Tutti i video — CelebSkin',
    pl: 'Wszystkie filmy — CelebSkin',
    nl: 'Alle video\'s — CelebSkin',
    tr: 'Tüm Videolar — CelebSkin',
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: titles[locale] || titles.en,
        alternates: {
            languages: Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `/${loc}/video`])
            ),
        },
    };
}

export default function VideosPage({ params }: { params: { locale: string } }) {
    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <h1 className="mb-8 text-3xl font-bold text-white">
                {titles[params.locale] || titles.en}
            </h1>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <div
                        key={i}
                        className="aspect-video rounded-xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-600"
                    >
                        Video {i}
                    </div>
                ))}
            </div>
        </div>
    );
}
