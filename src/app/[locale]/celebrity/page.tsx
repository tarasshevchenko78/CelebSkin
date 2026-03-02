import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';

const titles: Record<string, string> = {
    en: 'Celebrities — CelebSkin',
    ru: 'Знаменитости — CelebSkin',
    de: 'Prominente — CelebSkin',
    fr: 'Célébrités — CelebSkin',
    es: 'Celebridades — CelebSkin',
    pt: 'Celebridades — CelebSkin',
    it: 'Celebrità — CelebSkin',
    pl: 'Celebryci — CelebSkin',
    nl: 'Beroemdheden — CelebSkin',
    tr: 'Ünlüler — CelebSkin',
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: titles[locale] || titles.en,
        alternates: {
            languages: Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `/${loc}/celebrity`])
            ),
        },
    };
}

export default function CelebritiesPage({ params }: { params: { locale: string } }) {
    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <h1 className="mb-8 text-3xl font-bold text-white">
                {titles[params.locale] || titles.en}
            </h1>
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
                    <div
                        key={i}
                        className="aspect-[3/4] rounded-xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-600"
                    >
                        Celebrity {i}
                    </div>
                ))}
            </div>
        </div>
    );
}
