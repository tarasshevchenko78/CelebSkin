import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';

const titles: Record<string, string> = {
    en: 'AI Chat', ru: 'AI Чат', de: 'AI Chat', fr: 'Chat IA',
    es: 'Chat IA', pt: 'Chat IA', it: 'Chat IA',
    pl: 'Czat AI', nl: 'AI Chat', tr: 'AI Sohbet',
};
const descriptions: Record<string, string> = {
    en: 'Chat with AI about your favorite celebrities on CelebSkin.',
    ru: 'Общайтесь с ИИ о ваших любимых знаменитостях на CelebSkin.',
    de: 'Chatte mit KI über deine Lieblingsstars auf CelebSkin.',
    fr: 'Discutez avec l\'IA de vos célébrités préférées sur CelebSkin.',
    es: 'Chatea con IA sobre tus celebridades favoritas en CelebSkin.',
    pt: 'Converse com IA sobre suas celebridades favoritas no CelebSkin.',
    it: 'Chatta con l\'IA sulle tue celebrità preferite su CelebSkin.',
    pl: 'Rozmawiaj z AI o swoich ulubionych celebrytach na CelebSkin.',
    nl: 'Chat met AI over je favoriete beroemdheden op CelebSkin.',
    tr: 'CelebSkin\'de favori ünlüleriniz hakkında AI ile sohbet edin.',
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: `${titles[locale] || titles.en} — CelebSkin`,
        description: descriptions[locale] || descriptions.en,
        alternates: {
            languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}/ai-chat`])),
        },
    };
}

export default function AiChatLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
