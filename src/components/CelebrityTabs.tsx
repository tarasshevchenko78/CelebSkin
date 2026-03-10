'use client';

import { useState, useMemo } from 'react';
import type { Video, Movie, Celebrity } from '@/lib/types';
import { getLocalizedField } from '@/lib/i18n';
import VideoCard from './VideoCard';
import CelebrityCard from './CelebrityCard';
import SortDropdown from './SortDropdown';

interface CelebrityTabsProps {
    locale: string;
    videos: Video[];
    movies: Movie[];
    similarCelebrities: Celebrity[];
}

type TabKey = 'scenes' | 'movies' | 'similar';

interface TabDef {
    key: TabKey;
    label: string;
}

const tabLabels: Record<TabKey, Record<string, string>> = {
    scenes: {
        en: 'All Scenes', ru: 'Все сцены', de: 'Alle Szenen', fr: 'Toutes les scènes',
        es: 'Todas las escenas', pt: 'Todas as cenas', it: 'Tutte le scene',
        pl: 'Wszystkie sceny', nl: 'Alle scènes', tr: 'Tüm Sahneler',
    },
    movies: {
        en: 'Movies', ru: 'Фильмы', de: 'Filme', fr: 'Films',
        es: 'Películas', pt: 'Filmes', it: 'Film',
        pl: 'Filmy', nl: 'Films', tr: 'Filmler',
    },
    similar: {
        en: 'Similar', ru: 'Похожие', de: 'Ähnlich', fr: 'Similaires',
        es: 'Similares', pt: 'Semelhantes', it: 'Simili',
        pl: 'Podobne', nl: 'Vergelijkbaar', tr: 'Benzer',
    },
};

const sortOptions = [
    { label: 'Newest', value: 'newest' },
    { label: 'Most Viewed', value: 'views' },
    { label: 'Top Rated', value: 'rated' },
];

const noScenesLabel: Record<string, string> = {
    en: 'No scenes available yet.', ru: 'Сцен пока нет.',
};
const noMoviesLabel: Record<string, string> = {
    en: 'No movies found.', ru: 'Фильмов не найдено.',
};
const noSimilarLabel: Record<string, string> = {
    en: 'No similar celebrities found.', ru: 'Похожих не найдено.',
};
const scenesWord: Record<string, string> = {
    en: 'scenes', ru: 'сцен', de: 'Szenen', fr: 'scènes',
};

export default function CelebrityTabs({
    locale,
    videos,
    movies,
    similarCelebrities,
}: CelebrityTabsProps) {
    const [activeTab, setActiveTab] = useState<TabKey>('scenes');
    const [sort, setSort] = useState('newest');

    // Build available tabs — only show tabs with content
    const tabs = useMemo<TabDef[]>(() => {
        const result: TabDef[] = [];
        if (videos.length > 0) result.push({ key: 'scenes', label: tabLabels.scenes[locale] || tabLabels.scenes.en });
        if (movies.length > 0) result.push({ key: 'movies', label: tabLabels.movies[locale] || tabLabels.movies.en });
        if (similarCelebrities.length > 0) result.push({ key: 'similar', label: tabLabels.similar[locale] || tabLabels.similar.en });
        return result;
    }, [videos.length, movies.length, similarCelebrities.length, locale]);

    // Sort videos client-side
    const sortedVideos = useMemo(() => {
        const sorted = [...videos];
        switch (sort) {
            case 'views':
                sorted.sort((a, b) => (b.views_count || 0) - (a.views_count || 0));
                break;
            case 'rated':
                sorted.sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0));
                break;
            case 'newest':
            default:
                sorted.sort((a, b) => {
                    const da = a.published_at ? new Date(a.published_at).getTime() : 0;
                    const db = b.published_at ? new Date(b.published_at).getTime() : 0;
                    return db - da;
                });
        }
        return sorted;
    }, [videos, sort]);

    // If 0 or 1 tabs, don't show tab bar
    const showTabBar = tabs.length > 1;

    // Ensure activeTab is valid
    const currentTab = tabs.find(t => t.key === activeTab) ? activeTab : (tabs[0]?.key || 'scenes');

    return (
        <div>
            {/* Tab bar */}
            {showTabBar && (
                <div className="flex border-b border-gray-800 gap-0 mb-4">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`px-4 py-2.5 text-sm font-medium cursor-pointer transition-colors ${
                                currentTab === tab.key
                                    ? 'text-white border-b-2 border-red-600'
                                    : 'text-gray-400 hover:text-gray-300'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Tab content */}
            {currentTab === 'scenes' && (
                <div>
                    {/* Sort dropdown */}
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-sm text-gray-500">
                            {videos.length} {scenesWord[locale] || scenesWord.en}
                        </span>
                        <SortDropdown
                            options={sortOptions}
                            selected={sort}
                            onChange={setSort}
                        />
                    </div>
                    {sortedVideos.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                            {sortedVideos.map((v) => (
                                <VideoCard key={v.id} video={v} locale={locale} />
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-500 text-sm py-8 text-center">
                            {noScenesLabel[locale] || noScenesLabel.en}
                        </p>
                    )}
                </div>
            )}

            {currentTab === 'movies' && (
                <div className="space-y-2">
                    {movies.length > 0 ? (
                        movies.map((movie) => {
                            const movieTitle = getLocalizedField(movie.title_localized, locale) || movie.title;
                            return (
                                <a
                                    key={movie.id}
                                    href={`/${locale}/movie/${movie.slug}`}
                                    className="flex gap-3 items-start p-3 bg-gray-800/30 rounded-lg hover:bg-gray-800/50 transition-colors group"
                                >
                                    {/* Poster */}
                                    <div className="w-16 h-24 rounded overflow-hidden flex-shrink-0 bg-gray-800">
                                        {movie.poster_url ? (
                                            <img
                                                src={movie.poster_url}
                                                alt={movieTitle}
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" />
                                                </svg>
                                            </div>
                                        )}
                                    </div>
                                    {/* Info */}
                                    <div className="flex-1 min-w-0 py-1">
                                        <h3 className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors line-clamp-1">
                                            {movieTitle}
                                        </h3>
                                        <p className="text-xs text-gray-500 mt-0.5">
                                            {movie.year && <span>{movie.year}</span>}
                                            {movie.year && movie.scenes_count > 0 && <span> · </span>}
                                            {movie.scenes_count > 0 && (
                                                <span>{movie.scenes_count} {scenesWord[locale] || scenesWord.en}</span>
                                            )}
                                        </p>
                                    </div>
                                </a>
                            );
                        })
                    ) : (
                        <p className="text-gray-500 text-sm py-8 text-center">
                            {noMoviesLabel[locale] || noMoviesLabel.en}
                        </p>
                    )}
                </div>
            )}

            {currentTab === 'similar' && (
                <div>
                    {similarCelebrities.length > 0 ? (
                        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                            {similarCelebrities.map((celeb) => (
                                <CelebrityCard key={celeb.id} celebrity={celeb} locale={locale} />
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-500 text-sm py-8 text-center">
                            {noSimilarLabel[locale] || noSimilarLabel.en}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
