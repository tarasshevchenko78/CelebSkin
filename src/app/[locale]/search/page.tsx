'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getLocalizedField } from '@/lib/i18n';
import type { Video, Celebrity, Tag } from '@/lib/types';
import VideoCard from '@/components/VideoCard';
import CelebrityCard from '@/components/CelebrityCard';

// ── i18n labels ──

const titles: Record<string, string> = {
    en: 'Search results', ru: 'Результаты поиска', de: 'Suchergebnisse', fr: 'Résultats',
    es: 'Resultados', pt: 'Resultados', it: 'Risultati',
    pl: 'Wyniki', nl: 'Resultaten', tr: 'Sonuçlar',
};
const emptyLabels: Record<string, string> = {
    en: 'Nothing found for', ru: 'Ничего не найдено по запросу',
    de: 'Keine Ergebnisse für', fr: 'Aucun résultat pour',
    es: 'Sin resultados para', pt: 'Nenhum resultado para',
    it: 'Nessun risultato per', pl: 'Brak wyników dla',
    nl: 'Geen resultaten voor', tr: 'Sonuç bulunamadı',
};
const placeholders: Record<string, string> = {
    en: 'Search celebrities, movies, videos...',
    ru: 'Поиск знаменитостей, фильмов, видео...',
    de: 'Suche nach Prominenten, Filmen, Videos...',
    fr: 'Rechercher des célébrités, films, vidéos...',
    es: 'Buscar celebridades, películas, videos...',
    pt: 'Pesquisar celebridades, filmes, vídeos...',
    it: 'Cerca celebrità, film, video...',
    pl: 'Szukaj celebrytów, filmów, wideo...',
    nl: "Zoek beroemdheden, films, video's...",
    tr: 'Ünlü, film, video ara...',
};
const sectionLabels: Record<string, Record<string, string>> = {
    tags: { en: 'Tags', ru: 'Теги', de: 'Tags', fr: 'Tags', es: 'Etiquetas', pt: 'Tags', it: 'Tag', pl: 'Tagi', nl: 'Tags', tr: 'Etiketler' },
    celebrities: { en: 'Celebrities', ru: 'Знаменитости', de: 'Prominente', fr: 'Célébrités', es: 'Celebridades', pt: 'Celebridades', it: 'Celebrità', pl: 'Celebryci', nl: 'Beroemdheden', tr: 'Ünlüler' },
    collections: { en: 'Collections', ru: 'Коллекции', de: 'Sammlungen', fr: 'Collections', es: 'Colecciones', pt: 'Coleções', it: 'Collezioni', pl: 'Kolekcje', nl: 'Collecties', tr: 'Koleksiyonlar' },
    videos: { en: 'Videos', ru: 'Видео', de: 'Videos', fr: 'Vidéos', es: 'Vídeos', pt: 'Vídeos', it: 'Video', pl: 'Wideo', nl: "Video's", tr: 'Videolar' },
};

const POPULAR_TAGS = ['nude', 'topless', 'sex-scene', 'lesbian', 'shower', 'striptease', 'bikini', 'romantic'];

// ── Types ──

interface Collection {
    id: number;
    title: Record<string, string>;
    slug: string;
    cover_url: string | null;
    videos_count: number;
}

interface HydratedResult {
    tags: Tag[];
    celebrities: Celebrity[];
    collections: Collection[];
    videos: Video[];
}

const EMPTY: HydratedResult = { tags: [], celebrities: [], collections: [], videos: [] };

function totalCount(r: HydratedResult) {
    return r.tags.length + r.celebrities.length + r.collections.length + r.videos.length;
}

// ── Page ──

