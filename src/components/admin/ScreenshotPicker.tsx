'use client';

import { useState } from 'react';
import ScreenshotLightbox from './ScreenshotLightbox';
import VideoScreenshotCapture from './VideoScreenshotCapture';

interface Props {
    videoId: string;
    currentThumbnail: string | null;
    screenshots: string[] | null;
    videoUrl?: string | null;
}

export default function ScreenshotPicker({ videoId, currentThumbnail, screenshots, videoUrl }: Props) {
    const [active, setActive] = useState<string | null>(currentThumbnail);
    const [loading, setLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [allScreenshots, setAllScreenshots] = useState<string[]>(
        Array.isArray(screenshots) ? screenshots : []
    );

    if (allScreenshots.length === 0 && !videoUrl) return null;

    async function pick(url: string) {
        if (url === active) return;
        setLoading(url);
        setError(null);
        setSuccess(false);

        try {
            const res = await fetch(`/api/admin/videos/${videoId}/thumbnail`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ screenshot_url: url }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                setError(data.error || 'Failed to update thumbnail');
            } else {
                setActive(url);
                setSuccess(true);
                setTimeout(() => setSuccess(false), 2000);
            }
        } catch {
            setError('Network error');
        } finally {
            setLoading(null);
        }
    }

    function handleScreenshotCaptured(url: string) {
        setAllScreenshots(prev => [...prev, url]);
    }

    return (
        <div className="space-y-4">
            {/* Screenshot grid */}
            {allScreenshots.length > 0 && (
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-medium text-gray-300">
                            Скриншоты
                            <span className="ml-2 text-xs text-gray-600">({allScreenshots.length})</span>
                        </h3>
                        <div className="flex items-center gap-2">
                            {success && (
                                <span className="text-xs text-green-400">✓ Превью обновлено</span>
                            )}
                            {error && (
                                <span className="text-xs text-red-400">{error}</span>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                        {allScreenshots.map((url, i) => {
                            const isActive = url === active;
                            const isLoading = url === loading;
                            const displayUrl = url.startsWith('http') ? url : `https://celebskin-cdn.b-cdn.net/${url.replace(/^\//, '')}`;
                            return (
                                <div key={i} className="relative group">
                                    <button
                                        onClick={() => setLightboxIndex(i)}
                                        className={`relative aspect-video w-full overflow-hidden rounded-lg border-2 transition-all ${isActive
                                                ? 'border-green-500 ring-2 ring-green-500/30'
                                                : 'border-transparent hover:border-gray-500'
                                            }`}
                                        title="Открыть полный размер"
                                    >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={displayUrl}
                                            alt={`Скриншот ${i + 1}`}
                                            className={`h-full w-full object-cover ${isLoading ? 'opacity-40' : ''}`}
                                            loading="lazy"
                                        />

                                        {/* Fullscreen icon on hover */}
                                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                                            <svg className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                                            </svg>
                                        </span>

                                        {isActive && (
                                            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold text-white">
                                                ✓
                                            </span>
                                        )}
                                        {isLoading && (
                                            <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                                                <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                    <path className="opacity-75" fill="currentColor"
                                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                </svg>
                                            </span>
                                        )}
                                    </button>

                                    {/* Quick set thumbnail button */}
                                    {!isActive && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); pick(url); }}
                                            disabled={loading !== null}
                                            className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-[#e50914] hover:text-white transition-all disabled:cursor-wait"
                                            title="Установить как превью"
                                        >
                                            Превью
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Video screenshot capture */}
            {videoUrl && (
                <VideoScreenshotCapture
                    videoId={videoId}
                    videoUrl={videoUrl}
                    onScreenshotCaptured={handleScreenshotCaptured}
                />
            )}

            {/* Lightbox */}
            {lightboxIndex !== null && (
                <ScreenshotLightbox
                    screenshots={allScreenshots}
                    currentIndex={lightboxIndex}
                    currentThumbnail={active}
                    onClose={() => setLightboxIndex(null)}
                    onNavigate={setLightboxIndex}
                    onSetThumbnail={(url) => {
                        pick(url);
                        setLightboxIndex(null);
                    }}
                />
            )}
        </div>
    );
}
