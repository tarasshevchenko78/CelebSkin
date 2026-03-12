import type { Metadata } from 'next';
import { type SupportedLocale } from '@/lib/i18n';
import { getLocalizedField } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import { getLatestVideos, getTrendingCelebrities, getMovies, getAllTags, getFeaturedCollections } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Video, Celebrity, Movie, Tag, Collection } from '@/lib/types';
import VideoCard from '@/components/VideoCard';
import CelebrityCard from '@/components/CelebrityCard';
import MobileSearch from '@/components/MobileSearch';
import GoldDivider from '@/components/GoldDivider';


// ============================================
// Section titles (localized)
// ============================================

const sectionTitles: Record<string, {
    trending: string; latest: string; movies: string; viewAll: string;
    newScenes: string; tags: string; searchPlaceholder: string;
}> = {
    en: { trending: 'Trending Celebrities', latest: 'Latest Videos', movies: 'Popular Movies', viewAll: 'View All', newScenes: 'New Scenes', tags: 'Browse by Tag', searchPlaceholder: 'Search celebrities, movies...' },
    ru: { trending: 'Популярные знаменитости', latest: 'Новые видео', movies: 'Популярные фильмы', viewAll: 'Смотреть все', newScenes: 'Новые сцены', tags: 'По тегам', searchPlaceholder: 'Поиск знаменитостей, фильмов...' },
    de: { trending: 'Beliebte Prominente', latest: 'Neueste Videos', movies: 'Beliebte Filme', viewAll: 'Alle anzeigen', newScenes: 'Neue Szenen', tags: 'Nach Tag durchsuchen', searchPlaceholder: 'Prominente, Filme suchen...' },
    fr: { trending: 'Célébrités tendances', latest: 'Dernières vidéos', movies: 'Films populaires', viewAll: 'Voir tout', newScenes: 'Nouvelles scènes', tags: 'Parcourir par tag', searchPlaceholder: 'Rechercher célébrités, films...' },
    es: { trending: 'Celebridades en tendencia', latest: 'Últimos videos', movies: 'Películas populares', viewAll: 'Ver todo', newScenes: 'Nuevas escenas', tags: 'Buscar por etiqueta', searchPlaceholder: 'Buscar celebridades, películas...' },
    pt: { trending: 'Celebridades em alta', latest: 'Últimos vídeos', movies: 'Filmes populares', viewAll: 'Ver tudo', newScenes: 'Novas cenas', tags: 'Navegar por tag', searchPlaceholder: 'Pesquisar celebridades, filmes...' },
    it: { trending: 'Celebrità di tendenza', latest: 'Ultimi video', movies: 'Film popolari', viewAll: 'Vedi tutto', newScenes: 'Nuove scene', tags: 'Sfoglia per tag', searchPlaceholder: 'Cerca celebrità, film...' },
    pl: { trending: 'Popularne gwiazdy', latest: 'Najnowsze filmy', movies: 'Popularne filmy', viewAll: 'Zobacz wszystko', newScenes: 'Nowe sceny', tags: 'Przeglądaj po tagu', searchPlaceholder: 'Szukaj gwiazd, filmów...' },
    nl: { trending: 'Trending beroemdheden', latest: 'Nieuwste video\'s', movies: 'Populaire films', viewAll: 'Alles bekijken', newScenes: 'Nieuwe scènes', tags: 'Zoek op tag', searchPlaceholder: 'Zoek beroemdheden, films...' },
    tr: { trending: 'Trend Ünlüler', latest: 'Son Videolar', movies: 'Popüler Filmler', viewAll: 'Tümünü Gör', newScenes: 'Yeni Sahneler', tags: 'Etikete göre ara', searchPlaceholder: 'Ünlü, film ara...' },
};

