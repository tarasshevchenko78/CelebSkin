'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getLocalizedField } from '@/lib/i18n';
import type { SearchResult } from '@/lib/types';
import VideoCard from '@/components/VideoCard';
import CelebrityCard from '@/components/CelebrityCard';

const titles: Record<string, string> = {
    en: 'Search', ru: 'Поиск', de: 'Suche', fr: 'Recherche',
    es: 'Buscar', pt: 'Pesquisar', it: 'Cerca',
    pl: 'Szukaj', nl: 'Zoeken', tr: 'Arama',
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
const tabs = ['all', 'videos', 'celebrities', 'movies'] as const;
const SUGGESTIONS = ['Nadine Warmuth', 'Susan Blakely', 'Lara Harris', 'Marina Pasqua', 'Laetitia Martinucci'];

export default function SearchPage({ params, searchParams }: { params: { locale: string }; searchParams: { q?: string } }) {
    const locale = params.locale;
    const initialQuery = searchParams?.q || '';
    const [query, setQuery] = useState(initialQuery);
    const [activeTab, setActiveTab] = useState<string>('all');
    const [results, setResults] = useState<SearchResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const controllerRef = useRef<AbortController | null>(null);
    const initialFetched = useRef(false);

    const fetchResults = useCallback(async (q: string) => {
        if (q.length < 2) {
            setResults(null);
            setLoading(false);
            setError(false);
            return;
        }

        // Cancel previous request
        controllerRef.current?.abort();
        controllerRef.current = new AbortController();

        setLoading(true);
        setError(false);
        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
                signal: controllerRef.current.signal,
            });
            if (res.ok) {
                const data = await res.json();
                setResults(data);
            } else {
                setError(true);
            }
        } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            console.error('[Search] fetch error:', err);
            setError(true);
        } finally {
            setLoading(false);
        }
    }, []);

    // Auto-search on initial load if URL has ?q=
    useEffect(() => {
        if (initialQuery && !initialFetched.current) {
            initialFetched.current = true;
            fetchResults(initialQuery);
        }
    }, [initialQuery, fetchResults]);

    // Debounced search on typing (400ms)
    useEffect(() => {
        if (!initialFetched.current && !query) return;
        initialFetched.current = true;

        const timer = setTimeout(() => {
            fetchResults(query);
        }, 400);
        return () => clearTimeout(timer);
    }, [query, fetchResults]);

    // Update URL without reload
    const handleQueryChange = useCallback((value: string) => {
        setQuery(value);
        const url = value
            ? `/${locale}/search?q=${encodeURIComponent(value)}`
            : `/${locale}/search`;
        window.history.replaceState({}, '', url);
    }, [locale]);

    const hasResults = results && (results.videos.length > 0 || results.celebrities.length > 0 || results.movies.length > 0);

    return (
        <div className="mx-auto max-w-[1600px] px-4 py-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-6">
                {titles[locale] || titles.en}
            </h1>

            {/* Search input */}
            <div className="relative mb-6">
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

            {/* Tabs */}
            {results && hasResults && (
                <div className="flex gap-1 mb-6 border-b border-brand-border pb-2">
                    {tabs.map((tab) => {
                        const count = tab === 'all'
                            ? (results.videos.length + results.celebrities.length + results.movies.length)
                            : tab === 'videos' ? results.videos.length
                                : tab === 'celebrities' ? results.celebrities.length
                                    : results.movies.length;
                        return (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`text-sm px-3 py-1.5 rounded-lg transition-colors capitalize ${activeTab === tab
                                    ? 'bg-brand-accent text-white'
                                    : 'text-brand-secondary hover:text-brand-text hover:bg-brand-hover'
                                    }`}
                            >
                                {tab} ({count})
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Loading skeleton */}
            {loading && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="animate-pulse">
                            <div className="aspect-video bg-gray-800 rounded-lg" />
                            <div className="mt-2 h-4 bg-gray-800 rounded w-3/4" />
                            <div className="mt-1.5 h-3 bg-gray-800 rounded w-1/2" />
                        </div>
                    ))}
                </div>
            )}

            {/* Empty state — no query */}
            {!loading && !results && !error && (
                <div className="text-center py-16 text-brand-secondary">
                    <svg className="w-16 h-16 mx-auto mb-4 text-brand-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    <p className="mb-4">Enter a search query to find celebrities, movies, and videos</p>
                    <p className="text-sm text-brand-muted mb-3">Try searching for:</p>
                    <div className="flex flex-wrap justify-center gap-2">
                        {SUGGESTIONS.map((name) => (
                            <button
                                key={name}
                                onClick={() => handleQueryChange(name)}
                                className="text-sm bg-brand-card border border-brand-border text-brand-accent px-3 py-1.5 rounded-full hover:bg-brand-hover transition-colors"
                            >
                                {name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Error state */}
            {!loading && error && (
                <div className="text-center py-16 text-brand-secondary">
                    <p className="text-lg mb-2">Search temporarily unavailable</p>
                    <p className="text-sm">Please try again.</p>
                </div>
            )}

            {/* No results */}
            {!loading && results && !hasResults && (
                <div className="text-center py-16 text-brand-secondary">
                    <p className="text-lg mb-2">No results for &ldquo;{query}&rdquo;</p>
                    <p className="text-sm">Try a different search term.</p>
                </div>
            )}

            {/* Results */}
            {!loading && results && hasResults && (
                <div className="space-y-8">
                    {/* Videos */}
                    {(activeTab === 'all' || activeTab === 'videos') && results.videos.length > 0 && (
                        <section>
                            {activeTab === 'all' && <h2 className="text-lg font-semibold text-white mb-3">Videos ({results.videos.length})</h2>}
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                                {results.videos.map((v) => (<VideoCard key={v.id} video={v} locale={locale} />))}
                            </div>
                        </section>
                    )}

                    {/* Celebrities */}
                    {(activeTab === 'all' || activeTab === 'celebrities') && results.celebrities.length > 0 && (
                        <section>
                            {activeTab === 'all' && <h2 className="text-lg font-semibold text-white mb-3">Celebrities ({results.celebrities.length})</h2>}
                            <div className="flex flex-wrap gap-6">
                                {results.celebrities.map((c) => (<CelebrityCard key={c.id} celebrity={c} locale={locale} />))}
                            </div>
                        </section>
                    )}

                    {/* Movies */}
                    {(activeTab === 'all' || activeTab === 'movies') && results.movies.length > 0 && (
                        <section>
                            {activeTab === 'all' && <h2 className="text-lg font-semibold text-white mb-3">Movies ({results.movies.length})</h2>}
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                                {results.movies.map((m) => {
                                    const movieTitle = getLocalizedField(m.title_localized, locale) || m.title;
                                    return (
                                        <a key={m.id} href={`/${locale}/movie/${m.slug}`} className="group">
                                            <div className="aspect-[2/3] rounded-lg bg-brand-card border border-brand-border overflow-hidden group-hover:border-brand-accent/50 transition-colors">
                                                <div className="w-full h-full bg-gradient-to-br from-brand-card to-brand-hover flex flex-col items-center justify-center p-3">
                                                    <svg className="w-8 h-8 text-brand-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" /></svg>
                                                    <span className="text-xs text-brand-muted text-center">{movieTitle}</span>
                                                </div>
                                            </div>
                                            <h3 className="mt-2 text-sm text-brand-text group-hover:text-white transition-colors line-clamp-1">{movieTitle}</h3>
                                            <p className="text-xs text-brand-secondary">{m.year}</p>
                                        </a>
                                    );
                                })}
                            </div>
                        </section>
                    )}
                </div>
            )}
        </div>
    );
}
