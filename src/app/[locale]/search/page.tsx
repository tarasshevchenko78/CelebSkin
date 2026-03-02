import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';

const titles: Record<string, string> = {
    en: 'Search — CelebSkin',
    ru: 'Поиск — CelebSkin',
    de: 'Suche — CelebSkin',
    fr: 'Recherche — CelebSkin',
    es: 'Buscar — CelebSkin',
    pt: 'Pesquisar — CelebSkin',
    it: 'Cerca — CelebSkin',
    pl: 'Szukaj — CelebSkin',
    nl: 'Zoeken — CelebSkin',
    tr: 'Arama — CelebSkin',
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: titles[locale] || titles.en,
        alternates: {
            languages: Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `/${loc}/search`])
            ),
        },
    };
}

export default function SearchPage({ params }: { params: { locale: string } }) {
    const locale = params.locale;
    const placeholders: Record<string, string> = {
        en: 'Search celebrities, movies, videos...',
        ru: 'Поиск знаменитостей, фильмов, видео...',
        de: 'Suche nach Prominenten, Filmen, Videos...',
        fr: 'Rechercher des célébrités, films, vidéos...',
        es: 'Buscar celebridades, películas, videos...',
        pt: 'Pesquisar celebridades, filmes, vídeos...',
        it: 'Cerca celebrità, film, video...',
        pl: 'Szukaj celebrytów, filmów, wideo...',
        nl: 'Zoek beroemdheden, films, video\'s...',
        tr: 'Ünlü, film, video ara...',
    };

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <h1 className="mb-8 text-3xl font-bold text-white">
                {titles[locale] || titles.en}
            </h1>
            <div className="mb-8">
                <input
                    type="search"
                    placeholder={placeholders[locale] || placeholders.en}
                    className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
                />
            </div>
            <div className="text-center text-gray-500 py-12">
                Enter a search query to find celebrities, movies, and videos
            </div>
        </div>
    );
}
