'use client';

import { useState, useMemo } from 'react';
import { getLocalizedField } from '@/lib/i18n';
import { searchMockData } from '@/lib/mockData';
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

export default function SearchPage({ params }: { params: { locale: string } }) {
    const locale = params.locale;
    const [query, setQuery] = useState('');
    const [activeTab, setActiveTab] = useState<string>('all');

    const results = useMemo(() => {
        if (query.length < 2) return null;
        return searchMockData(query);
    }, [query]);

    const hasResults = results && (results.videos.length > 0 || results.celebrities.length > 0 || results.movies.length > 0);

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
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
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={placeholders[locale] || placeholders.en}
                    className="w-full rounded-xl border border-brand-border bg-brand-card pl-12 pr-4 py-3 text-white placeholder-brand-muted focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent transition-colors"
                    autoFocus
                />
            </div>

            {/* Tabs */}
            {results && (
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

            {/* Results */}
            {!results && (
                <div className="text-center py-16 text-brand-secondary">
                    <svg className="w-16 h-16 mx-auto mb-4 text-brand-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    <p>Enter a search query to find celebrities, movies, and videos</p>
                </div>
            )}

            {results && !hasResults && (
                <div className="text-center py-16 text-brand-secondary">
                    <p className="text-lg mb-2">No results found</p>
                    <p className="text-sm">Try a different search term</p>
                </div>
            )}

            {results && hasResults && (
                <div className="space-y-8">
                    {/* Videos */}
                    {(activeTab === 'all' || activeTab === 'videos') && results.videos.length > 0 && (
                        <section>
                            {activeTab === 'all' && <h2 className="text-lg font-semibold text-white mb-3">Videos ({results.videos.length})</h2>}
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
