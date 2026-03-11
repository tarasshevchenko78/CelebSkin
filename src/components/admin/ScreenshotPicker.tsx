'use client';

import { useState } from 'react';

interface Props {
    videoId: string;
    currentThumbnail: string | null;
    screenshots: string[] | null;
}

export default function ScreenshotPicker({ videoId, currentThumbnail, screenshots }: Props) {
    const [active, setActive]   = useState<string | null>(currentThumbnail);
    const [loading, setLoading] = useState<string | null>(null); // url being set
    const [error, setError]     = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const all: string[] = Array.isArray(screenshots) ? screenshots : [];

    if (all.length === 0) return null;

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

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-300">
                    Выбор превью
                    <span className="ml-2 text-xs text-gray-600">({all.length} скриншотов)</span>
                </h3>
                {success && (
                    <span className="text-xs text-green-400">✓ Превью обновлено</span>
                )}
                {error && (
                    <span className="text-xs text-red-400">{error}</span>
                )}
            </div>

            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                {all.map((url, i) => {
                    const isActive  = url === active;
                    const isLoading = url === loading;
                    return (
                        <button
                            key={i}
                            onClick={() => pick(url)}
                            disabled={loading !== null}
                            className={`relative aspect-video overflow-hidden rounded-lg border-2 transition-all ${
                                isActive
                                    ? 'border-green-500 ring-2 ring-green-500/30'
                                    : 'border-transparent hover:border-gray-500'
                            } disabled:cursor-wait`}
                            title={isActive ? 'Текущее превью' : 'Установить как превью'}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={url}
                                alt={`Скриншот ${i + 1}`}
                                className={`h-full w-full object-cover ${isLoading ? 'opacity-40' : ''}`}
                                loading="lazy"
                            />
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
                    );
                })}
            </div>
        </div>
    );
}
