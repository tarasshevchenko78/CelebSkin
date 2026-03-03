import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';

const titles: Record<string, string> = {
    en: 'Search', ru: 'Поиск', de: 'Suche', fr: 'Recherche',
    es: 'Buscar', pt: 'Pesquisar', it: 'Cerca',
    pl: 'Szukaj', nl: 'Zoeken', tr: 'Arama',
};
const descriptions: Record<string, string> = {
    en: 'Search celebrities, movies and nude scenes on CelebSkin.',
    ru: 'Поиск знаменитостей, фильмов и откровенных сцен на CelebSkin.',
    de: 'Suchen Sie nach Prominenten, Filmen und Nacktszenen auf CelebSkin.',
    fr: 'Recherchez des célébrités, des films et des scènes nues sur CelebSkin.',
    es: 'Busca celebridades, películas y escenas de desnudos en CelebSkin.',
    pt: 'Pesquise celebridades, filmes e cenas de nudez no CelebSkin.',
    it: 'Cerca celebrità, film e scene di nudo su CelebSkin.',
    pl: 'Szukaj celebrytów, filmów i nagich scen na CelebSkin.',
    nl: 'Zoek beroemdheden, films en naaktscènes op CelebSkin.',
    tr: 'CelebSkin\'de ünlüleri, filmleri ve çıplak sahneleri arayın.',
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: `${titles[locale] || titles.en} — CelebSkin`,
        description: descriptions[locale] || descriptions.en,
        alternates: {
            languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}/search`])),
        },
    };
}

export default function SearchLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
