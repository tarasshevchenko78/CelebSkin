'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Video } from '@/lib/types';
import { getLocalizedField, getLocalizedSlug } from '@/lib/i18n';

// ============================================
// Helpers
// ============================================

function formatDuration(seconds: number): string {
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

function isNew(createdAt: string): boolean {
    const created = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - created.getTime();
    return diffMs < 7 * 24 * 60 * 60 * 1000; // 7 days
}

function isHD(quality: string | null): boolean {
    if (!quality) return false;
    return quality.includes('1080') || quality.includes('720');
}

// ============================================
// Props
// ============================================

interface VideoCardProps {
    video: Video;
    locale: string;
    size?: 'normal' | 'large' | 'featured';
}

// ============================================
// Component
// ============================================

export default function VideoCard({ video, locale, size = 'normal' }: VideoCardProps) {
    const [showPreview, setShowPreview] = useState(false);
    const [imgError, setImgError] = useState(false);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const title = getLocalizedField(video.title, locale);
    const slug = getLocalizedSlug(video.slug, locale);
    const celebrity = video.celebrities?.[0];

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const handleMouseEnter = useCallback(() => {
        if (!video.preview_url || typeof window === 'undefined' || window.innerWidth < 768) return;
        timeoutRef.current = setTimeout(() => {
            setShowPreview(true);
        }, 300);
    }, [video.preview_url]);

    const handleMouseLeave = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setShowPreview(false);
    }, []);

    // Determine top-left priority badge
    const showNewBadge = isNew(video.created_at);
    const showHDBadge = !showNewBadge && isHD(video.quality);

    // Duration display
    const duration = video.duration_seconds
        ? formatDuration(video.duration_seconds)
        : video.duration_formatted || null;

    // ============================================
    // Featured variant — title overlays thumbnail
    // ============================================
    if (size === 'featured') {
        return (
            <a
                href={`/${locale}/video/${slug}`}
                className="group relative aspect-video rounded-xl overflow-hidden bg-[#111113] border border-[#1a1a1e] transition-transform duration-200 hover:scale-[1.03] block"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {/* Thumbnail */}
                {video.thumbnail_url && !imgError ? (
                    <img
                        src={video.thumbnail_url}
                        alt={title}
                        loading="lazy"
                        onError={() => setImgError(true)}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.08]"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[#111113] to-[#1a1a1e] flex items-center justify-center">
                        <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                )}

                {/* Video preview on hover */}
                {showPreview && video.preview_url && (
                    <video
                        ref={videoRef}
                        src={video.preview_url}
                        muted
                        autoPlay
                        loop
                        playsInline
                        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${showPreview ? 'opacity-100' : 'opacity-0'}`}
                    />
                )}

                {/* Bottom gradient overlay */}
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

                {/* Celebrity badge — top-left */}
                {celebrity && (
                    <span className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-0.5 rounded-full z-10">
                        {celebrity.name}
                    </span>
                )}

                {/* Priority badge — top-right (featured cards show celebrity top-left, so priority goes top-right) */}
                {showNewBadge && (
                    <span className="absolute top-2 right-2 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded z-10">
                        NEW
                    </span>
                )}
                {showHDBadge && (
                    <span className="absolute top-2 right-2 bg-gray-700 text-white text-[10px] font-bold px-1.5 py-0.5 rounded z-10">
                        HD
                    </span>
                )}

                {/* Duration badge — bottom-right */}
                {duration && (
                    <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded z-10">
                        {duration}
                    </span>
                )}

                {/* Title overlay — bottom */}
                <div className="absolute bottom-3 left-3 right-16 z-10">
                    <h3 className="text-white font-semibold text-sm sm:text-base line-clamp-2 drop-shadow-lg">
                        {title}
                    </h3>
                </div>

                {/* Play icon on hover */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                    <div className="w-12 h-12 rounded-full bg-red-600/90 flex items-center justify-center shadow-lg">
                        <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    </div>
                </div>
            </a>
        );
    }

    // ============================================
    // Normal & Large variants
    // ============================================

    const isLarge = size === 'large';

    return (
        <a
            href={`/${locale}/video/${slug}`}
            className="group block relative overflow-hidden rounded-lg bg-[#111113] border border-[#1a1a1e] transition-transform duration-200 hover:scale-[1.03]"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* Thumbnail wrapper */}
            <div className="relative aspect-video overflow-hidden">
                {/* Static thumbnail */}
                {video.thumbnail_url && !imgError ? (
                    <img
                        src={video.thumbnail_url}
                        alt={title}
                        loading="lazy"
                        onError={() => setImgError(true)}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.08]"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[#111113] to-[#1a1a1e] flex items-center justify-center">
                        <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                )}

                {/* Video preview on hover */}
                {showPreview && video.preview_url && (
                    <video
                        ref={videoRef}
                        src={video.preview_url}
                        muted
                        autoPlay
                        loop
                        playsInline
                        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${showPreview ? 'opacity-100' : 'opacity-0'}`}
                    />
                )}

                {/* Bottom gradient */}
                <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

                {/* Duration badge — bottom-right */}
                {duration && (
                    <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded z-10">
                        {duration}
                    </span>
                )}

                {/* Priority badge — top-left (ONE only) */}
                {showNewBadge && (
                    <span className="absolute top-1.5 left-1.5 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded z-10">
                        NEW
                    </span>
                )}
                {showHDBadge && (
                    <span className="absolute top-1.5 left-1.5 bg-gray-700 text-white text-[10px] font-bold px-1.5 py-0.5 rounded z-10">
                        HD
                    </span>
                )}
            </div>

            {/* Text area */}
            <div className={isLarge ? 'p-3' : 'p-2.5'}>
                <h3 className={`${isLarge ? 'text-base font-semibold' : 'text-sm font-medium'} text-white line-clamp-2 leading-snug group-hover:text-gray-200 transition-colors`}>
                    {title}
                </h3>
                {celebrity && (
                    <div className="mt-1 text-xs text-gray-400">
                        <span
                            className="hover:text-red-400 transition-colors truncate"
                            onClick={(e) => {
                                e.preventDefault();
                                window.location.href = `/${locale}/celebrity/${celebrity.slug}`;
                            }}
                        >
                            {celebrity.name}
                        </span>
                    </div>
                )}
            </div>
        </a>
    );
}
