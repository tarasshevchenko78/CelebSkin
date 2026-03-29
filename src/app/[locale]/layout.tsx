import type { Metadata } from 'next';
import '../globals.css';
import { type SupportedLocale } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import BottomNav from '@/components/BottomNav';
import AgeGate from '@/components/AgeGate';
import CookieConsent from '@/components/CookieConsent';
import AuthProvider from '@/components/AuthProvider';

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
        alternates: buildAlternates(locale),
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

    return (
        <html lang={locale} className="dark">
            <head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link
                    href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
                    rel="stylesheet"
                />
            </head>
            <body className="min-h-screen bg-brand-bg text-brand-text font-sans antialiased flex flex-col overflow-x-hidden">
                <AuthProvider locale={locale}>
                    <AgeGate />
                    <Header locale={locale} />
                    <main className="flex-1 pb-16 md:pb-0">{children}</main>
                    <Footer locale={locale} />
                    <BottomNav />
                    <CookieConsent />
                </AuthProvider>
            </body>
        </html>
    );
}
