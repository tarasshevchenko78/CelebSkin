import type { Metadata } from 'next';
import '../globals.css';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';

export async function generateMetadata({
    params,
}: {
    params: { locale: string };
}): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    const titles: Record<string, string> = {
        en: 'CelebSkin — Celebrity Nude Scenes from Movies & TV Shows',
        ru: 'CelebSkin — Откровенные сцены знаменитостей из фильмов и сериалов',
        de: 'CelebSkin — Nacktszenen von Prominenten aus Filmen & Serien',
        fr: 'CelebSkin — Scènes nues de célébrités dans les films et séries',
        es: 'CelebSkin — Escenas de desnudos de celebridades en películas y series',
        pt: 'CelebSkin — Cenas de nudez de celebridades em filmes e séries',
        it: 'CelebSkin — Scene di nudo di celebrità da film e serie TV',
        pl: 'CelebSkin — Nagie sceny celebrytów z filmów i seriali',
        nl: 'CelebSkin — Naaktscènes van beroemdheden uit films en series',
        tr: 'CelebSkin — Film ve dizilerden ünlülerin çıplak sahneleri',
    };

    return {
        title: titles[locale] || titles.en,
        alternates: {
            languages: Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `/${loc}`])
            ),
        },
    };
}

export default function LocaleLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: { locale: string };
}) {
    const locale = params.locale;
    const dir = locale === 'ar' ? 'rtl' : 'ltr';

    return (
        <html lang={locale} dir={dir} className="dark">
            <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
                <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm">
                    <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
                        <a href={`/${locale}`} className="text-xl font-bold text-white">
                            CelebSkin
                        </a>
                        <div className="flex items-center gap-6">
                            <a href={`/${locale}/video`} className="text-gray-300 hover:text-white transition-colors">
                                Videos
                            </a>
                            <a href={`/${locale}/celebrity`} className="text-gray-300 hover:text-white transition-colors">
                                Celebrities
                            </a>
                            <a href={`/${locale}/movie`} className="text-gray-300 hover:text-white transition-colors">
                                Movies
                            </a>
                            <a href={`/${locale}/search`} className="text-gray-300 hover:text-white transition-colors">
                                Search
                            </a>
                        </div>
                    </nav>
                </header>
                <main>{children}</main>
                <footer className="mt-auto border-t border-gray-800 py-8 text-center text-sm text-gray-500">
                    <p>© {new Date().getFullYear()} CelebSkin. All rights reserved.</p>
                </footer>
            </body>
        </html>
    );
}
