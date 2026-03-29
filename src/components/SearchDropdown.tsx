'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface SearchRow {
    entity_type: string;
    entity_id: string;
    entity_slug: string;
    display_name: string;
    rank_score: number;
    match_type: string;
}

interface SearchResult {
    tags: SearchRow[];
    celebrities: SearchRow[];
    collections: SearchRow[];
    videos: SearchRow[];
}

const EMPTY: SearchResult = { tags: [], celebrities: [], collections: [], videos: [] };

function totalCount(r: SearchResult): number {
    return r.tags.length + r.celebrities.length + r.collections.length + r.videos.length;
}

export default function SearchDropdown({ locale }: { locale: string }) {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [phase1, setPhase1] = useState<SearchResult>(EMPTY);
    const [phase2, setPhase2] = useState<SearchResult>(EMPTY);
    const [loadingP1, setLoadingP1] = useState(false);
    const [loadingP2, setLoadingP2] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    // Close on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const fetchPhase = useCallback(async (q: string, phase: '1' | '2') => {
        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&phase=${phase}&lang=${locale}`);
            if (!res.ok) return EMPTY;
            return (await res.json()) as SearchResult;
        } catch {
            return EMPTY;
        }
    }, [locale]);

    // Debounced search
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        if (query.length < 2) {
            setPhase1(EMPTY);
            setPhase2(EMPTY);
            setOpen(false);
            return;
        }

        debounceRef.current = setTimeout(async () => {
            setLoadingP1(true);
            setPhase2(EMPTY);

            const r1 = await fetchPhase(query, '1');
            setPhase1(r1);
            setLoadingP1(false);
            setOpen(true);

            // Auto-trigger phase 2 if < 20 results
            if (totalCount(r1) < 20) {
                setLoadingP2(true);
                const r2 = await fetchPhase(query, '2');
                setPhase2(r2);
                setLoadingP2(false);
            }
        }, 400);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, fetchPhase]);

    function goToSearch(q: string) {
        setOpen(false);
        router.push(`/${locale}/search?q=${encodeURIComponent(q)}`);
        // Notify search page about query change (for same-page navigation)
        window.dispatchEvent(new CustomEvent('header-search', { detail: q }));
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (query.trim()) goToSearch(query.trim());
        }
        if (e.key === 'Escape') {
            setOpen(false);
        }
    }

    function navigate(href: string) {
        setOpen(false);
        router.push(href);
    }

    // Merge phase 2 results (only new entity_ids not in phase 1)
    const p1Ids = new Set([
        ...phase1.tags.map(r => r.entity_id),
        ...phase1.celebrities.map(r => r.entity_id),
        ...phase1.collections.map(r => r.entity_id),
        ...phase1.videos.map(r => r.entity_id),
    ]);
    const p2New: SearchResult = {
        tags: phase2.tags.filter(r => !p1Ids.has(r.entity_id)),
        celebrities: phase2.celebrities.filter(r => !p1Ids.has(r.entity_id)),
        collections: phase2.collections.filter(r => !p1Ids.has(r.entity_id)),
        videos: phase2.videos.filter(r => !p1Ids.has(r.entity_id)),
    };
    const hasP2 = totalCount(p2New) > 0;

    const hasResults = totalCount(phase1) > 0 || hasP2;
    const showDropdown = open && query.length >= 2 && (hasResults || loadingP1 || loadingP2);

    return (
        <div ref={wrapperRef} className="relative w-full flex-1">
            <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => { if (query.length >= 2 && hasResults) setOpen(true); }}
                onKeyDown={handleKeyDown}
                placeholder={locale === 'ru' ? 'Поиск...' : 'Search actors, movies...'}
                className="w-full bg-[#161411]/80 border border-brand-accent/30 rounded-full py-2 pl-11 pr-4 text-[15px] text-brand-gold-light placeholder-brand-secondary/60 focus:outline-none focus:ring-1 focus:ring-brand-accent/80 focus:border-brand-accent/80 transition-all shadow-inner"
                autoComplete="off"
            />
            <button
                type="button"
                onClick={() => {
                    if (query.trim()) goToSearch(query.trim());
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-secondary hover:text-brand-gold-light transition-colors"
            >
                <svg className="w-[20px] h-[20px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            </button>

            {showDropdown && (
                <div className="absolute top-full left-0 right-0 mt-2 rounded-2xl border border-brand-accent/40 bg-[#11100e] shadow-[0_10px_40px_rgba(0,0,0,0.9)] max-h-[70vh] overflow-y-auto z-50 scrollbar-thin scrollbar-thumb-brand-accent/30">
                    {loadingP1 && !hasResults && (
                        <div className="px-4 py-6 text-center text-brand-secondary/60 text-sm">
                            <Spinner /> {locale === 'ru' ? 'Поиск...' : 'Searching...'}
                        </div>
                    )}

                    {/* Phase 1 results */}
                    <ResultsBlock results={phase1} locale={locale} onNavigate={navigate} />

                    {/* Phase 2 divider + results */}
                    {(hasP2 || loadingP2) && (
                        <div className="animate-fadeIn">
                            <div className="flex items-center gap-2 px-4 py-2 border-t border-brand-accent/20">
                                <span className="text-xs text-brand-secondary/50">
                                    {loadingP2
                                        ? <><Spinner /> {locale === 'ru' ? 'Ищу ещё...' : 'Finding more...'}</>
                                        : <>{locale === 'ru' ? '✨ Ещё результаты' : '✨ More results'}</>
                                    }
                                </span>
                            </div>
                            {hasP2 && <ResultsBlock results={p2New} locale={locale} onNavigate={navigate} />}
                        </div>
                    )}

                    {!loadingP1 && !hasResults && !loadingP2 && (
                        <div className="px-4 py-6 text-center text-brand-secondary/50 text-sm">
                            {locale === 'ru' ? 'Ничего не найдено' : 'No results found'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Sub-components ──

function Spinner() {
    return (
        <svg className="inline w-3.5 h-3.5 mr-1 animate-spin text-brand-accent/60" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
}

function ResultsBlock({
    results,
    locale,
    onNavigate,
}: {
    results: SearchResult;
    locale: string;
    onNavigate: (href: string) => void;
}) {
    return (
        <>
            {/* Tags */}
            {results.tags.length > 0 && (
                <Section title={locale === 'ru' ? 'ТЕГИ' : 'TAGS'}>
                    <div className="flex flex-wrap gap-2 px-4 pb-2">
                        {results.tags.map(tag => (
                            <button
                                key={tag.entity_id}
                                onClick={() => onNavigate(`/${locale}/video?tag=${tag.entity_slug}`)}
                                className="px-3 py-1 text-xs font-medium rounded-full bg-brand-accent/15 border border-brand-accent/30 text-brand-gold-light hover:bg-brand-accent/25 hover:border-brand-accent/50 transition-colors"
                            >
                                {tag.display_name}
                            </button>
                        ))}
                    </div>
                </Section>
            )}

            {/* Celebrities */}
            {results.celebrities.length > 0 && (
                <Section title={locale === 'ru' ? 'ЗНАМЕНИТОСТИ' : 'CELEBRITIES'}>
                    {results.celebrities.slice(0, 5).map(celeb => (
                        <button
                            key={celeb.entity_id}
                            onClick={() => onNavigate(`/${locale}/celebrity/${celeb.entity_slug}`)}
                            className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[#1a1815] transition-colors text-left"
                        >
                            <div className="w-8 h-8 rounded-full bg-brand-accent/10 border border-brand-accent/20 flex items-center justify-center shrink-0">
                                <svg className="w-4 h-4 text-brand-accent/50" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                                </svg>
                            </div>
                            <span className="text-sm text-[#e8e6df] truncate">{celeb.display_name}</span>
                        </button>
                    ))}
                </Section>
            )}

            {/* Collections */}
            {results.collections.length > 0 && (
                <Section title={locale === 'ru' ? 'КОЛЛЕКЦИИ' : 'COLLECTIONS'}>
                    {results.collections.slice(0, 4).map(col => (
                        <button
                            key={col.entity_id}
                            onClick={() => onNavigate(`/${locale}/collection/${col.entity_slug}`)}
                            className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[#1a1815] transition-colors text-left"
                        >
                            <div className="w-8 h-8 rounded-md bg-brand-accent/10 border border-brand-accent/20 flex items-center justify-center shrink-0">
                                <svg className="w-4 h-4 text-brand-accent/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                </svg>
                            </div>
                            <span className="text-sm text-[#e8e6df] truncate">{col.display_name}</span>
                        </button>
                    ))}
                </Section>
            )}

            {/* Videos */}
            {results.videos.length > 0 && (
                <Section title={locale === 'ru' ? 'ВИДЕО' : 'VIDEOS'}>
                    {results.videos.slice(0, 6).map(vid => (
                        <button
                            key={vid.entity_id}
                            onClick={() => onNavigate(`/${locale}/video/${vid.entity_slug}`)}
                            className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[#1a1815] transition-colors text-left"
                        >
                            <div className="w-12 h-8 rounded bg-brand-accent/10 border border-brand-accent/20 flex items-center justify-center shrink-0">
                                <svg className="w-4 h-4 text-brand-accent/50" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            </div>
                            <span className="text-sm text-[#e8e6df] truncate">{vid.display_name}</span>
                        </button>
                    ))}
                </Section>
            )}
        </>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="py-1">
            <div className="px-4 py-1.5">
                <span className="text-[10px] font-bold tracking-widest text-brand-accent/60 uppercase">{title}</span>
            </div>
            {children}
        </div>
    );
}