export default function SearchPage({ params, searchParams }: { params: { locale: string }; searchParams?: { q?: string } }) {
    const locale = params.locale;
    const initialQuery = searchParams?.q || '';
    const [query, setQuery] = useState(initialQuery);
    const [phase1, setPhase1] = useState<HydratedResult>(EMPTY);
    const [phase2, setPhase2] = useState<HydratedResult>(EMPTY);
    const [loadingP1, setLoadingP1] = useState(false);
    const [loadingP2, setLoadingP2] = useState(false);
    const [error, setError] = useState(false);
    const controllerRef = useRef<AbortController | null>(null);
    const initialFetched = useRef(false);

    const fetchPhase = useCallback(async (q: string, phase: '1' | '2', signal?: AbortSignal): Promise<HydratedResult> => {
        const res = await fetch(
            `/api/search?q=${encodeURIComponent(q)}&phase=${phase}&lang=${locale}&hydrate=true`,
            { signal },
        );
        if (!res.ok) throw new Error('fetch failed');
        return await res.json();
    }, [locale]);

    const doSearch = useCallback(async (q: string) => {
        if (q.length < 2) {
            setPhase1(EMPTY);
            setPhase2(EMPTY);
            setLoadingP1(false);
            setError(false);
            return;
        }

        controllerRef.current?.abort();
        controllerRef.current = new AbortController();
        const signal = controllerRef.current.signal;

        setLoadingP1(true);
        setPhase2(EMPTY);
        setError(false);

        try {
            const r1 = await fetchPhase(q, '1', signal);
            setPhase1(r1);
            setLoadingP1(false);

            // Always run phase 2 (AI search) for AI badges
            setLoadingP2(true);
            const r2 = await fetchPhase(q, '2', signal);
            setPhase2(r2);
            setLoadingP2(false);
        } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setError(true);
            setLoadingP1(false);
            setLoadingP2(false);
        }
    }, [fetchPhase]);

    // Initial load — fetch on mount if we have a query
    useEffect(() => {
        if (initialQuery && !initialFetched.current) {
            initialFetched.current = true;
            doSearch(initialQuery);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Listen for header search bar navigation (same-page)
    useEffect(() => {
        function onHeaderSearch(e: Event) {
            const q = (e as CustomEvent).detail as string;
            if (q && q !== query) {
                setQuery(q);
                initialFetched.current = true;
                doSearch(q);
            }
        }
        window.addEventListener('header-search', onHeaderSearch);
        return () => window.removeEventListener('header-search', onHeaderSearch);
    }, [query, doSearch]);

    // Debounced typing
    useEffect(() => {
        if (!initialFetched.current && !query) return;
        initialFetched.current = true;
        const timer = setTimeout(() => doSearch(query), 400);
        return () => clearTimeout(timer);
    }, [query, doSearch]);

    const handleQueryChange = useCallback((value: string) => {
        setQuery(value);
        const url = value ? `/${locale}/search?q=${encodeURIComponent(value)}` : `/${locale}/search`;
        window.history.replaceState({}, '', url);
    }, [locale]);

    // Merge phase 2 (only new IDs)
    const p1VideoIds = new Set(phase1.videos.map(v => v.id));
    const p1CelebIds = new Set(phase1.celebrities.map(c => c.id));
    const p1CollIds = new Set(phase1.collections.map(c => c.id));
    const p1TagIds = new Set(phase1.tags.map(t => t.id));
    const p2New: HydratedResult = {
        tags: phase2.tags.filter(t => !p1TagIds.has(t.id)),
        celebrities: phase2.celebrities.filter(c => !p1CelebIds.has(c.id)),
        collections: phase2.collections.filter(c => !p1CollIds.has(c.id)),
        videos: phase2.videos.filter(v => !p1VideoIds.has(v.id)),
    };
    const hasP2 = totalCount(p2New) > 0;

    const allCelebs = [...phase1.celebrities, ...p2New.celebrities];
    const allCollections = [...phase1.collections, ...p2New.collections];
    const allTags = [...phase1.tags, ...p2New.tags];
    const hasResults = phase1.videos.length > 0 || allCelebs.length > 0 || allCollections.length > 0 || allTags.length > 0 || p2New.videos.length > 0;

    const sl = (section: string) => sectionLabels[section]?.[locale] || sectionLabels[section]?.en || section;

    return (
        <div className="mx-auto max-w-[1600px] px-4 py-8">
            {/* Title */}
            {query && (
                <h1 className="text-2xl sm:text-3xl font-bold text-white mb-6">
                    {titles[locale] || titles.en}: &ldquo;{query}&rdquo;
                </h1>
            )}

            {/* Search input */}
            <div className="relative mb-8">
                <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                    type="search"
                    value={query}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    placeholder={placeholders[locale] || placeholders.en}
                    className="w-full rounded-xl border border-brand-border bg-brand-card pl-12 pr-4 py-3 text-white placeholder-brand-muted focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent transition-colors"
                    autoFocus
                />
            </div>

            {/* Loading */}
            {loadingP1 && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="animate-pulse">
                            <div className="aspect-video bg-gray-800 rounded-lg" />
                            <div className="mt-2 h-4 bg-gray-800 rounded w-3/4" />
                            <div className="mt-1.5 h-3 bg-gray-800 rounded w-1/2" />
                        </div>
                    ))}
                </div>
            )}

            {/* Error */}
            {!loadingP1 && error && (
                <div className="text-center py-16 text-brand-secondary">
                    <p className="text-lg mb-2">{locale === 'ru' ? 'Поиск временно недоступен' : 'Search temporarily unavailable'}</p>
                </div>
            )}

            {/* Empty state — no query */}
            {!loadingP1 && !query && !error && (
                <div className="text-center py-16 text-brand-secondary">
                    <svg className="w-16 h-16 mx-auto mb-4 text-brand-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <p className="mb-4">{locale === 'ru' ? 'Введите поисковый запрос' : 'Enter a search query'}</p>
                    <PopularTags locale={locale} />
                </div>
            )}

            {/* No results */}
            {!loadingP1 && query.length >= 2 && !hasResults && !error && !loadingP2 && (
                <div className="text-center py-16 text-brand-secondary">
                    <p className="text-lg mb-4">{emptyLabels[locale] || emptyLabels.en} &ldquo;{query}&rdquo;</p>
                    <PopularTags locale={locale} />
                </div>
            )}

            {/* Results */}
            {!loadingP1 && hasResults && (
                <div className="space-y-8">
                    {/* Tags */}
                    {allTags.length > 0 && (
                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3">{sl('tags')}</h2>
                            <div className="flex flex-wrap gap-2">
                                {allTags.map(tag => (
                                    <a
                                        key={tag.id}
                                        href={`/${locale}/video?tag=${tag.slug}`}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-accent/15 border border-brand-accent/30 text-brand-gold-light hover:bg-brand-accent/25 hover:border-brand-accent/50 transition-colors"
                                    >
                                        <span className="text-sm font-medium">{tag.name}</span>
                                        {tag.videos_count > 0 && (
                                            <span className="text-xs text-brand-secondary bg-brand-bg/50 px-2 py-0.5 rounded-full">{tag.videos_count}</span>
                                        )}
                                    </a>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Celebrities */}
                    {allCelebs.length > 0 && (
                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3">{sl('celebrities')} ({allCelebs.length})</h2>
                            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-brand-accent/30">
                                {allCelebs.map(c => (
                                    <div key={c.id} className="shrink-0 w-[140px]">
                                        <CelebrityCard celebrity={c} locale={locale} />
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Collections */}
                    {allCollections.length > 0 && (
                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3">{sl('collections')} ({allCollections.length})</h2>
                            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-brand-accent/30">
                                {allCollections.map(col => {
                                    const colTitle = getLocalizedField(col.title, locale) || col.slug;
                                    return (
                                        <a key={col.id} href={`/${locale}/collection/${col.slug}`} className="shrink-0 w-[200px] group">
                                            <div className="aspect-video rounded-lg bg-brand-card border border-brand-border overflow-hidden group-hover:border-brand-accent/50 transition-colors">
                                                {col.cover_url ? (
                                                    <img src={col.cover_url} alt={colTitle} className="w-full h-full object-cover" loading="lazy" />
                                                ) : (
                                                    <div className="w-full h-full bg-gradient-to-br from-brand-card to-brand-hover flex items-center justify-center p-3">
                                                        <svg className="w-8 h-8 text-brand-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                                        </svg>
                                                    </div>
                                                )}
                                            </div>
                                            <h3 className="mt-2 text-sm text-brand-text group-hover:text-white transition-colors line-clamp-1">{colTitle}</h3>
                                            {col.videos_count > 0 && (
                                                <p className="text-xs text-brand-secondary">{col.videos_count} {locale === 'ru' ? 'видео' : 'videos'}</p>
                                            )}
                                        </a>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    {/* Phase 1 Videos */}
                    {phase1.videos.length > 0 && (
                        <section>
                            <h2 className="text-lg font-semibold text-white mb-3">{sl('videos')} ({phase1.videos.length})</h2>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                                {phase1.videos.map(v => (
                                    <VideoCard key={v.id} video={v} locale={locale} />
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Phase 2 loading indicator */}
                    {loadingP2 && (
                        <div className="flex items-center gap-3 py-6 animate-fadeIn">
                            <div className="flex-1 h-px bg-purple-500/20" />
                            <div className="flex items-center gap-2 text-purple-400/80 text-sm">
                                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                {locale === 'ru' ? 'AI ищет похожие видео...' : 'AI is searching for similar videos...'}
                            </div>
                            <div className="flex-1 h-px bg-purple-500/20" />
                        </div>
                    )}

                    {/* Phase 2 AI Results — separate section */}
                    {hasP2 && !loadingP2 && p2New.videos.length > 0 && (
                        <section className="animate-fadeIn">
                            <div className="relative rounded-xl border border-purple-500/30 bg-purple-950/20 p-4 sm:p-6 mt-2">
                                {/* AI section header */}
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="flex items-center gap-2 bg-purple-600/90 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg">
                                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>
                                        AI Search
                                    </div>
                                    <div>
                                        <h3 className="text-white font-semibold text-base">
                                            {locale === 'ru' ? 'AI нашёл ещё' : 'AI found more'} ({p2New.videos.length})
                                        </h3>
                                        <p className="text-purple-300/60 text-xs mt-0.5">
                                            {locale === 'ru'
                                                ? 'Найдено с помощью анализа содержания видео'
                                                : 'Found by analyzing video content'}
                                        </p>
                                    </div>
                                </div>
                                {/* AI videos grid */}
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                                    {p2New.videos.map(v => (
                                        <div key={v.id} className="relative">
                                            <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-purple-600/90 backdrop-blur-sm text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md shadow-lg">
                                                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>
                                                AI
                                            </div>
                                            <VideoCard video={v} locale={locale} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </section>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Popular tags suggestion ──

function PopularTags({ locale }: { locale: string }) {
    return (
        <div>
            <p className="text-sm text-brand-muted mb-3">{locale === 'ru' ? 'Популярные теги:' : 'Popular tags:'}</p>
            <div className="flex flex-wrap justify-center gap-2">
                {POPULAR_TAGS.map(slug => (
                    <a
                        key={slug}
                        href={`/${locale}/video?tag=${slug}`}
                        className="text-sm bg-brand-card border border-brand-border text-brand-accent px-3 py-1.5 rounded-full hover:bg-brand-hover transition-colors capitalize"
                    >
                        {slug.replace(/-/g, ' ')}
                    </a>
                ))}
            </div>
        </div>
    );
}
