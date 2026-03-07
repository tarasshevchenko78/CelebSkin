'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

interface VideoPlayerProps {
    src?: string | null;
    poster?: string | null;
    title?: string;
}

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VideoPlayer({ src, poster, title }: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);

    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [videoError, setVideoError] = useState<string | null>(null);
    const hideTimeout = useRef<NodeJS.Timeout | null>(null);

    const togglePlay = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) {
            const playPromise = v.play();
            if (playPromise !== undefined) {
                playPromise
                    .then(() => setPlaying(true))
                    .catch((err) => {
                        console.warn('[VideoPlayer] play() rejected:', err.message);
                        setPlaying(false);
                    });
            } else {
                setPlaying(true);
            }
        } else {
            v.pause();
            setPlaying(false);
        }
    }, []);

    const toggleMute = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        setMuted(v.muted);
    }, []);

    const toggleFullscreen = useCallback(() => {
        const c = containerRef.current;
        if (!c) return;
        if (!document.fullscreenElement) {
            c.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    }, []);

    const skip = useCallback((delta: number) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
    }, []);

    const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const v = videoRef.current;
        const bar = progressRef.current;
        if (!v || !bar) return;
        const rect = bar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        v.currentTime = ratio * v.duration;
    }, []);

    const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const v = videoRef.current;
        if (!v) return;
        const val = parseFloat(e.target.value);
        v.volume = val;
        setVolume(val);
        setMuted(val === 0);
    }, []);

    const resetHideTimer = useCallback(() => {
        setShowControls(true);
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
        hideTimeout.current = setTimeout(() => {
            if (playing) setShowControls(false);
        }, 3000);
    }, [playing]);

    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const onTime = () => setCurrentTime(v.currentTime);
        const onMeta = () => setDuration(v.duration);
        const onEnd = () => setPlaying(false);
        v.addEventListener('timeupdate', onTime);
        v.addEventListener('loadedmetadata', onMeta);
        v.addEventListener('ended', onEnd);
        return () => {
            v.removeEventListener('timeupdate', onTime);
            v.removeEventListener('loadedmetadata', onMeta);
            v.removeEventListener('ended', onEnd);
        };
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            switch (e.key) {
                case ' ': e.preventDefault(); togglePlay(); break;
                case 'ArrowLeft': skip(-5); break;
                case 'ArrowRight': skip(5); break;
                case 'f': case 'F': toggleFullscreen(); break;
                case 'm': case 'M': toggleMute(); break;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [togglePlay, skip, toggleFullscreen, toggleMute]);

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    // No source — show placeholder
    if (!src) {
        return (
            <div className="relative aspect-video w-full bg-black rounded-xl overflow-hidden flex items-center justify-center">
                {poster ? (
                    <img src={poster} alt={title || ''} className="w-full h-full object-cover opacity-50" />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900" />
                )}
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                    <div className="w-16 h-16 rounded-full bg-brand-accent/80 flex items-center justify-center mb-3 cursor-pointer hover:bg-brand-accent transition-colors">
                        <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    </div>
                    {title && <p className="text-white/70 text-sm">{title}</p>}
                    <p className="text-white/40 text-xs mt-1">Video preview unavailable</p>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="relative aspect-video w-full bg-black rounded-xl overflow-hidden group select-none"
            onMouseMove={resetHideTimer}
            onMouseLeave={() => playing && setShowControls(false)}
        >
            {videoError ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900">
                    <svg className="w-12 h-12 text-gray-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-gray-500 text-sm">Video unavailable</p>
                    <p className="text-gray-600 text-xs mt-1">{videoError}</p>
                </div>
            ) : (
            <video
                ref={videoRef}
                src={src}
                poster={poster || undefined}
                preload="metadata"
                crossOrigin="anonymous"
                className="w-full h-full object-contain"
                onClick={togglePlay}
                onError={(e) => {
                    const v = e.currentTarget;
                    const err = v.error;
                    const msg = err ? `${err.code}: ${err.message || 'Unknown error'}` : 'Load failed';
                    console.error('[VideoPlayer] error:', msg, 'src:', src);
                    setVideoError(msg);
                }}
                playsInline
            />
            )}

            {/* Center play/pause overlay */}
            {!playing && (
                <div
                    className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer"
                    onClick={togglePlay}
                >
                    <div className="w-16 h-16 rounded-full bg-brand-accent/90 flex items-center justify-center hover:bg-brand-accent transition-all hover:scale-110">
                        <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    </div>
                </div>
            )}

            {/* Bottom controls bar */}
            <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-8 pb-2 px-3 transition-opacity duration-300 ${showControls || !playing ? 'opacity-100' : 'opacity-0'}`}>
                {/* Progress bar */}
                <div
                    ref={progressRef}
                    className="w-full h-1 bg-white/20 rounded-full cursor-pointer mb-2 group/progress hover:h-1.5 transition-all"
                    onClick={handleSeek}
                >
                    <div
                        className="h-full bg-brand-accent rounded-full relative"
                        style={{ width: `${progress}%` }}
                    >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-brand-accent rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity" />
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Play/Pause */}
                    <button onClick={togglePlay} className="text-white hover:text-brand-accent transition-colors">
                        {playing ? (
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                        ) : (
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        )}
                    </button>

                    {/* Volume */}
                    <button onClick={toggleMute} className="text-white hover:text-brand-accent transition-colors">
                        {muted || volume === 0 ? (
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
                        ) : (
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-3.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
                        )}
                    </button>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={muted ? 0 : volume}
                        onChange={handleVolumeChange}
                        className="w-16 h-1 appearance-none bg-white/30 rounded-full cursor-pointer accent-brand-accent"
                    />

                    {/* Time */}
                    <span className="text-xs text-white/80 tabular-nums">
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </span>

                    <div className="flex-1" />

                    {/* Fullscreen */}
                    <button onClick={toggleFullscreen} className="text-white hover:text-brand-accent transition-colors">
                        {isFullscreen ? (
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" /></svg>
                        ) : (
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
