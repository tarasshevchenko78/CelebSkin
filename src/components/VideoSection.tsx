'use client';

import { useState } from 'react';
import VideoCard from '@/components/VideoCard';
import type { Video } from '@/lib/types';

const showMoreLabel: Record<string, string> = {
    en: 'Show more', ru: 'Показать ещё', de: 'Mehr anzeigen',
    fr: 'Afficher plus', es: 'Mostrar más', pt: 'Mostrar mais',
    it: 'Mostra di più', pl: 'Pokaż więcej', nl: 'Meer tonen',
    tr: 'Daha fazla göster',
};

interface VideoSectionProps {
    initialVideos: Video[];
    sort: 'popular' | 'newest';
    loadMoreCount: number;
    locale: string;
}

export default function VideoSection({ initialVideos, sort, loadMoreCount, locale }: VideoSectionProps) {
    const [videos,  setVideos]  = useState<Video[]>(initialVideos);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(initialVideos.length >= loadMoreCount);

    const loadMore = async () => {
        setLoading(true);
        try {
            const res  = await fetch(`/api/videos?sort=${sort}&offset=${videos.length}&limit=${loadMoreCount}`);
            const more = await res.json() as Video[];
            setVideos(prev => [...prev, ...more]);
            if (more.length < loadMoreCount) setHasMore(false);
        } catch {
            // silent fail
        } finally {
            setLoading(false);
        }
    };

    const label = showMoreLabel[locale] || showMoreLabel.en;

    return (
        <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                {videos.map((video) => (
                    <VideoCard key={video.id} video={video} locale={locale} />
                ))}
            </div>
            {hasMore && (
                <div className="mt-4 flex justify-center">
                    <button
                        onClick={loadMore}
                        disabled={loading}
                        className="border border-brand-accent text-brand-accent px-6 py-2 rounded hover:bg-brand-accent/10 transition-colors text-sm disabled:opacity-50"
                    >
                        {loading ? '...' : label}
                    </button>
                </div>
            )}
        </>
    );
}
