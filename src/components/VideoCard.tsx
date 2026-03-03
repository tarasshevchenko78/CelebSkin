'use client';

import { useState } from 'react';
import type { Video } from '@/lib/types';
import { getLocalizedField, getLocalizedSlug } from '@/lib/i18n';

function formatViews(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return count.toString();
}

interface VideoCardProps {
    video: Video;
    locale: string;
    size?: 'sm' | 'md' | 'lg';
}

export default function VideoCard({ video, locale, size = 'md' }: VideoCardProps) {
    const [imgError, setImgError] = useState(false);
    const title = getLocalizedField(video.title, locale);
    const slug = getLocalizedSlug(video.slug, locale);
    const celebrity = video.celebrities?.[0];

    const sizeClasses = {
        sm: 'text-xs',
        md: 'text-sm',
        lg: 'text-base',
    };

    return (
        <a
            href={`/${locale}/video/${slug}`}
            className="group block rounded-lg overflow-hidden transition-transform duration-200 hover:scale-[1.02]"
        >
            {/* Thumbnail */}
            <div className="relative aspect-video bg-brand-card overflow-hidden rounded-lg">
                {video.thumbnail_url && !imgError ? (
                    <img
                        src={video.thumbnail_url}
                        alt={title}
                        loading="lazy"
                        onError={() => setImgError(true)}
                        className="w-full h-full object-cover transition-all duration-300 group-hover:brightness-110 group-hover:scale-105"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-brand-card to-brand-hover">
                        <svg className="w-10 h-10 text-brand-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                )}

                {/* Duration badge */}
                {video.duration_formatted && (
                    <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                        {video.duration_formatted}
                    </span>
                )}

                {/* Quality badge */}
                {video.quality && (
                    <span className="absolute top-1.5 right-1.5 bg-brand-accent text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                        {video.quality}
                    </span>
                )}

                {/* Play overlay on hover */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/20">
                    <div className="w-10 h-10 rounded-full bg-brand-accent/90 flex items-center justify-center">
                        <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* Info */}
            <div className="mt-2 px-0.5">
                <h3 className={`${sizeClasses[size]} font-medium text-brand-text line-clamp-2 leading-snug group-hover:text-white transition-colors`}>
                    {title}
                </h3>
                <div className={`mt-1 flex items-center gap-2 ${size === 'sm' ? 'text-[10px]' : 'text-xs'} text-brand-secondary`}>
                    {celebrity && (
                        <span className="hover:text-brand-accent transition-colors truncate">
                            {celebrity.name}
                        </span>
                    )}
                    {celebrity && video.views_count > 0 && <span>·</span>}
                    {video.views_count > 0 && (
                        <span className="shrink-0">{formatViews(video.views_count)} views</span>
                    )}
                </div>
            </div>
        </a>
    );
}
