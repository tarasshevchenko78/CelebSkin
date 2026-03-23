'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getLocalizedSlug } from '@/lib/i18n';
import type { Video } from '@/lib/types';

interface HotMoment {
    timestamp_sec: number;
    intensity: number;
    label: string;
}

interface PreviewThumb {
    url: string;
    time: number;
    xPct: number;
}

interface VideoPlayerProps {
    src?: string | null;
    poster?: string | null;
    title?: string;
    durationSeconds?: number;
    hotMoments?: HotMoment[];
    screenshots?: string[];
    relatedVideos?: Video[];
    prevSlug?: string | null;
    nextSlug?: string | null;
    locale?: string;
    /** initial slug — used to detect slug change on fullscreen exit */
    initialSlug?: string;
}

function formatTime(seconds: number): string {
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${m}:${String(sec).padStart(2,'0')}`;
}

export default function VideoPlayer({
    src, poster, title, durationSeconds,
    hotMoments: initHotMoments = [],
    screenshots: initScreenshots = [],
    relatedVideos = [],
    prevSlug: initPrevSlug, nextSlug: initNextSlug,
    locale = 'en',
    initialSlug = '',
}: VideoPlayerProps) {
    const router       = useRouter();
    const videoRef     = useRef<HTMLVideoElement>(null);
    const outerRef     = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const progressRef  = useRef<HTMLDivElement>(null);
    const hideTimeout  = useRef<NodeJS.Timeout | null>(null);
    const pauseTimer   = useRef<NodeJS.Timeout | null>(null);

    // Drag-scroll for recommendations
    const recsRef        = useRef<HTMLDivElement>(null);
    const recsDragging   = useRef(false);
    const recsWasDragged = useRef(false);
    const recsStartX     = useRef(0);
    const recsScrollLeft = useRef(0);

    // Fix 2: in-player navigation state
    const [curSrc,       setCurSrc]       = useState(src || null);
    const [curPoster,    setCurPoster]    = useState(poster || null);
    const [curTitle,     setCurTitle]     = useState(title || '');
    const [curDuration,  setCurDuration]  = useState(durationSeconds || 0);
    const [curScreens,   setCurScreens]   = useState<string[]>(initScreenshots);
    const [curMoments,   setCurMoments]   = useState<HotMoment[]>(initHotMoments);
    const [curPrevSlug,  setCurPrevSlug]  = useState(initPrevSlug || null);
    const [curNextSlug,  setCurNextSlug]  = useState(initNextSlug || null);
    const [curSlug,      setCurSlug]      = useState(initialSlug);
    const [navLoading,   setNavLoading]   = useState(false);

    const [playing,       setPlaying]       = useState(false);
    const [currentTime,   setCurrentTime]   = useState(0);
    const [duration,      setDuration]      = useState(durationSeconds || 0);
    const [buffered,      setBuffered]       = useState(0);
    const [volume,        setVolume]         = useState(1);
    const [muted,         setMuted]          = useState(false);
    const [showControls,  setShowControls]  = useState(true);
    const [isFullscreen,  setIsFullscreen]  = useState(false);
    const [videoError,    setVideoError]    = useState<string | null>(null);
    const [previewThumb,  setPreviewThumb]  = useState<PreviewThumb | null>(null);
    const [hoveredMoment, setHoveredMoment] = useState<number | null>(null);
    const [showRecs,      setShowRecs]      = useState(false);

    useEffect(() => {
        if (durationSeconds && duration === 0) setDuration(durationSeconds);
    }, [durationSeconds, duration]);

    // Autoplay on mount
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        v.play().then(() => setPlaying(true)).catch(() => {});
    }, []);

    useEffect(() => {
        if (!playing) {
            pauseTimer.current = setTimeout(() => {
                if (relatedVideos.length > 0) setShowRecs(true);
            }, 500);
        } else {
            if (pauseTimer.current) clearTimeout(pauseTimer.current);
            setShowRecs(false);
        }
        return () => { if (pauseTimer.current) clearTimeout(pauseTimer.current); };
    }, [playing, relatedVideos.length]);

    // Fix 2: fullscreen exit — if slug changed, navigate to correct page URL
    useEffect(() => {
        const onFSChange = () => {
            const el = document.fullscreenElement ||
                ((document as unknown) as Record<string, unknown>)['webkitFullscreenElement'] as Element | null;
            setIsFullscreen(!!el);
            // On exit: sync URL to current video if it changed
            if (!el && curSlug && curSlug !== initialSlug) {
                router.replace(`/${locale}/video/${curSlug}`);
            }
        };
        document.addEventListener('fullscreenchange', onFSChange);
        document.addEventListener('webkitfullscreenchange', onFSChange);
        return () => {
            document.removeEventListener('fullscreenchange', onFSChange);
            document.removeEventListener('webkitfullscreenchange', onFSChange);
        };
    }, [curSlug, initialSlug, locale, router]);

    const togglePlay = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) { v.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
        else { v.pause(); setPlaying(false); }
    }, []);

    const toggleMute = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        setMuted(v.muted);
    }, []);

    const toggleFullscreen = useCallback(() => {
        // Use outerRef so recommendations (outside inner container) are visible in fullscreen
        const c = outerRef.current;
        if (!c) return;
        const fsEl = document.fullscreenElement ||
            ((document as unknown) as Record<string, unknown>)['webkitFullscreenElement'];
        if (!fsEl) {
            if (c.requestFullscreen) c.requestFullscreen();
            else (c as unknown as Record<string, () => void>)['webkitRequestFullscreen']?.();
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
            else ((document as unknown) as Record<string, () => void>)['webkitExitFullscreen']?.();
        }
    }, []);

    const skip = useCallback((delta: number) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = Math.max(0, Math.min(v.duration || duration, v.currentTime + delta));
    }, [duration]);

    const seekToRatio = useCallback((ratio: number) => {
        const v = videoRef.current;
        if (!v) return;
        const d = v.duration || duration;
        if (!d) return;
        const targetTime = Math.max(0, Math.min(d, ratio * d));
        if (v.readyState < 1) {
            v.load();
            v.addEventListener('loadedmetadata', () => { v.currentTime = targetTime; }, { once: true });
        } else {
            v.currentTime = targetTime;
        }
    }, [duration]);

    const getRatio = (clientX: number): number => {
        const bar = progressRef.current;
        if (!bar) return 0;
        const rect = bar.getBoundingClientRect();
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

    const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        seekToRatio(getRatio(e.clientX));
    }, [seekToRatio]);

    const handleProgressMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const ratio = getRatio(e.clientX);
        const time = ratio * (curDuration || durationSeconds || 0);
        if (curScreens.length > 0) {
            const idx = Math.min(Math.round(ratio * (curScreens.length - 1)), curScreens.length - 1);
            setPreviewThumb({ url: curScreens[idx], time, xPct: ratio });
        }
    }, [curScreens, curDuration, durationSeconds]);

    const handleTouchSeek = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        e.preventDefault();
        seekToRatio(getRatio(e.touches[0].clientX));
    }, [seekToRatio]);

    const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const v = videoRef.current;
        if (!v) return;
        const val = parseFloat(e.target.value);
        v.volume = val; setVolume(val); setMuted(val === 0);
    }, []);

    const resetHideTimer = useCallback(() => {
        setShowControls(true);
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
        hideTimeout.current = setTimeout(() => {
            if (videoRef.current && !videoRef.current.paused) setShowControls(false);
        }, 3000);
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            switch (e.key) {
                case ' ':          e.preventDefault(); togglePlay();      break;
                case 'ArrowLeft':  e.preventDefault(); skip(-5);          break;
                case 'ArrowRight': e.preventDefault(); skip(5);           break;
                case 'f': case 'F': toggleFullscreen(); break;
                case 'm': case 'M': toggleMute();       break;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [togglePlay, skip, toggleFullscreen, toggleMute]);

    // Fix 2: in-player navigation — loads next/prev WITHOUT leaving fullscreen
    const goToVideo = useCallback(async (slug: string) => {
        if (navLoading) return;
        setNavLoading(true);
        try {
            const res = await fetch(`/api/videos/by-slug/${encodeURIComponent(slug)}?locale=${locale}`);
            if (!res.ok) {
                // Fallback: regular navigation
                router.push(`/${locale}/video/${slug}`);
                return;
            }
            const data = await res.json();

            // Update video element in-place
            const v = videoRef.current;
            if (v && data.video_url) {
                v.src = data.video_url;
                v.poster = data.poster || '';
                v.load();
                v.addEventListener('canplay', () => {
                    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
                }, { once: true });
            }

            // Update all metadata state
            const localizedTitle = data.title
                ? (typeof data.title === 'object' ? (data.title[locale] || data.title['en'] || slug) : data.title)
                : slug;
            setCurSrc(data.video_url || null);
            setCurPoster(data.poster || null);
            setCurTitle(localizedTitle);
            setCurDuration(data.duration_seconds || 0);
            setDuration(data.duration_seconds || 0);
            setCurScreens(data.screenshots || []);
            setCurMoments(data.hot_moments || []);
            setCurPrevSlug(data.prevSlug || null);
            setCurNextSlug(data.nextSlug || null);
            setCurSlug(data.slug || slug);
            setCurrentTime(0);
            setBuffered(0);
            setVideoError(null);
            setShowRecs(false);
            setPreviewThumb(null);

            // Update browser URL without full navigation
            window.history.replaceState(null, '', `/${locale}/video/${data.slug || slug}`);
        } catch {
            router.push(`/${locale}/video/${slug}`);
        } finally {
            setNavLoading(false);
        }
    }, [navLoading, locale, router]);

    // Prev/Next with in-player nav (fullscreen) or router.push (normal)
    const goToPrev = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!curPrevSlug || curPrevSlug === curSlug) return;
        if (isFullscreen) {
            goToVideo(curPrevSlug);
        } else {
            router.push(`/${locale}/video/${curPrevSlug}`);
        }
    }, [curPrevSlug, isFullscreen, goToVideo, locale, router]);

    const goToNext = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!curNextSlug || curNextSlug === curSlug) return;
        if (isFullscreen) {
            goToVideo(curNextSlug);
        } else {
            router.push(`/${locale}/video/${curNextSlug}`);
        }
    }, [curNextSlug, isFullscreen, goToVideo, locale, router]);

    // Drag-scroll handlers for recommendations
    const onRecsMD = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        recsDragging.current = true;
        recsWasDragged.current = false;
        recsStartX.current = e.pageX - (recsRef.current?.offsetLeft ?? 0);
        recsScrollLeft.current = recsRef.current?.scrollLeft ?? 0;
        if (recsRef.current) recsRef.current.style.cursor = 'grabbing';
    }, []);
    const onRecsMU = useCallback(() => {
        recsDragging.current = false;
        if (recsRef.current) recsRef.current.style.cursor = 'grab';
    }, []);
    const onRecsMM = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!recsDragging.current || !recsRef.current) return;
        const x = e.pageX - recsRef.current.offsetLeft;
        if (Math.abs(x - recsStartX.current) > 5) {
            recsWasDragged.current = true;
            e.preventDefault();
            const walk = (x - recsStartX.current) * 1.2;
            recsRef.current.scrollLeft = recsScrollLeft.current - walk;
        }
    }, []);

    const progress   = duration > 0 ? (currentTime / duration) * 100 : 0;
    const ctrlVis    = showControls || !playing;
    const recsToShow = relatedVideos.slice(0, 20);

    if (!curSrc) {
        return (
            <div className="relative aspect-video w-full bg-black rounded-xl overflow-hidden flex items-center justify-center">
                {curPoster
                    ? <img src={curPoster} alt={curTitle} className="w-full h-full object-cover opacity-50" />
                    : <div className="w-full h-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900" />}
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                    <div className="w-16 h-16 rounded-full bg-brand-accent/80 flex items-center justify-center mb-3">
                        <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                    {curTitle && <p className="text-white/70 text-sm">{curTitle}</p>}
                    <p className="text-white/40 text-xs mt-1">Video preview unavailable</p>
                </div>
            </div>
        );
    }

    return (
        <div ref={outerRef} className="relative aspect-video w-full bg-black rounded-xl">
        <div
            ref={containerRef}
            className="absolute inset-0 rounded-xl overflow-hidden group/player select-none" onContextMenu={(e) => e.preventDefault()}
            onMouseMove={resetHideTimer}
            onMouseLeave={() => { if (playing) setShowControls(false); }}
        >
            {/* Video */}
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
                    src={curSrc}
                    poster={curPoster || undefined}
                    preload="metadata"
                    crossOrigin="anonymous"
                    className="w-full h-full object-contain"
                    playsInline
                    controlsList="nodownload"
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={togglePlay}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onProgress={(e) => {
                        const v = e.currentTarget;
                        if (v.buffered.length > 0 && v.duration)
                            setBuffered(v.buffered.end(v.buffered.length - 1) / v.duration * 100);
                    }}
                    onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration;
                        if (d && !isNaN(d) && d !== Infinity) setDuration(d);
                        else if (curDuration) setDuration(curDuration);
                    }}
                    onEnded={() => setPlaying(false)}
                    onError={(e) => {
                        const err = e.currentTarget.error;
                        setVideoError(err ? `${err.code}: ${err.message || 'Unknown error'}` : 'Load failed');
                    }}
                />
            )}

            {/* Click-to-play overlay (no button — use controls) */}
            {!playing && !showRecs && (
                <div className="absolute inset-0 cursor-pointer z-10" onClick={togglePlay} />
            )}

            {/* Nav loading indicator */}
            {navLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-30">
                    <div className="w-8 h-8 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
                </div>
            )}

            {/* Prev/Next arrows */}
            {curPrevSlug && (
                <button
                    className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center shadow-lg transition-all opacity-60 md:opacity-0 md:group-hover/player:opacity-100"
                    title="Previous"
                    onClick={goToPrev}
                >
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
            )}
            {curNextSlug && (
                <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center shadow-lg transition-all opacity-60 md:opacity-0 md:group-hover/player:opacity-100"
                    title="Next"
                    onClick={goToNext}
                >
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            )}

            {/* Controls bar */}
            <div className={`absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-10 pb-2.5 px-3 transition-opacity duration-300 ${ctrlVis ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>

                {/* Progress area */}
                <div className="relative mb-2.5">

                    {/* Fix 1: Screenshot preview popup — smaller on mobile */}
                    {previewThumb && (
                        <div className="absolute bottom-full mb-3 pointer-events-none z-40"
                            style={{ left: `clamp(60px, ${previewThumb.xPct * 100}%, calc(100% - 60px))`, transform: 'translateX(-50%)' }}>
                            <div className="w-[120px] sm:w-40 rounded overflow-hidden border-2 border-brand-accent bg-black shadow-[0_4px_24px_rgba(0,0,0,0.9)]">
                                <img src={previewThumb.url} alt="" className="w-full h-auto block" />
                                <div className="text-center text-[10px] sm:text-[11px] text-white py-0.5 bg-black/80 font-mono">{formatTime(previewThumb.time)}</div>
                            </div>
                            <div className="w-0 h-0 mx-auto border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-brand-accent" />
                        </div>
                    )}

                    {/* Hot moment tooltip */}
                    {hoveredMoment !== null && duration > 0 && curMoments[hoveredMoment] && (
                        <div className="absolute bottom-full mb-7 pointer-events-none z-40"
                            style={{ left: `${(curMoments[hoveredMoment].timestamp_sec / duration) * 100}%`, transform: 'translateX(-50%)' }}>
                            <div className="bg-black/90 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap border border-orange-500/50 shadow-lg">
                                🔥 {locale === 'en'
                                    ? curMoments[hoveredMoment].label
                                    : formatTime(curMoments[hoveredMoment].timestamp_sec)}
                            </div>
                        </div>
                    )}

                    {/* Progress bar hit area */}
                    <div ref={progressRef}
                        className="relative w-full cursor-pointer group/bar"
                        style={{ padding: '8px 0 6px' }}
                        onClick={handleProgressClick}
                        onMouseMove={handleProgressMove}
                        onMouseLeave={() => setPreviewThumb(null)}
                        onTouchStart={handleTouchSeek}
                        onTouchMove={handleTouchSeek}>

                        {/* Track */}
                        <div className="relative w-full h-2 group-hover/bar:h-3 transition-[height] duration-150 rounded-full bg-white/15 overflow-visible">
                            <div className="absolute inset-y-0 left-0 rounded-full bg-white/20" style={{ width: `${buffered}%` }} />
                            <div className="absolute inset-y-0 left-0 rounded-full bg-brand-accent" style={{ width: `${progress}%` }}>
                                <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3.5 h-3.5 rounded-full bg-brand-accent border-2 border-white opacity-0 group-hover/bar:opacity-100 transition-opacity shadow-[0_0_8px_rgba(212,175,55,0.8)]" />
                            </div>
                        </div>

                        {/* Fix 1: Hot moment dots — 6px on mobile, 8px on desktop */}
                        {duration > 0 && curMoments.map((moment, i) => {
                            const pos = (moment.timestamp_sec / duration) * 100;
                            if (pos < 0 || pos > 100) return null;
                            const hov = hoveredMoment === i;
                            return (
                                <div key={i} className="absolute cursor-pointer"
                                    style={{
                                        left: `${pos}%`, top: '50%',
                                        transform: 'translate(-50%, -50%)',
                                        width: hov ? '14px' : '6px',
                                        height: hov ? '14px' : '6px',
                                        zIndex: 10, transition: 'width .15s, height .15s',
                                    }}
                                    onMouseEnter={(e) => { e.stopPropagation(); setHoveredMoment(i); }}
                                    onMouseLeave={(e) => { e.stopPropagation(); setHoveredMoment(null); }}
                                    onClick={(e) => { e.stopPropagation(); seekToRatio(moment.timestamp_sec / duration); }}>
                                    <div className="w-full h-full rounded-full" style={{
                                        backgroundColor: '#f97316',
                                        boxShadow: `0 0 ${4 + (moment.intensity || 3)}px #f97316, 0 0 ${10 + (moment.intensity || 3) * 2}px rgba(249,115,22,0.4)`,
                                        animation: 'pulse 1.5s ease-in-out infinite',
                                    }} />
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Controls row */}
                <div className="flex items-center gap-2 sm:gap-3">
                    <button onClick={togglePlay} className="text-white hover:text-brand-accent transition-colors shrink-0">
                        {playing
                            ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                            : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
                    </button>
                    {/* Fix 1: skip buttons hidden on mobile */}
                    <button onClick={() => skip(-5)} title="-5s" className="hidden md:flex text-white/60 hover:text-white transition-colors">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z" /></svg>
                    </button>
                    <button onClick={() => skip(5)} title="+5s" className="hidden md:flex text-white/60 hover:text-white transition-colors">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" /></svg>
                    </button>
                    <button onClick={toggleMute} className="text-white hover:text-brand-accent transition-colors shrink-0">
                        {muted || volume === 0
                            ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
                            : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-3.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>}
                    </button>
                    <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume}
                        onChange={handleVolumeChange}
                        style={{ accentColor: '#D4AF37' }}
                        className="hidden sm:block w-14 h-1 appearance-none bg-white/30 rounded-full cursor-pointer" />
                    <span className="text-xs text-white/80 tabular-nums font-mono whitespace-nowrap">
                        {formatTime(currentTime)}<span className="text-white/35"> / </span>{formatTime(duration)}
                    </span>
                    <div className="flex-1" />
                    <button onClick={toggleFullscreen} className="text-white hover:text-brand-accent transition-colors shrink-0">
                        {isFullscreen
                            ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" /></svg>
                            : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>}
                    </button>
                </div>
            </div>
        </div>
        {/* Pause recommendations — outside overflow-hidden so scroll/click works */}
        {showRecs && recsToShow.length > 0 && (
            <div className="absolute inset-x-0 bottom-[52px] sm:bottom-[56px] z-20 bg-gradient-to-t from-black/95 via-black/70 to-transparent pt-3 pb-2 px-3 sm:px-4">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-white/50 text-[9px] font-bold uppercase tracking-widest">Up next</span>
                    <button onClick={togglePlay} className="flex items-center gap-1 text-brand-accent hover:text-brand-gold-light text-[9px] font-medium transition-colors">
                        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        Resume
                    </button>
                </div>
                <div
                    ref={recsRef}
                    className="flex gap-[3px] sm:gap-1 overflow-x-auto scrollbar-hide cursor-grab"
                    style={{ touchAction: 'pan-x' }}
                    onMouseDown={onRecsMD}
                    onMouseUp={onRecsMU}
                    onMouseLeave={onRecsMU}
                    onMouseMove={onRecsMM}
                >
                    {recsToShow.map((v) => {
                        const slug = getLocalizedSlug(v.slug, locale);
                        return (
                            <RecCard
                                key={v.id}
                                v={v}
                                locale={locale}
                                onClick={() => {
                                    if (recsWasDragged.current) return;
                                    if (isFullscreen) { goToVideo(slug); } else { router.push(`/${locale}/video/${slug}`); }
                                }}
                            />
                        );
                    })}
                </div>
            </div>
        )}
        </div>
    );
}

// ── Recommendation card (filmstrip) ──
function RecCard({ v, onClick }: { v: Video; locale: string; onClick?: () => void }) {
    const dur = v.duration_seconds ? formatTime(v.duration_seconds) : (v.duration_formatted || '');
    return (
        <button
            onClick={onClick}
            className="shrink-0 relative w-[100px] h-[56px] sm:w-[160px] sm:h-[90px] rounded overflow-hidden hover:ring-2 ring-brand-accent transition-all"
        >
            {v.thumbnail_url
                ? <img src={v.thumbnail_url} alt="" className="w-full h-full object-cover" draggable={false} />
                : <div className="w-full h-full bg-gray-800" />}
            {dur && <span className="absolute bottom-0.5 right-0.5 bg-black/80 text-white text-[9px] px-1 rounded-sm font-mono">{dur}</span>}
        </button>
    );
}
