'use client';

import { useState, useEffect, useCallback } from 'react';

interface ScreenshotGalleryProps {
    screenshots: string[];
}

export default function ScreenshotGallery({ screenshots }: ScreenshotGalleryProps) {
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    const close = useCallback(() => setOpenIndex(null), []);
    const prev = useCallback(() => {
        setOpenIndex((i) => (i !== null ? (i - 1 + screenshots.length) % screenshots.length : null));
    }, [screenshots.length]);
    const next = useCallback(() => {
        setOpenIndex((i) => (i !== null ? (i + 1) % screenshots.length : null));
    }, [screenshots.length]);

    useEffect(() => {
        if (openIndex === null) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowLeft') prev();
            else if (e.key === 'ArrowRight') next();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [openIndex, close, prev, next]);

    // Lock body scroll when lightbox is open
    useEffect(() => {
        if (openIndex !== null) {
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = ''; };
        }
    }, [openIndex]);

    return (
        <>
            {/* Thumbnail grid */}
            <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
                {screenshots.map((url, i) => (
                    <button
                        key={i}
                        onClick={() => setOpenIndex(i)}
                        className="rounded-md overflow-hidden cursor-pointer hover:brightness-125 transition-all ring-1 ring-gray-800 hover:ring-red-600"
                    >
                        <img
                            src={url}
                            alt={`Screenshot ${i + 1}`}
                            loading="lazy"
                            className="aspect-video w-full object-cover"
                        />
                    </button>
                ))}
            </div>

            {/* Lightbox overlay */}
            {openIndex !== null && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center"
                    onClick={(e) => { if (e.target === e.currentTarget) close(); }}
                >
                    {/* Close button */}
                    <button
                        onClick={close}
                        className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors z-10"
                        aria-label="Close"
                    >
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>

                    {/* Navigation arrows */}
                    {screenshots.length > 1 && (
                        <>
                            <button
                                onClick={prev}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
                                aria-label="Previous"
                            >
                                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                            <button
                                onClick={next}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
                                aria-label="Next"
                            >
                                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </button>
                        </>
                    )}

                    {/* Main image */}
                    <img
                        src={screenshots[openIndex]}
                        alt={`Screenshot ${openIndex + 1}`}
                        className="max-w-[90vw] max-h-[75vh] object-contain rounded-lg"
                    />

                    {/* Counter */}
                    <div className="mt-3 text-sm text-white/50">
                        {openIndex + 1} / {screenshots.length}
                    </div>

                    {/* Thumbnail strip */}
                    <div className="mt-3 flex gap-1.5 overflow-x-auto max-w-[90vw] pb-2">
                        {screenshots.map((url, i) => (
                            <button
                                key={i}
                                onClick={() => setOpenIndex(i)}
                                className={`shrink-0 w-16 rounded overflow-hidden transition-all ${
                                    i === openIndex
                                        ? 'ring-2 ring-brand-accent brightness-110'
                                        : 'opacity-50 hover:opacity-80'
                                }`}
                            >
                                <img
                                    src={url}
                                    alt={`Thumbnail ${i + 1}`}
                                    className="aspect-video w-full object-cover"
                                />
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