const collectionsLabel: Record<string, string> = {
    en: 'Collections', ru: 'Коллекции', de: 'Sammlungen', fr: 'Collections',
    es: 'Colecciones', pt: 'Coleções', it: 'Collezioni',
    pl: 'Kolekcje', nl: 'Collecties', tr: 'Koleksiyonlar',
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
// Section header helper
// ============================================

function SectionHeader({ title, viewAllHref, viewAllLabel }: {
    title: string;
    viewAllHref?: string;
    viewAllLabel?: string;
}) {
    return (
        <div className="flex items-center justify-between mb-4 md:mb-6 mt-2">
            <h2 className="text-xl md:text-2xl font-bold text-gold-gradient tracking-wide uppercase">{title}</h2>
            {viewAllHref && viewAllLabel && (
                <a
                    href={viewAllHref}
                    className="text-sm font-medium text-brand-secondary hover:text-brand-gold-light transition-colors uppercase tracking-wider"
                >
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
    const sections = sectionTitles[locale] || sectionTitles.en;

    let latestVideos: Video[] = [];
    let trendingCelebs: Celebrity[] = [];
    let popularMovies: Movie[] = [];
    let tags: Tag[] = [];
    let featuredCollections: Collection[] = [];

    try {
        [latestVideos, trendingCelebs, popularMovies, tags, featuredCollections] = await Promise.all([
            getLatestVideos(24),
            getTrendingCelebrities(12),
            getMovies(1, 12, 'scenes_count').then(r => r.data),
            getAllTags(25),
            getFeaturedCollections(4),
        ]);
    } catch (error) {
        logger.error('Home page DB query failed', { page: 'home', error: error instanceof Error ? error.message : String(error) });
    }

    const featuredVideos = latestVideos.slice(0, 4);
    const gridVideos = latestVideos.slice(4);

    // Quick tags for mobile search chips (first 8)
    const quickTags = tags.slice(0, 8).map((tag) => ({
        name: getLocalizedField(tag.name_localized, locale) || tag.name,
        slug: tag.slug,
    }));

    return (
        <div>

            {/* Mobile search + quick tag chips */}
            <div className="mx-auto max-w-[1600px] px-4 pt-3">
                <MobileSearch
                    locale={locale}
                    placeholder={sections.searchPlaceholder}
                    quickTags={quickTags}
                />
            </div>

            {/* ── New Scenes — 4 featured cards ── */}
            {featuredVideos.length > 0 && (
                <section className="mx-auto max-w-[1600px] px-4 py-6 md:py-8">
                    <SectionHeader
                        title={sections.newScenes}
                        viewAllHref={`/${locale}/video`}
                        viewAllLabel={sections.viewAll}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {featuredVideos.map((video) => (
                            <VideoCard key={video.id} video={video} locale={locale} size="featured" />
                        ))}
                    </div>
                </section>
            )}

            {/* ── Latest Videos — responsive grid ── */}
            {gridVideos.length > 0 && (
                <>
                    <GoldDivider />
                    <section className="mx-auto max-w-[1600px] px-4 py-6 md:py-8">
                        <SectionHeader
                            title={sections.latest}
                            viewAllHref={`/${locale}/video`}
                            viewAllLabel={sections.viewAll}
                        />
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                            {gridVideos.map((video) => (
                                <VideoCard key={video.id} video={video} locale={locale} />
                            ))}
                        </div>
                    </section>
                </>
            )}

            {/* ── Browse by Tag — horizontal scroll on mobile, wrapping on desktop ── */}
            {tags.length > 0 && (
                <>
                    <GoldDivider />
                    <section className="mx-auto max-w-[1600px] px-4 py-6 md:py-8">
                        <h2 className="text-xl md:text-2xl font-bold text-gold-gradient tracking-wide uppercase mb-4 mt-2">{sections.tags}</h2>
                        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible">
                            {tags.map((tag) => (
                                <a
                                    key={tag.id}
                                    href={`/${locale}/tag/${tag.slug}`}
                                    className="shrink-0 md:shrink px-3.5 py-1.5 rounded-full bg-gray-800/50 border border-gray-700 text-sm text-gray-300 hover:border-red-600 hover:text-red-400 hover:bg-red-600/10 transition-colors"
                                >
                                    {getLocalizedField(tag.name_localized, locale) || tag.name}
                                </a>
                            ))}
                        </div>
                    </section>
                </>
            )}

            {/* ── Featured Collections — curated playlists ── */}
            {featuredCollections.length > 0 && (
                <>
                    <GoldDivider />
                    <section className="mx-auto max-w-[1600px] px-4 py-6 md:py-8">
                        <SectionHeader
                            title={collectionsLabel[locale] || collectionsLabel.en}
                            viewAllHref={`/${locale}/collection`}
                            viewAllLabel={sections.viewAll}
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            {featuredCollections.map((col) => {
                                const colTitle = getLocalizedField(col.title, locale) || col.slug;
                                return (
                                    <a
                                        key={col.id}
                                        href={`/${locale}/collection/${col.slug}`}
                                        className="group relative rounded-xl overflow-hidden bg-gray-800/30 border border-gray-800 hover:border-gray-600 transition-all duration-300"
                                    >
                                        <div className="aspect-[16/9] relative overflow-hidden">
                                            {col.cover_url ? (
                                                <img
                                                    src={col.cover_url}
                                                    alt={colTitle}
                                                    loading="lazy"
                                                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                />
                                            ) : (
                                                <div className="w-full h-full bg-gradient-to-br from-red-900/30 to-gray-800 flex items-center justify-center">
                                                    <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                                    </svg>
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                                            <div className="absolute bottom-0 left-0 right-0 p-2.5">
                                                <h3 className="text-sm font-semibold text-white line-clamp-1 group-hover:text-red-400 transition-colors">
                                                    {colTitle}
                                                </h3>
                                                {col.videos_count > 0 && (
                                                    <span className="text-[11px] text-gray-400">{col.videos_count} scenes</span>
                                                )}
                                            </div>
                                        </div>
                                    </a>
                                );
                            })}
                        </div>
                    </section>
                </>
            )}

            {/* ── Trending Celebrities — mobile scroll, desktop grid ── */}
            {trendingCelebs.length > 0 && (
                <>
                    <GoldDivider />
                    <section className="mx-auto max-w-[1600px] px-4 py-6 md:py-8">
                        <SectionHeader
                            title={sections.trending}
                            viewAllHref={`/${locale}/celebrity`}
                            viewAllLabel={sections.viewAll}
                        />
                        <div className="flex gap-4 overflow-x-auto md:grid md:grid-cols-4 lg:grid-cols-6 md:overflow-visible md:gap-6 scrollbar-hide pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:justify-items-center">
                            {trendingCelebs.map((celeb) => (
                                <CelebrityCard key={celeb.id} celebrity={celeb} locale={locale} />
                            ))}
                        </div>
                    </section>
                </>
            )}

            {/* ── Popular Movies — compact grid with hover overlay ── */}
            {popularMovies.length > 0 && (
                <>
                    <GoldDivider />
                    <section className="mx-auto max-w-[1600px] px-4 py-6 md:py-8">
                        <SectionHeader
                            title={sections.movies}
                            viewAllHref={`/${locale}/movie`}
                            viewAllLabel={sections.viewAll}
                        />
                        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                            {popularMovies.map((movie) => {
                                const movieTitle = getLocalizedField(movie.title_localized, locale) || movie.title;
                                return (
                                    <a
                                        key={movie.id}
                                        href={`/${locale}/movie/${movie.slug}`}
                                        className="group rounded-lg overflow-hidden transition-transform duration-200 hover:scale-[1.03]"
                                    >
                                        <div className="relative aspect-[2/3] bg-[#111113] rounded-lg overflow-hidden">
                                            {movie.poster_url ? (
                                                <img
                                                    src={movie.poster_url}
                                                    alt={movieTitle}
                                                    loading="lazy"
                                                    className="w-full h-full object-cover transition-all duration-300 group-hover:brightness-110 group-hover:scale-105"
                                                />
                                            ) : (
                                                <div className="w-full h-full bg-gradient-to-br from-[#111113] to-[#1a1a1e] flex flex-col items-center justify-center p-2">
                                                    <svg className="w-6 h-6 text-gray-600 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                                                    </svg>
                                                    <span className="text-[10px] text-gray-600 text-center leading-tight line-clamp-2">{movieTitle}</span>
                                                </div>
                                            )}

                                            {/* Hover gradient overlay */}
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                                            {movie.year && (
                                                <span className="absolute top-1 left-1 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                                                    {movie.year}
                                                </span>
                                            )}
                                            <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                                                {movie.scenes_count}
                                            </span>
                                        </div>
                                        <div className="mt-1.5 px-0.5">
                                            <h3 className="text-xs font-medium text-gray-300 line-clamp-1 group-hover:text-white transition-colors">
                                                {movieTitle}
                                            </h3>
                                        </div>
                                    </a>
                                );
                            })}
                        </div>
                    </section>
                </>
            )}

            {/* Empty state when no data */}
            {latestVideos.length === 0 && trendingCelebs.length === 0 && (
                <section className="mx-auto max-w-[1600px] px-4 py-16 text-center">
                    <p className="text-gray-500 text-lg">Content is being prepared. Check back soon!</p>
                </section>
            )}
        </div>
    );
}
