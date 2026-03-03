import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale, getLocalizedField } from '@/lib/i18n';
import { getLatestVideos, getTrendingCelebrities, getMovies } from '@/lib/db';
import type { Video, Celebrity, Movie } from '@/lib/types';
import VideoCard from '@/components/VideoCard';
import CelebrityCard from '@/components/CelebrityCard';

export const dynamic = 'force-dynamic';

const heroText: Record<string, { heading: string; sub: string }> = {
    en: { heading: 'Celebrity Nude Scenes from Movies & TV Shows', sub: 'Discover the most iconic scenes featuring your favorite stars' },
    ru: { heading: 'Откровенные сцены знаменитостей из фильмов и сериалов', sub: 'Самые яркие сцены с участием ваших любимых звёзд' },
    de: { heading: 'Nacktszenen von Prominenten aus Filmen & Serien', sub: 'Entdecken Sie die ikonischsten Szenen Ihrer Lieblingsstars' },
    fr: { heading: 'Scènes nues de célébrités dans les films et séries', sub: 'Découvrez les scènes les plus iconiques de vos stars préférées' },
    es: { heading: 'Escenas de desnudos de celebridades en películas y series', sub: 'Descubre las escenas más icónicas de tus estrellas favoritas' },
    pt: { heading: 'Cenas de nudez de celebridades em filmes e séries', sub: 'Descubra as cenas mais icônicas das suas estrelas favoritas' },
    it: { heading: 'Scene di nudo di celebrità da film e serie TV', sub: 'Scopri le scene più iconiche delle tue star preferite' },
    pl: { heading: 'Nagie sceny celebrytów z filmów i seriali', sub: 'Odkryj najbardziej kultowe sceny z udziałem Twoich ulubionych gwiazd' },
    nl: { heading: 'Naaktscènes van beroemdheden uit films en series', sub: 'Ontdek de meest iconische scènes van je favoriete sterren' },
    tr: { heading: 'Film ve dizilerden ünlülerin çıplak sahneleri', sub: 'En sevdiğiniz yıldızların en ikonik sahnelerini keşfedin' },
};

const sectionTitles: Record<string, { trending: string; latest: string; movies: string; viewAll: string; scenes: string }> = {
    en: { trending: 'Trending Celebrities', latest: 'Latest Videos', movies: 'Popular Movies', viewAll: 'View All', scenes: 'scenes' },
    ru: { trending: 'Популярные знаменитости', latest: 'Новые видео', movies: 'Популярные фильмы', viewAll: 'Смотреть все', scenes: 'сцен' },
    de: { trending: 'Beliebte Prominente', latest: 'Neueste Videos', movies: 'Beliebte Filme', viewAll: 'Alle anzeigen', scenes: 'Szenen' },
    fr: { trending: 'Célébrités tendances', latest: 'Dernières vidéos', movies: 'Films populaires', viewAll: 'Voir tout', scenes: 'scènes' },
    es: { trending: 'Celebridades en tendencia', latest: 'Últimos videos', movies: 'Películas populares', viewAll: 'Ver todo', scenes: 'escenas' },
    pt: { trending: 'Celebridades em alta', latest: 'Últimos vídeos', movies: 'Filmes populares', viewAll: 'Ver tudo', scenes: 'cenas' },
    it: { trending: 'Celebrità di tendenza', latest: 'Ultimi video', movies: 'Film popolari', viewAll: 'Vedi tutto', scenes: 'scene' },
    pl: { trending: 'Popularne gwiazdy', latest: 'Najnowsze filmy', movies: 'Popularne filmy', viewAll: 'Zobacz wszystko', scenes: 'scen' },
    nl: { trending: 'Trending beroemdheden', latest: 'Nieuwste video\'s', movies: 'Populaire films', viewAll: 'Alles bekijken', scenes: 'scènes' },
    tr: { trending: 'Trend Ünlüler', latest: 'Son Videolar', movies: 'Popüler Filmler', viewAll: 'Tümünü Gör', scenes: 'sahne' },
};

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
        alternates: {
            languages: Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `/${loc}`])
            ),
        },
    };
}

