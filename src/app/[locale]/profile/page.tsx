import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getFavoriteVideos, getFavoriteCelebrities } from '@/lib/db/users';
import { logger } from '@/lib/logger';
import type { Video, Celebrity } from '@/lib/types';
import VideoCard from '@/components/VideoCard';
import ProfileClient from './ProfileClient';

// ============================================
// i18n
// ============================================

const profileLabel: Record<string, string> = {
    en: 'My Profile', ru: 'Мой профиль', de: 'Mein Profil', fr: 'Mon profil',
    es: 'Mi perfil', pt: 'Meu perfil', it: 'Il mio profilo',
    pl: 'Mój profil', nl: 'Mijn profiel', tr: 'Profilim',
};
const savedVideosLabel: Record<string, string> = {
    en: 'Saved Videos', ru: 'Сохранённые видео', de: 'Gespeicherte Videos', fr: 'Vidéos sauvegardées',
    es: 'Videos guardados', pt: 'Vídeos salvos', it: 'Video salvati',
    pl: 'Zapisane filmy', nl: 'Opgeslagen video\'s', tr: 'Kaydedilen videolar',
};
const savedCelebsLabel: Record<string, string> = {
    en: 'Saved Celebrities', ru: 'Сохранённые знаменитости', de: 'Gespeicherte Prominente', fr: 'Célébrités sauvegardées',
    es: 'Celebridades guardadas', pt: 'Celebridades salvas', it: 'Celebrità salvate',
    pl: 'Zapisane celebrytki', nl: 'Opgeslagen beroemdheden', tr: 'Kaydedilen ünlüler',
};
const emptyLabel: Record<string, string> = {
    en: 'Nothing saved yet', ru: 'Ничего не сохранено', de: 'Noch nichts gespeichert', fr: 'Rien de sauvegardé',
    es: 'Nada guardado aún', pt: 'Nada salvo ainda', it: 'Niente salvato',
    pl: 'Nic nie zapisano', nl: 'Nog niets opgeslagen', tr: 'Henüz hiçbir şey kaydedilmedi',
};

// ============================================
// Page (server component — reads cookie)
// ============================================

export default async function ProfilePage({ params }: { params: { locale: string } }) {
    const { locale } = params;

    const session = getSessionUser();
    if (!session) {
        redirect(`/${locale}`);
    }

    let videos: Video[] = [];
    let celebrities: Celebrity[] = [];

    try {
        [videos, celebrities] = await Promise.all([
            getFavoriteVideos(session.userId),
            getFavoriteCelebrities(session.userId),
        ]);
    } catch (e) {
        logger.error('Profile page DB error', { error: e instanceof Error ? e.message : String(e) });
    }

    return (
        <div className="mx-auto max-w-[1400px] px-4 py-6 md:py-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-white">
                        {profileLabel[locale] || profileLabel.en}
                    </h1>
                    <p className="text-brand-secondary mt-1">@{session.username}</p>
                </div>
                <ProfileClient />
            </div>

            {/* Saved Videos */}
            <section className="mb-8">
                <h2 className="text-lg font-semibold text-white mb-4">
                    {savedVideosLabel[locale] || savedVideosLabel.en}
                    {videos.length > 0 && (
                        <span className="ml-2 text-sm font-normal text-brand-secondary">({videos.length})</span>
                    )}
                </h2>
                {videos.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                        {videos.map(v => (
                            <VideoCard key={v.id} video={v} locale={locale} />
                        ))}
                    </div>
                ) : (
                    <p className="text-brand-secondary text-sm">{emptyLabel[locale] || emptyLabel.en}</p>
                )}
            </section>

            {/* Saved Celebrities */}
            <section>
                <h2 className="text-lg font-semibold text-white mb-4">
                    {savedCelebsLabel[locale] || savedCelebsLabel.en}
                    {celebrities.length > 0 && (
                        <span className="ml-2 text-sm font-normal text-brand-secondary">({celebrities.length})</span>
                    )}
                </h2>
                {celebrities.length > 0 ? (
                    <div className="flex flex-wrap gap-3">
                        {celebrities.map(c => (
                            <a
                                key={c.id}
                                href={`/${locale}/celebrity/${c.slug}`}
                                className="flex flex-col items-center gap-1.5 group"
                            >
                                <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-brand-accent/30 group-hover:border-brand-accent transition-colors">
                                    {c.photo_url ? (
                                        <img src={c.photo_url} alt={c.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full bg-gray-800 flex items-center justify-center text-brand-secondary text-xl font-bold">
                                            {c.name.slice(0, 1).toUpperCase()}
                                        </div>
                                    )}
                                </div>
                                <span className="text-xs text-brand-secondary group-hover:text-brand-gold-light transition-colors text-center max-w-[72px] truncate">
                                    {c.name.split(' ')[0]}
                                </span>
                            </a>
                        ))}
                    </div>
                ) : (
                    <p className="text-brand-secondary text-sm">{emptyLabel[locale] || emptyLabel.en}</p>
                )}
            </section>
        </div>
    );
}
