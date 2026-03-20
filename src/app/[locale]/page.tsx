import type { Metadata } from 'next';
import { type SupportedLocale, getLocalizedField, sceneLabel } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import { getLatestVideos, getPopularVideos, getTrendingCelebrities, getNewMovies, getAllTags, getFeaturedCollections, getTagCollections } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Video, Celebrity, Movie, Tag, Collection } from '@/lib/types';
import VideoSection from '@/components/VideoSection';
import MobileSearch from '@/components/MobileSearch';
import HScrollContainer from '@/components/HScrollContainer';

// ============================================
// Localized labels
// ============================================

const labels: Record<string, {
    newScenes: string;
    popularCelebs: string;
    popularVideos: string;
    collections: string;
    newMovies: string;
    viewAll: string;
    searchPlaceholder: string;
    scenes: string;
}> = {
    en: { newScenes: 'New Videos', popularCelebs: 'Popular Celebrities', popularVideos: 'Popular Videos', collections: 'Collections', newMovies: 'Movies', viewAll: 'View All', searchPlaceholder: 'Search celebrities, movies...', scenes: 'videos' },
    ru: { newScenes: 'Новые видео', popularCelebs: 'Популярные знаменитости', popularVideos: 'Популярные видео', collections: 'Коллекции', newMovies: 'Фильмы', viewAll: 'Все', searchPlaceholder: 'Поиск знаменитостей, фильмов...', scenes: 'видео' },
    de: { newScenes: 'Neue Videos', popularCelebs: 'Beliebte Prominente', popularVideos: 'Beliebte Videos', collections: 'Sammlungen', newMovies: 'Filme', viewAll: 'Alle', searchPlaceholder: 'Prominente, Filme suchen...', scenes: 'Videos' },
    fr: { newScenes: 'Nouvelles vidéos', popularCelebs: 'Célébrités populaires', popularVideos: 'Vidéos populaires', collections: 'Collections', newMovies: 'Films', viewAll: 'Tout voir', searchPlaceholder: 'Rechercher célébrités, films...', scenes: 'vidéos' },
    es: { newScenes: 'Nuevos vídeos', popularCelebs: 'Celebridades populares', popularVideos: 'Vídeos populares', collections: 'Colecciones', newMovies: 'Películas', viewAll: 'Ver todo', searchPlaceholder: 'Buscar celebridades, películas...', scenes: 'vídeos' },
    pt: { newScenes: 'Novos vídeos', popularCelebs: 'Celebridades populares', popularVideos: 'Vídeos populares', collections: 'Coleções', newMovies: 'Filmes', viewAll: 'Ver tudo', searchPlaceholder: 'Pesquisar celebridades, filmes...', scenes: 'vídeos' },
    it: { newScenes: 'Nuovi video', popularCelebs: 'Celebrità popolari', popularVideos: 'Video popolari', collections: 'Collezioni', newMovies: 'Film', viewAll: 'Vedi tutto', searchPlaceholder: 'Cerca celebrità, film...', scenes: 'video' },
    pl: { newScenes: 'Nowe wideo', popularCelebs: 'Popularne gwiazdy', popularVideos: 'Popularne wideo', collections: 'Kolekcje', newMovies: 'Filmy', viewAll: 'Wszystko', searchPlaceholder: 'Szukaj gwiazd, filmów...', scenes: 'wideo' },
    nl: { newScenes: "Nieuwe video's", popularCelebs: 'Populaire beroemdheden', popularVideos: "Populaire video's", collections: 'Collecties', newMovies: 'Films', viewAll: 'Alles', searchPlaceholder: 'Zoek beroemdheden, films...', scenes: "video's" },
    tr: { newScenes: 'Yeni Videolar', popularCelebs: 'Popüler Ünlüler', popularVideos: 'Popüler Videolar', collections: 'Koleksiyonlar', newMovies: 'Filmler', viewAll: 'Tümü', searchPlaceholder: 'Ünlü, film ara...', scenes: 'video' },
};

// ============================================
// Page metadata
// ============================================