export default async function HomePage({ params }: { params: { locale: string } }) {
    const locale = params.locale;
    const hero = heroText[locale] || heroText.en;
    const sections = sectionTitles[locale] || sectionTitles.en;

    let latestVideos: Video[] = [];
    let trendingCelebs: Celebrity[] = [];
    let popularMovies: Movie[] = [];

    try {
        [latestVideos, trendingCelebs, popularMovies] = await Promise.all([
            getLatestVideos(12),
            getTrendingCelebrities(10),
            getMovies(1, 8, 'scenes_count').then(r => r.data),
        ]);
    } catch (error) {
        console.error('[HomePage] DB query failed:', error);
    }

    return (
        <div>
            {/* Hero Section */}
            <section className="relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-brand-accent/5 via-transparent to-transparent" />
                <div className="relative mx-auto max-w-7xl px-4 py-16 sm:py-20 text-center">
                    <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold leading-tight">
                        <span className="bg-gradient-to-r from-brand-accent via-red-400 to-orange-400 bg-clip-text text-transparent">
                            {hero.heading}
                        </span>
                    </h1>
                    <p className="mt-4 text-base sm:text-lg text-brand-secondary max-w-2xl mx-auto">
                        {hero.sub}
                    </p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <a
                            href={`/${locale}/video`}
                            className="inline-flex items-center gap-2 rounded-lg bg-brand-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-accent-hover transition-colors duration-200 shadow-lg shadow-brand-accent/20"
                        >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                            {sections.latest}
                        </a>
                        <a
                            href={`/${locale}/celebrity`}
                            className="inline-flex items-center gap-2 rounded-lg border border-brand-border bg-brand-card px-6 py-2.5 text-sm font-semibold text-brand-text hover:bg-brand-hover transition-colors duration-200"
                        >
                            {sections.trending}
                        </a>
                    </div>
                </div>
            </section>

            {/* Trending Celebrities — horizontal scroll */}
            {trendingCelebs.length > 0 && (
                <section className="mx-auto max-w-7xl px-4 py-8">
                    <div className="flex items-center justify-between mb-5">
                        <h2 className="text-xl sm:text-2xl font-bold text-white">{sections.trending}</h2>
                        <a
                            href={`/${locale}/celebrity`}
                            className="text-sm text-brand-accent hover:text-brand-accent-hover transition-colors"
                        >
                            {sections.viewAll} →
                        </a>
                    </div>
                    <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
                        {trendingCelebs.map((celeb) => (
                            <CelebrityCard key={celeb.id} celebrity={celeb} locale={locale} />
                        ))}
                    </div>
                </section>
            )}

            {/* Latest Videos — responsive grid */}
            {latestVideos.length > 0 && (
                <section className="mx-auto max-w-7xl px-4 py-8">
                    <div className="flex items-center justify-between mb-5">
                        <h2 className="text-xl sm:text-2xl font-bold text-white">{sections.latest}</h2>
                        <a
                            href={`/${locale}/video`}
                            className="text-sm text-brand-accent hover:text-brand-accent-hover transition-colors"
                        >
                            {sections.viewAll} →
                        </a>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {latestVideos.map((video) => (
                            <VideoCard key={video.id} video={video} locale={locale} />
                        ))}
                    </div>
                </section>
            )}

            {/* Popular Movies */}
            {popularMovies.length > 0 && (
                <section className="mx-auto max-w-7xl px-4 py-8 pb-16">
                    <div className="flex items-center justify-between mb-5">
                        <h2 className="text-xl sm:text-2xl font-bold text-white">{sections.movies}</h2>
                        <a
                            href={`/${locale}/movie`}
                            className="text-sm text-brand-accent hover:text-brand-accent-hover transition-colors"
                        >
                            {sections.viewAll} →
                        </a>
                    </div>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                        {popularMovies.map((movie) => {
                            const movieTitle = getLocalizedField(movie.title_localized, locale) || movie.title;
                            return (
                                <a
                                    key={movie.id}
                                    href={`/${locale}/movie/${movie.slug}`}
                                    className="group rounded-lg overflow-hidden transition-transform duration-200 hover:scale-[1.02]"
                                >
                                    <div className="relative aspect-[2/3] bg-brand-card rounded-lg overflow-hidden">
                                        {movie.poster_url ? (
                                            <img
                                                src={movie.poster_url}
                                                alt={movieTitle}
                                                loading="lazy"
                                                className="w-full h-full object-cover transition-all duration-300 group-hover:brightness-110 group-hover:scale-105"
                                            />
                                        ) : (
                                            <div className="w-full h-full bg-gradient-to-br from-brand-card via-brand-hover to-brand-card flex flex-col items-center justify-center p-3">
                                                <svg className="w-8 h-8 text-brand-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                                                </svg>
                                                <span className="text-xs text-brand-muted text-center leading-tight">{movieTitle}</span>
                                            </div>
                                        )}
                                        {movie.year && (
                                            <span className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                                                {movie.year}
                                            </span>
                                        )}
                                        <span className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                                            {movie.scenes_count} {sections.scenes}
                                        </span>
                                    </div>
                                    <div className="mt-2 px-0.5">
                                        <h3 className="text-sm font-medium text-brand-text line-clamp-1 group-hover:text-white transition-colors">
                                            {movieTitle}
                                        </h3>
                                        {movie.director && (
                                            <p className="text-xs text-brand-secondary mt-0.5">{movie.director}</p>
                                        )}
                                    </div>
                                </a>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* Empty state when no data */}
            {latestVideos.length === 0 && trendingCelebs.length === 0 && (
                <section className="mx-auto max-w-7xl px-4 py-16 text-center">
                    <p className="text-brand-secondary text-lg">Content is being prepared. Check back soon!</p>
                </section>
            )}
        </div>
    );
}
