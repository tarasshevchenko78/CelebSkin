import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';

const pageTitles: Record<string, Record<string, string>> = {
    en: { title: 'CelebSkin — Home', description: 'Discover celebrity nude scenes from movies and TV shows' },
    ru: { title: 'CelebSkin — Главная', description: 'Откройте откровенные сцены знаменитостей из фильмов' },
    de: { title: 'CelebSkin — Startseite', description: 'Entdecken Sie Nacktszenen von Prominenten' },
    fr: { title: 'CelebSkin — Accueil', description: 'Découvrez les scènes nues de célébrités' },
    es: { title: 'CelebSkin — Inicio', description: 'Descubre escenas de desnudos de celebridades' },
    pt: { title: 'CelebSkin — Início', description: 'Descubra cenas de nudez de celebridades' },
    it: { title: 'CelebSkin — Home', description: 'Scopri scene di nudo di celebrità' },
    pl: { title: 'CelebSkin — Strona główna', description: 'Odkryj nagie sceny celebrytów' },
    nl: { title: 'CelebSkin — Home', description: 'Ontdek naaktscènes van beroemdheden' },
    tr: { title: 'CelebSkin — Ana Sayfa', description: 'Ünlülerin çıplak sahnelerini keşfedin' },
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    const meta = pageTitles[locale] || pageTitles.en;

    return {
        title: meta.title,
        description: meta.description,
        alternates: {
            languages: Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `/${loc}`])
            ),
        },
    };
}

export default function HomePage({ params }: { params: { locale: string } }) {
    const locale = params.locale;

    return (
        <div className="mx-auto max-w-7xl px-4 py-12">
            <section className="mb-16 text-center">
                <h1 className="mb-4 text-5xl font-bold bg-gradient-to-r from-pink-500 to-violet-500 bg-clip-text text-transparent">
                    CelebSkin
                </h1>
                <p className="text-xl text-gray-400">
                    {pageTitles[locale]?.description || pageTitles.en.description}
                </p>
            </section>

            <section className="mb-12">
                <h2 className="mb-6 text-2xl font-semibold text-white">Featured</h2>
                <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-12 text-center text-gray-500">
                    Featured video placeholder
                </div>
            </section>

            <section className="mb-12">
                <h2 className="mb-6 text-2xl font-semibold text-white">Latest Videos</h2>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div
                            key={i}
                            className="aspect-video rounded-xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-600"
                        >
                            Video {i}
                        </div>
                    ))}
                </div>
            </section>

            <section>
                <h2 className="mb-6 text-2xl font-semibold text-white">Trending Celebrities</h2>
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-5 lg:grid-cols-6">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div
                            key={i}
                            className="aspect-[3/4] rounded-xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-600"
                        >
                            Celebrity {i}
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