const pageMeta: Record<string, { title: string; description: string }> = {
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
    const meta = pageMeta[locale] || pageMeta.en;
    return {
        title: meta.title,
        description: meta.description,
        alternates: buildAlternates(locale),
    };
}

// ============================================
// Section header — compact
// ============================================

function SectionHeader({ title, viewAllHref, viewAllLabel }: {
    title: string;
    viewAllHref?: string;
    viewAllLabel?: string;
}) {
    return (
        <div className="flex items-center gap-3 mb-3 mt-1">
            <h2 className="text-base font-semibold text-white tracking-wide uppercase whitespace-nowrap">{title}</h2>
            <div className="flex-1 h-px bg-brand-accent/30" />
            {viewAllHref && viewAllLabel && (
                <a href={viewAllHref} className="text-xs text-gray-500 hover:text-brand-gold-light transition-colors uppercase tracking-wider whitespace-nowrap">
                    {viewAllLabel} →
                </a>
            )}
        </div>
    );
}

// ============================================
// Page component
// ============================================

export default async function HomePage({ params }: { params: { locale: string } }) {
    const locale = params.locale;
    const t = labels[locale] || labels.en;

    let newSceneVideos: Video[] = [];
    let popularVideos: Video[] = [];
    let celebrities: Celebrity[] = [];
    const collections: Collection[] = [];
    let newMovies: Movie[] = [];
    let tags: Tag[] = [];

    try {
        const [latestVideos, popularVids, celebs, featuredCols, tagCols, movies, tags_] = await Promise.all([
            getLatestVideos(10),
            getPopularVideos(20),
            getTrendingCelebrities(20),
            getFeaturedCollections(50),
            getTagCollections(1),
            getNewMovies(40),
            getAllTags(8),
        ]);
        newSceneVideos = latestVideos;
        popularVideos = popularVids;
        celebrities = celebs;
        const seenIds = new Set<number>();
        for (const c of [...featuredCols, ...tagCols]) {
            if (!seenIds.has(c.id)) { seenIds.add(c.id); collections.push(c); }
        }
        newMovies = movies;
        tags = tags_;
    } catch (error) {
        logger.error('Home page DB query failed', { page: 'home', error: error instanceof Error ? error.message : String(error) });
    }

    const quickTags = tags.map((tag) => ({
        name: getLocalizedField(tag.name_localized, locale) || tag.name,
        slug: tag.slug,
    }));

    return (
        <div className="mx-auto max-w-[1600px] px-4 pt-2 pb-6 space-y-5">

            {/* Mobile search */}
            <MobileSearch locale={locale} placeholder={t.searchPlaceholder} quickTags={quickTags} />

            {/* ── 1. Popular Videos ── */}
            {popularVideos.length > 0 && (
                <section>
                    <SectionHeader title={t.popularVideos} viewAllHref={`/${locale}/video?sort=views`} viewAllLabel={t.viewAll} />

                    <VideoSection
                        initialVideos={popularVideos}
                        sort="popular"
                        loadMoreCount={20}
                        locale={locale}
                    />
                </section>
            )}

            {/* ── 2. New Scenes ── */}
            {newSceneVideos.length > 0 && (
                <section>
                    <SectionHeader title={t.newScenes} viewAllHref={`/${locale}/video`} viewAllLabel={t.viewAll} />

                    <VideoSection
                        initialVideos={newSceneVideos}
                        sort="newest"
                        loadMoreCount={10}
                        locale={locale}
                    />
                </section>
            )}

            {/* ── 3. Popular Celebrities — rectangular portrait cards ── */}
            {celebrities.length > 0 && (
                <section>
                    <SectionHeader title={t.popularCelebs} viewAllHref={`/${locale}/celebrity`} viewAllLabel={t.viewAll} />

                    <HScrollContainer>
                        {celebrities.map((celeb) => (
                            <a
                                key={celeb.id}
                                href={`/${locale}/celebrity/${celeb.slug}`}
                                className="shrink-0 group w-[160px]"
                                draggable={false}
                            >
                                <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-gray-900 border border-gray-800 group-hover:border-brand-accent transition-colors duration-200">
                                    {celeb.photo_url ? (
                                        <img
                                            src={celeb.photo_url}
                                            alt={celeb.name}
                                            loading="lazy"
                                            draggable={false}
                                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                        />
                                    ) : (
                                        <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                                            <span className="text-3xl text-gray-600">{celeb.name[0]}</span>
                                        </div>
                                    )}
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent pt-8 pb-2 px-2">
                                        <p className="text-sm font-medium text-white line-clamp-2 leading-tight group-hover:text-brand-gold-light transition-colors">
                                            {celeb.name}
                                        </p>
                                        {celeb.videos_count > 0 && (
                                            <span className="text-xs text-gray-400">{celeb.videos_count} {sceneLabel(celeb.videos_count, locale)}</span>
                                        )}
                                    </div>
                                </div>
                            </a>
                        ))}
                    </HScrollContainer>
                </section>
            )}

            {/* ── 4. Collections ── */}
            {collections.length > 0 && (
                <section>
                    <SectionHeader title={t.collections} viewAllHref={`/${locale}/collection`} viewAllLabel={t.viewAll} />

                    <HScrollContainer>
                        {collections.map((col) => {
                            const colTitle = getLocalizedField(col.title, locale) || col.slug;
                            return (
                                <a
                                    key={col.id}
                                    href={`/${locale}/collection/${col.slug}`}
                                    className="shrink-0 group w-[280px]"
                                    draggable={false}
                                >
                                    <div className="relative rounded-lg overflow-hidden bg-gray-800/30 border border-gray-800 group-hover:border-gray-600 transition-colors duration-200">
                                        <div className="h-[170px] relative overflow-hidden">
                                            {col.cover_url ? (
                                                <img
                                                    src={col.cover_url}
                                                    alt={colTitle}
                                                    loading="lazy"
                                                    draggable={false}
                                                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                />
                                            ) : (
                                                <div className="w-full h-full bg-gradient-to-br from-gray-900 to-gray-800" />
                                            )}
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                                            <div className="absolute bottom-0 left-0 right-0 p-2.5">
                                                <h3 className="text-sm font-semibold text-white line-clamp-1 group-hover:text-brand-gold-light transition-colors">
                                                    {colTitle}
                                                </h3>
                                                {col.videos_count > 0 && (
                                                    <span className="text-xs font-medium text-gray-300">{col.videos_count} {sceneLabel(col.videos_count, locale)}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </a>
                            );
                        })}
                    </HScrollContainer>
                </section>
            )}

            {/* ── 5. Movies ── */}
            {newMovies.length > 0 && (
                <section>
                    <SectionHeader title={t.newMovies} viewAllHref={`/${locale}/movie`} viewAllLabel={t.viewAll} />

                    <HScrollContainer>
                        {newMovies.map((movie) => {
                            const movieTitle = getLocalizedField(movie.title_localized, locale) || movie.title;
                            return (
                                <a
                                    key={movie.id}
                                    href={`/${locale}/movie/${movie.slug}`}
                                    className="shrink-0 group w-[150px]"
                                    draggable={false}
                                >
                                    <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[#111113] border border-gray-800 group-hover:border-gray-600 transition-colors duration-200">
                                        {movie.poster_url && (
                                            <img
                                                src={movie.poster_url}
                                                alt={movieTitle}
                                                loading="lazy"
                                                draggable={false}
                                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                            />
                                        )}
                                        {movie.year && (
                                            <span className="absolute top-1 left-1 bg-black/70 text-white text-[9px] font-medium px-1 py-0.5 rounded">
                                                {movie.year}
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-1.5 text-sm text-gray-400 group-hover:text-gray-200 transition-colors line-clamp-2 leading-tight">
                                        {movieTitle}
                                    </p>
                                </a>
                            );
                        })}
                    </HScrollContainer>
                </section>
            )}

            {/* Empty state */}
            {newSceneVideos.length === 0 && popularVideos.length === 0 && (
                <div className="py-12 text-center">
                    <p className="text-gray-500">Content is being prepared. Check back soon!</p>
                </div>
            )}
        </div>
    );
}
