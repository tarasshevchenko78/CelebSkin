'use client';

import { useState, useRef } from 'react';

interface Props {
    videoId: string;
    videoUrl: string | null;
    onScreenshotCaptured: (url: string) => void;
}

export default function VideoScreenshotCapture({ videoId, videoUrl, onScreenshotCaptured }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [capturing, setCapturing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);

    if (!videoUrl) return null;

    async function captureFrame() {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        setCapturing(true);
        setError(null);

        try {
            // Try canvas capture (client-side)
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas context not available');

            ctx.drawImage(video, 0, 0);

            const blob = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, 'image/jpeg', 0.92)
            );

            if (!blob) throw new Error('Failed to create image blob');

            // Upload to server
            const formData = new FormData();
            formData.append('file', blob, `screenshot-${Date.now()}.jpg`);

            const res = await fetch(`/api/admin/videos/${videoId}/screenshot`, {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });
            const data = await res.json();

            if (data.success && data.url) {
                onScreenshotCaptured(data.url);
            } else {
                setError(data.error || 'Ошибка загрузки скриншота');
            }
        } catch (err) {
            // CORS error — try server-side capture
            if (err instanceof DOMException && err.name === 'SecurityError') {
                await captureViaServer(video.currentTime);
            } else {
                setError(err instanceof Error ? err.message : 'Ошибка захвата кадра');
            }
        } finally {
            setCapturing(false);
        }
    }

    async function captureViaServer(timestamp: number) {
        try {
            const res = await fetch(`/api/admin/videos/${videoId}/screenshot`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timestamp: Math.floor(timestamp) }),
            });
            const data = await res.json();

            if (data.success && data.url) {
                onScreenshotCaptured(data.url);
            } else {
                setError(data.error || 'Серверный захват не удался');
            }
        } catch {
            setError('Ошибка сети при серверном захвате');
        }
    }

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full px-4 py-3 flex items-center justify-between text-sm text-gray-300 hover:bg-gray-800/50 transition-colors"
            >
                <span className="font-medium">Захват скриншота с видео</span>
                <svg className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {expanded && (
                <div className="p-4 border-t border-gray-800 space-y-3">
                    <p className="text-[10px] text-gray-600">
                        Поставьте видео на паузу в нужном моменте и нажмите &quot;Сделать скриншот&quot;
                    </p>

                    {/* Video player */}
                    <video
                        ref={videoRef}
                        src={videoUrl}
                        controls
                        crossOrigin="anonymous"
                        className="w-full rounded-lg bg-black max-h-80"
                        preload="metadata"
                    />

                    {/* Hidden canvas for capture */}
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Capture button */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={captureFrame}
                            disabled={capturing}
                            className="rounded-lg bg-[#e50914] px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-wait transition-colors"
                        >
                            {capturing ? 'Захват...' : 'Сделать скриншот'}
                        </button>
                        {error && (
                            <span className="text-xs text-red-400">{error}</span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
