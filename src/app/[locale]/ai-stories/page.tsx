import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';

const titles: Record<string, string> = {
    en: 'AI Stories', ru: 'AI Истории', de: 'AI Geschichten', fr: 'Histoires IA',
    es: 'Historias IA', pt: 'Histórias IA', it: 'Storie IA',
    pl: 'Historie AI', nl: 'AI Verhalen', tr: 'AI Hikayeler',
};

const subtitles: Record<string, string> = {
    en: 'AI-generated stories about your favorite celebrities. Coming soon!',
    ru: 'Истории о знаменитостях, созданные ИИ. Скоро!',
    de: 'KI-generierte Geschichten über deine Lieblingsstars. Kommt bald!',
    fr: 'Histoires générées par IA sur vos célébrités préférées. Bientôt !',
    es: 'Historias generadas por IA sobre tus celebridades favoritas. ¡Próximamente!',
    pt: 'Histórias geradas por IA sobre suas celebridades favoritas. Em breve!',
    it: 'Storie generate dall\'IA sulle tue celebrità preferite. In arrivo!',
    pl: 'Wygenerowane przez AI historie o Twoich ulubionych celebrytach. Wkrótce!',
    nl: 'AI-gegenereerde verhalen over je favoriete beroemdheden. Binnenkort!',
    tr: 'Favori ünlüleriniz hakkında AI tarafından oluşturulan hikayeler. Yakında!',
};

const badgeLabels: Record<string, string> = {
    en: 'Coming Soon', ru: 'Скоро', de: 'Kommt bald', fr: 'Bientôt',
    es: 'Próximamente', pt: 'Em breve', it: 'In arrivo',
    pl: 'Wkrótce', nl: 'Binnenkort', tr: 'Yakında',
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: `${titles[locale] || titles.en} — CelebSkin`,
        alternates: { languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}/ai-stories`])) },
    };
}

export default function AiStoriesPage({ params }: { params: { locale: string } }) {
    const locale = params.locale;

    return (
        <div className="mx-auto max-w-[1600px] px-4 py-20 text-center">
            {/* Book icon */}
            <svg className="w-16 h-16 text-brand-accent mx-auto mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>

            <span className="inline-block px-4 py-1.5 rounded-full bg-brand-accent text-white text-sm font-bold mb-4">
                {badgeLabels[locale] || badgeLabels.en}
            </span>

            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                {titles[locale] || titles.en}
            </h1>

            <p className="text-brand-secondary max-w-md mx-auto">
                {subtitles[locale] || subtitles.en}
            </p>
        </div>
    );
}
