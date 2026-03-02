import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';

const titles: Record<string, string> = {
    en: 'Movies — CelebSkin',
    ru: 'Фильмы — CelebSkin',
    de: 'Filme — CelebSkin',
    fr: 'Films — CelebSkin',
    es: 'Películas — CelebSkin',
    pt: 'Filmes — CelebSkin',
    it: 'Film — CelebSkin',
    pl: 'Filmy — CelebSkin',
    nl: 'Films — CelebSkin',
    tr: 'Filmler — CelebSkin',
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: titles[locale] || titles.en,
        alternates: {
            languages: Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `/${loc}/movie`])
            ),
        },
    };
}

export default function MoviesPage({ params }: { params: { locale: string } }) {
    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <h1 className="mb-8 text-3xl font-bold text-white">
                {titles[params.locale] || titles.en}
            </h1>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                    <div
                        key={i}
                        className="aspect-[2/3] rounded-xl border border-gray-800 bg-gray-900/50 flex flex-col items-center justify-center text-gray-600"
                    >
                        <span>Movie {i}</span>
                        <span className="text-xs text-gray-700 mt-1">2024</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
