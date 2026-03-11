'use client';

import { useEffect, useCallback } from 'react';

interface Props {
    screenshots: string[];
    currentIndex: number;
    currentThumbnail: string | null;
    onClose: () => void;
    onNavigate: (index: number) => void;
    onSetThumbnail: (url: string) => void;
}

export default function ScreenshotLightbox({
    screenshots,
    currentIndex,
    currentThumbnail,
    onClose,
    onNavigate,
    onSetThumbnail,
}: Props) {
    const url = screenshots[currentIndex];
    const isActive = url === currentThumbnail;

    const goPrev = useCallback(() => {
        if (currentIndex > 0) onNavigate(currentIndex - 1);
    }, [currentIndex, onNavigate]);

    const goNext = useCallback(() => {
        if (currentIndex < screenshots.length - 1) onNavigate(currentIndex + 1);
    }, [currentIndex, screenshots.length, onNavigate]);

    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowLeft') goPrev();
            if (e.key === 'ArrowRight') goNext();
        }
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose, goPrev, goNext]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
            onClick={onClose}
        >
            {/* Close button */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 z-10 rounded-full bg-gray-800/80 p-2 text-gray-400 hover:text-white transition-colors"
            >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>

            {/* Counter */}
            <div className="absolute top-4 left-4 text-sm text-gray-400">
                {currentIndex + 1} / {screenshots.length}
            </div>

            {/* Nav: Previous */}
            {currentIndex > 0 && (
                <button
                    onClick={(e) => { e.stopPropagation(); goPrev(); }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-gray-800/80 p-3 text-gray-400 hover:text-white transition-colors"
                >
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
            )}

            {/* Nav: Next */}
            {currentIndex < screenshots.length - 1 && (
                <button
                    onClick={(e) => { e.stopPropagation(); goNext(); }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-gray-800/80 p-3 text-gray-400 hover:text-white transition-colors"
                >
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            )}

            {/* Image */}
            <div
                className="max-h-[85vh] max-w-[90vw]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={url}
                    alt={`Скриншот ${currentIndex + 1}`}
                    className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
                />
            </div>

            {/* Bottom bar */}
            <div
                className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={() => onSetThumbnail(url)}
                    disabled={isActive}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                        isActive
                            ? 'bg-green-700/30 text-green-400 cursor-default'
                            : 'bg-[#e50914] text-white hover:bg-red-700'
                    }`}
                >
                    {isActive ? '✓ Это текущее превью' : 'Установить как превью'}
                </button>
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-gray-700/80 px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
                >
                    Открыть оригинал
                </a>
            </div>
        </div>
    );
}
