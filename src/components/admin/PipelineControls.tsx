'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────

interface DownloadProgress {
    id: string;
    label: string;
    downloaded: number;
    total: number;
    pct: number;
}

interface ActiveItem {
    id: string;
    label: string;
    subStep: string;
    pct: number;
    startedAt: number;
}

interface StepProgressData {
    step: string;
    stepLabel: string;
    videosTotal: number;
    videosDone: number;
    status: 'active' | 'completed' | 'pending' | 'idle' | 'waiting';
    currentVideo?: { id: string; title: string; subStep?: string; pct?: number } | null;
    downloads?: DownloadProgress[];
    activeItems?: ActiveItem[];
    completedVideos?: Array<{ id: string; title: string; status: string; ms?: number }>;
    errors?: Array<{ id: string; title: string; error: string }>;
    elapsedMs?: number;
    startedAt?: string;
    finishedAt?: string;
    updatedAt?: string;
}

interface PipelineProgressData {
    totalSteps: number;
    completedSteps: number;
    currentStep: string;
    currentLabel: string;
    elapsedMs: number;
    status?: 'finished' | 'running';
    mode?: 'conveyor' | 'sequential' | 'scheduler';
    stepTimings?: Array<{ step: string; success: boolean; duration: number; processed?: number; runs?: number }>;
}

interface VideoJourney {
    id: string;
    title: string;
    status: string;
    currentStep: string;
    updatedAt: string;
}

interface VideoProgressData {
    steps?: Record<string, StepProgressData>;
    pipeline?: PipelineProgressData;
    videos?: VideoJourney[];
    step?: string;
    stepLabel?: string;
    videosTotal?: number;
    videosDone?: number;
    currentVideo?: { id: string; title: string; subStep?: string; pct?: number } | null;
    downloads?: DownloadProgress[];
    completedVideos?: Array<{ id: string; title: string; status: string; ms?: number }>;
    errors?: Array<{ id: string; title: string; error: string }>;
    elapsedMs?: number;
    updatedAt: string;
}

interface InProgressVideo {
    id: string;
    title: string;
    status: string;
    updated_at: string;
    video_url_watermarked: string | null;
    thumbnail_url: string | null;
}

interface FlowCounts {
    scrape: string;
    ai_process: string;
    watermark: string;
    thumbnails: string;
    cdn_upload: string;
    publish: string;
}

interface PipelineStats {
    raw: { total: string; pending: string; processing: string; processed: string; failed: string; skipped: string };
    videos: {
        total: string; new: string; enriched: string; auto_recognized: string;
        watermarked: string; needs_review: string; unknown_with_suggestions: string;
        published: string; rejected: string; avg_confidence: string;
    };
    celebrities: { total: string; enriched: string };
    movies: { total: string; enriched: string };
    tags: { total: string };
    recentLogs: Array<{ step: string; status: string; metadata: Record<string, unknown>; created_at: string }>;
    runningProcesses: string[];
    videoProgress: VideoProgressData | null;
    progress: Array<{ step: string; metadata: Record<string, unknown>; created_at: string; elapsed_seconds: number }>;
    categories: Array<{ slug: string; name: string; videos_count: number }>;
    flowCounts: FlowCounts | null;
    inProgressVideos: InProgressVideo[];
    actions: Array<{ id: string; label: string; script: string }>;
}

interface ActionOption {
    limit: number;
    model: string;
    force: boolean;
    test: boolean;
    categories: string[];
}

// ─── Constants ───────────────────────────────────

const GEMINI_MODELS = [
    { value: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash' },
    { value: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro' },
];

const STEP_ICONS: Record<string, string> = {
    'scrape': '🕷️', 'ai-process': '🤖', 'visual-recognize': '👁️',
    'tmdb-enrich': '🎬', 'watermark': '💧', 'thumbnails': '📸',
    'cdn-upload': '☁️', 'publish': '🚀', 'full-pipeline': '⚡',
};

const STEP_LABELS: Record<string, string> = {
    'scrape': 'Scraping', 'ai-process': 'AI Processing', 'visual-recognize': 'Visual Recognition',
    'tmdb-enrich': 'TMDB Enrichment', 'watermark': 'Watermarking', 'thumbnails': 'Thumbnails',
    'cdn-upload': 'CDN Upload', 'publish': 'Publishing',
};

const FLOW_STEPS = [
    { id: 'scrape', label: 'Scrape', short: 'Scr' },
    { id: 'ai_process', label: 'AI', short: 'AI' },
    { id: 'watermark', label: 'Wmark', short: 'Wm' },
    { id: 'thumbnails', label: 'Thumb', short: 'Th' },
    { id: 'cdn_upload', label: 'CDN', short: 'CDN' },
    { id: 'publish', label: 'Publish', short: 'Pub' },
];

const JOURNEY_STEPS = ['scrape', 'ai-process', 'tmdb-enrich', 'watermark', 'thumbnails', 'cdn-upload', 'publish'];
const JOURNEY_LABELS: Record<string, string> = {
    'scrape': 'Scrape', 'ai-process': 'AI', 'tmdb-enrich': 'TMDB',
    'watermark': 'Wmark', 'thumbnails': 'Thumb', 'cdn-upload': 'CDN', 'publish': 'Pub',
};

const STEP_ORDER = ['scrape', 'ai-process', 'visual-recognize', 'tmdb-enrich', 'watermark', 'thumbnails', 'cdn-upload', 'publish'];

// ─── Helpers ─────────────────────────────────────

function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
}

function formatMs(ms: number): string {
    return formatElapsed(Math.round(ms / 1000));
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function calcETA(elapsedMs: number, done: number, total: number): string {
    if (done <= 0 || total <= 0) return '';
    const remaining = ((total - done) * elapsedMs) / done;
    if (remaining < 1000) return 'almost done';
    return `~${formatMs(remaining)}`;
}

function mapVideoStatusToStep(v: InProgressVideo): string {
    switch (v.status) {
        case 'new': return 'ai-process';
        case 'enriched': case 'auto_recognized':
            return (v.video_url_watermarked && v.video_url_watermarked !== '') ? 'thumbnails' : 'watermark';
        case 'watermarked':
            if (v.video_url_watermarked?.startsWith('tmp/')) return 'cdn-upload';
            if (v.thumbnail_url?.startsWith('tmp/')) return 'cdn-upload';
            return 'publish';
        default: return v.status;
    }
}

function getCompletedSteps(currentStep: string): Set<string> {
    const done = new Set<string>();
    for (const s of JOURNEY_STEPS) {
        if (s === currentStep) break;
        done.add(s);
    }
    return done;
}

// ─── Collapsible Section ─────────────────────────

function Section({ title, defaultOpen = false, badge, children }: {
    title: string; defaultOpen?: boolean; badge?: string | number; children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between p-3 sm:p-4 text-left hover:bg-gray-800/30 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <svg className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 24 24">
                        <path d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-medium text-gray-300">{title}</span>
                    {badge !== undefined && badge !== 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-900/50 text-purple-300">{badge}</span>
                    )}
                </div>
            </button>
            {open && <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-0">{children}</div>}
        </div>
    );
}

// ─── Main Component ──────────────────────────────

export default function PipelineControls() {
    const [stats, setStats] = useState<PipelineStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState<string | null>(null);
    const [stopping, setStopping] = useState(false);
    const [logs, setLogs] = useState<string>('');
    const [showLogs, setShowLogs] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [options, setOptions] = useState<ActionOption>({
        limit: 10, model: 'gemini-2.5-flash', force: false, test: false, categories: [],
    });
    const [cleanupData, setCleanupData] = useState<{
        orphanedMoviesCount: number;
        orphanedMovieCelebsCount: number;
        orphanedMovies: Array<{ id: number; title: string; year: number | null; celeb_count: string }>;
    } | null>(null);
    const [cleanupLoading, setCleanupLoading] = useState(false);

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/pipeline');
            if (res.ok) setStats(await res.json());
        } catch (err) {
            console.error('Failed to fetch stats:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchLogs = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/pipeline/logs?lines=80');
            if (res.ok) {
                const data = await res.json();
                setLogs(data.logs);
            }
        } catch { /* ignore */ }
    }, []);

    const isActive = (stats?.runningProcesses?.length ?? 0) > 0 || stats?.videoProgress != null;

    useEffect(() => {
        fetchStats();
        const interval = setInterval(fetchStats, isActive ? 5000 : 10000);
        return () => clearInterval(interval);
    }, [fetchStats, isActive]);

    useEffect(() => {
        if (showLogs) {
            fetchLogs();
            const logInterval = setInterval(fetchLogs, 5000);
            return () => clearInterval(logInterval);
        }
    }, [showLogs, fetchLogs]);

    const runAction = async (actionId: string) => {
        setRunning(actionId);
        setMessage(null);
        try {
            const res = await fetch('/api/admin/pipeline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: actionId, options }),
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: data.message });
                setShowLogs(true);
                setTimeout(fetchStats, 3000);
            } else {
                setMessage({ type: 'error', text: data.error });
            }
        } catch (err) {
            setMessage({ type: 'error', text: `Connection error: ${err}` });
        } finally {
            setRunning(null);
        }
    };

    const stopAll = async () => {
        if (!confirm('Stop all running pipeline processes?')) return;
        setStopping(true);
        setMessage(null);
        try {
            const res = await fetch('/api/admin/pipeline', { method: 'DELETE' });
            const data = await res.json();
            setMessage({ type: res.ok ? 'success' : 'error', text: res.ok ? data.message : data.error });
            if (res.ok) setTimeout(fetchStats, 2000);
        } catch (err) {
            setMessage({ type: 'error', text: `Connection error: ${err}` });
        } finally {
            setStopping(false);
        }
    };

    const drainPipeline = async () => {
        if (!confirm('Finish current videos and stop?')) return;
        setStopping(true);
        setMessage(null);
        try {
            const res = await fetch('/api/admin/pipeline', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'drain' }),
            });
            const data = await res.json();
            setMessage({ type: res.ok ? 'success' : 'error', text: res.ok ? data.message : data.error });
            if (res.ok) setTimeout(fetchStats, 2000);
        } catch (err) {
            setMessage({ type: 'error', text: `Connection error: ${err}` });
        } finally {
            setStopping(false);
        }
    };

    const toggleCategory = (slug: string) => {
        setOptions(prev => ({
            ...prev,
            categories: prev.categories.includes(slug)
                ? prev.categories.filter(c => c !== slug)
                : [...prev.categories, slug],
        }));
    };

    const fetchCleanupPreview = async () => {
        setCleanupLoading(true);
        try {
            const res = await fetch('/api/admin/cleanup');
            if (res.ok) setCleanupData(await res.json());
        } catch (err) {
            setMessage({ type: 'error', text: `Failed: ${err}` });
        } finally {
            setCleanupLoading(false);
        }
    };

    const runCleanup = async (action: string) => {
        if (!confirm(`Remove ${cleanupData?.orphanedMoviesCount || 0} orphaned movies?`)) return;
        setCleanupLoading(true);
        setMessage(null);
        try {
            const res = await fetch('/api/admin/cleanup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: `Cleaned: ${data.deletedMovies} movies, ${data.deletedMovieCelebs} links` });
                setCleanupData(null);
                fetchStats();
            } else {
                setMessage({ type: 'error', text: data.error });
            }
        } catch (err) {
            setMessage({ type: 'error', text: `Cleanup failed: ${err}` });
        } finally {
            setCleanupLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400" />
            </div>
        );
    }

    const raw = stats?.raw;
    const videos = stats?.videos;
    const hasRunning = (stats?.runningProcesses?.length ?? 0) > 0;
    const flow = stats?.flowCounts;
    const inProgress = stats?.inProgressVideos || [];

    return (
        <div className="space-y-4 max-w-4xl mx-auto">
            {/* Status Message */}
            {message && (
                <div className={`rounded-lg p-3 text-sm ${
                    message.type === 'success'
                        ? 'bg-green-900/30 text-green-400 border border-green-800'
                        : 'bg-red-900/30 text-red-400 border border-red-800'
                }`}>
                    {message.text}
                </div>
            )}

            {/* ═══ 1. ACTION BAR ═══ */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={() => runAction('full-pipeline')}
                        disabled={running !== null}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium text-base transition-all ${
                            running === 'full-pipeline'
                                ? 'bg-purple-600 animate-pulse text-white'
                                : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white'
                        } ${running !== null && running !== 'full-pipeline' ? 'opacity-50' : ''}`}
                    >
                        <span>⚡</span>
                        <span>{running === 'full-pipeline' ? 'Starting...' : 'Run Full Pipeline'}</span>
                    </button>

                    {hasRunning && (
                        <div className="flex gap-2">
                            <button
                                onClick={drainPipeline}
                                disabled={stopping}
                                className="flex-1 sm:flex-none px-4 py-3 text-sm rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-500 disabled:opacity-50 transition-colors"
                            >
                                {stopping ? '...' : 'Finish & Stop'}
                            </button>
                            <button
                                onClick={stopAll}
                                disabled={stopping}
                                className="flex-1 sm:flex-none px-4 py-3 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-500 disabled:opacity-50 transition-colors"
                            >
                                {stopping ? '...' : 'Stop All'}
                            </button>
                        </div>
                    )}
                </div>

                {/* Running processes */}
                {hasRunning && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                        {stats!.runningProcesses.map((proc, i) => (
                            <span key={i} className="text-xs px-2 py-1 rounded-md bg-yellow-900/30 text-yellow-300 border border-yellow-800/50 animate-pulse">
                                {proc}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* ═══ 2. COMPACT SUMMARY ═══ */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3 sm:p-4">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <Stat label="Published" value={videos?.published || '0'} color="text-green-400" />
                    <Stat label="Enriched" value={String(Number(videos?.enriched || 0) + Number(videos?.auto_recognized || 0))} color="text-purple-400" />
                    <Stat label="Watermarked" value={videos?.watermarked || '0'} color="text-blue-400" />
                    <Stat label="Review" value={videos?.needs_review || '0'} color="text-yellow-400" />
                    <Stat label="New" value={videos?.new || '0'} color="text-cyan-400" />
                    <Stat label="Raw" value={`${raw?.pending || 0} pending`} color="text-gray-400" />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-1 pt-1 border-t border-gray-800/50">
                    <Stat label="Celebs" value={`${stats?.celebrities?.enriched || 0}/${stats?.celebrities?.total || 0}`} color="text-pink-400" />
                    <Stat label="Movies" value={`${stats?.movies?.enriched || 0}/${stats?.movies?.total || 0}`} color="text-cyan-400" />
                    <Stat label="Tags" value={stats?.tags?.total || '0'} color="text-orange-400" />
                    <Stat label="Confidence" value={`${(parseFloat(videos?.avg_confidence || '0') * 100).toFixed(0)}%`} color="text-blue-400" />
                </div>
            </div>

            {/* ═══ 3. PIPELINE FLOW ═══ */}
            {flow && <PipelineFlow flow={flow} hasRunning={hasRunning} />}

            {/* ═══ 4. VIDEO JOURNEY CARDS (always visible) ═══ */}
            {inProgress.length > 0 && (
                <div className="rounded-xl border border-indigo-800/40 bg-indigo-900/10 p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-sm font-semibold text-indigo-300">In-Progress Videos</span>
                        <span className="text-xs text-indigo-500">({inProgress.length})</span>
                    </div>
                    <div className="space-y-2">
                        {inProgress.map(video => {
                            const currentStep = mapVideoStatusToStep(video);
                            const completed = getCompletedSteps(currentStep);
                            const elapsed = video.updated_at
                                ? formatMs(Date.now() - new Date(video.updated_at).getTime())
                                : '';

                            // Check if this step is actively running (has activeItem or step is active in progress)
                            const activeItems = stats?.videoProgress?.steps
                                ? Object.values(stats.videoProgress.steps).flatMap(s => s.activeItems || [])
                                : [];
                            const active = activeItems.find(a => a.id === video.id);
                            const stepIsRunning = stats?.videoProgress?.steps?.[currentStep]?.status === 'active';
                            const isActivelyProcessing = !!active || stepIsRunning;

                            return (
                                <div key={video.id} className="rounded-lg bg-gray-900/60 border border-gray-800 p-2.5 sm:p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-sm text-gray-200 truncate flex-1 mr-2">{video.title || video.id.slice(0, 8)}</p>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                                isActivelyProcessing
                                                    ? 'bg-purple-900/50 text-purple-300 animate-pulse'
                                                    : 'bg-amber-900/40 text-amber-400'
                                            }`}>
                                                {isActivelyProcessing ? `processing ${JOURNEY_LABELS[currentStep] || currentStep}` : `waiting for ${JOURNEY_LABELS[currentStep] || currentStep}`}
                                            </span>
                                            <span className="text-xs text-gray-500">{elapsed}</span>
                                        </div>
                                    </div>
                                    {/* Step timeline */}
                                    <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap">
                                        {JOURNEY_STEPS.map((step, i) => {
                                            const isDone = completed.has(step);
                                            const isCurrent = step === currentStep;
                                            const isRunning = isCurrent && isActivelyProcessing;
                                            return (
                                                <div key={step} className="flex items-center gap-0.5 sm:gap-1">
                                                    {i > 0 && <div className={`w-2 sm:w-3 h-px ${isDone ? 'bg-green-600' : isCurrent ? (isRunning ? 'bg-purple-500' : 'bg-amber-500') : 'bg-gray-700'}`} />}
                                                    <div className="flex flex-col items-center" title={JOURNEY_LABELS[step]}>
                                                        <div className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center text-[8px] sm:text-[9px] font-bold ${
                                                            isDone ? 'bg-green-600 text-white' :
                                                            isRunning ? 'bg-purple-500 text-white animate-pulse' :
                                                            isCurrent ? 'bg-amber-500 text-white' :
                                                            'bg-gray-700 text-gray-500'
                                                        }`}>
                                                            {isDone ? '✓' : isCurrent ? (isRunning ? '●' : '◉') : ''}
                                                        </div>
                                                        <span className={`text-[9px] sm:text-[10px] mt-0.5 ${isDone ? 'text-green-600' : isRunning ? 'text-purple-400' : isCurrent ? 'text-amber-400' : 'text-gray-600'}`}>
                                                            {JOURNEY_LABELS[step]}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {/* Active progress bar */}
                                    {active && active.pct > 0 && (
                                        <div className="flex items-center gap-2 mt-2">
                                            <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                                                <div className="h-full rounded-full bg-purple-500 transition-all duration-500"
                                                    style={{ width: `${active.pct}%` }} />
                                            </div>
                                            {active.subStep && <span className="text-[10px] text-gray-500">{active.subStep}</span>}
                                            <span className="text-[10px] text-purple-400 tabular-nums">{active.pct}%</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ═══ 5. STEP PROGRESS (when pipeline running) ═══ */}
            {stats?.videoProgress && (
                <PipelineProgressView progress={stats.videoProgress} />
            )}

            {/* DB-based active steps — only when no real progress data, show as simple text */}
            {!stats?.videoProgress && stats?.progress && stats.progress.length > 0 && (
                <div className="rounded-xl border border-yellow-800/40 bg-yellow-900/10 p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                        <span className="text-sm font-medium text-yellow-300">Running on Contabo</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {stats.progress.map((p, i) => (
                            <span key={i} className="text-xs px-2.5 py-1 rounded-md bg-gray-900/50 border border-gray-800 text-gray-300">
                                {STEP_ICONS[p.step.replace('admin:', '')] || '⏳'} {p.step.replace('admin:', '')}
                                <span className="text-gray-500 ml-1">{formatElapsed(p.elapsed_seconds)}</span>
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* ═══ 6. COLLAPSIBLE SECTIONS ═══ */}

            {/* Settings */}
            <Section title="Pipeline Settings">
                <div className="flex flex-wrap gap-4 items-end">
                    <div>
                        <label className="text-xs text-gray-500 block mb-1">Limit</label>
                        <input
                            type="number"
                            value={options.limit}
                            onChange={e => setOptions({ ...options, limit: parseInt(e.target.value) || 10 })}
                            className="w-20 px-2 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:ring-1 focus:ring-purple-500"
                            min={1} max={500}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500 block mb-1">AI Model</label>
                        <select
                            value={options.model}
                            onChange={e => setOptions({ ...options, model: e.target.value })}
                            className="px-2 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:ring-1 focus:ring-purple-500"
                        >
                            {GEMINI_MODELS.map(m => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </select>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer py-2">
                        <input type="checkbox" checked={options.force}
                            onChange={e => setOptions({ ...options, force: e.target.checked })}
                            className="rounded border-gray-600 bg-gray-800 text-purple-500" />
                        <span className="text-sm text-gray-400">Force</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer py-2">
                        <input type="checkbox" checked={options.test}
                            onChange={e => setOptions({ ...options, test: e.target.checked })}
                            className="rounded border-gray-600 bg-gray-800 text-purple-500" />
                        <span className="text-sm text-gray-400">Test (limit=3)</span>
                    </label>
                </div>

                {stats?.categories && stats.categories.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-800">
                        <label className="text-xs text-gray-500 block mb-2">
                            Categories {options.categories.length > 0 && <span className="text-purple-400">({options.categories.length})</span>}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {stats.categories.map(cat => (
                                <button
                                    key={cat.slug}
                                    onClick={() => toggleCategory(cat.slug)}
                                    className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                                        options.categories.includes(cat.slug)
                                            ? 'border-purple-500 bg-purple-900/30 text-purple-300'
                                            : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
                                    }`}
                                >
                                    {cat.name} ({cat.videos_count})
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </Section>

            {/* Live Logs */}
            <Section title="Pipeline Logs (Contabo)">
                <div className="flex justify-end mb-2">
                    <button
                        onClick={() => { setShowLogs(!showLogs); if (!showLogs) fetchLogs(); }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700"
                    >
                        {showLogs ? 'Stop' : 'Start'} Live Stream
                    </button>
                </div>
                {showLogs && (
                    <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto bg-gray-950 rounded-lg p-3">
                        {logs || 'Loading...'}
                    </pre>
                )}
            </Section>

            {/* Recent Activity */}
            {stats?.recentLogs && stats.recentLogs.length > 0 && (
                <Section title="Recent Activity" badge={stats.recentLogs.length}>
                    <div className="divide-y divide-gray-800/50 max-h-64 overflow-y-auto -mx-1">
                        {stats.recentLogs.map((log, i) => (
                            <div key={i} className="px-1 py-2 flex items-center gap-3 text-xs">
                                <span className={`px-2 py-0.5 rounded-full shrink-0 ${
                                    log.status === 'completed' ? 'bg-green-900/50 text-green-400' :
                                    log.status === 'started' ? 'bg-blue-900/50 text-blue-400' :
                                    log.status === 'failed' ? 'bg-red-900/50 text-red-400' :
                                    'bg-gray-800 text-gray-400'
                                }`}>
                                    {log.status}
                                </span>
                                <span className="text-gray-300 flex-1 truncate">{log.step}</span>
                                <span className="text-gray-600 shrink-0">
                                    {new Date(log.created_at).toLocaleString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {/* Database Cleanup */}
            <Section title="Database Cleanup">
                <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-gray-500">Remove movies without video scenes.</p>
                    <button
                        onClick={fetchCleanupPreview}
                        disabled={cleanupLoading}
                        className="px-3 py-1.5 text-xs rounded-lg bg-orange-800/30 text-orange-300 border border-orange-700/50 hover:bg-orange-800/50 disabled:opacity-50"
                    >
                        {cleanupLoading ? 'Analyzing...' : 'Analyze'}
                    </button>
                </div>

                {cleanupData && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-gray-900/50 border border-gray-800 p-3">
                                <p className="text-xs text-gray-500">Orphaned Movies</p>
                                <p className="text-lg font-bold text-orange-400">{cleanupData.orphanedMoviesCount}</p>
                            </div>
                            <div className="rounded-lg bg-gray-900/50 border border-gray-800 p-3">
                                <p className="text-xs text-gray-500">Orphaned Links</p>
                                <p className="text-lg font-bold text-orange-400">{cleanupData.orphanedMovieCelebsCount}</p>
                            </div>
                        </div>

                        {cleanupData.orphanedMovies.length > 0 && (
                            <div className="max-h-48 overflow-y-auto rounded-lg bg-gray-900/50 border border-gray-800">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-900/70 sticky top-0">
                                        <tr>
                                            <th className="text-left p-2 text-gray-500">Title</th>
                                            <th className="text-left p-2 text-gray-500">Year</th>
                                            <th className="text-left p-2 text-gray-500">Celebs</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800/50">
                                        {cleanupData.orphanedMovies.map(m => (
                                            <tr key={m.id} className="text-gray-400">
                                                <td className="p-2 truncate max-w-[200px]">{m.title}</td>
                                                <td className="p-2">{m.year || '—'}</td>
                                                <td className="p-2">{m.celeb_count}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {cleanupData.orphanedMoviesCount > 0 ? (
                            <button
                                onClick={() => runCleanup('remove-orphaned-movies')}
                                disabled={cleanupLoading}
                                className="w-full px-4 py-2.5 text-sm rounded-lg bg-red-700 text-white font-medium hover:bg-red-600 disabled:opacity-50"
                            >
                                {cleanupLoading ? 'Cleaning...' : `Remove ${cleanupData.orphanedMoviesCount} Orphaned Movies`}
                            </button>
                        ) : (
                            <p className="text-xs text-green-400 text-center py-2">Database is clean.</p>
                        )}
                    </div>
                )}
            </Section>
        </div>
    );
}

// ─── Pipeline Flow Visualization ─────────────────

function PipelineFlow({ flow, hasRunning }: { flow: FlowCounts; hasRunning: boolean }) {
    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3 sm:p-4">
            <div className="flex items-center flex-wrap gap-1 sm:gap-0 justify-center">
                {FLOW_STEPS.map((step, i) => {
                    const count = parseInt(flow[step.id as keyof FlowCounts] || '0') || 0;
                    const isActive = count > 0;
                    return (
                        <div key={step.id} className="flex items-center">
                            {i > 0 && (
                                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-gray-700 shrink-0 mx-0.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                                </svg>
                            )}
                            <div className={`flex flex-col items-center px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg border transition-all min-w-[52px] sm:min-w-[64px] ${
                                isActive
                                    ? 'border-purple-600/60 bg-purple-900/20 shadow-sm shadow-purple-900/20'
                                    : 'border-gray-800 bg-gray-900/30 opacity-50'
                            }`}>
                                <span className="text-base sm:text-lg">{STEP_ICONS[step.id.replace('_', '-')]}</span>
                                <span className={`text-lg sm:text-xl font-bold tabular-nums ${isActive ? 'text-purple-300' : 'text-gray-600'}`}>
                                    {count}
                                </span>
                                <span className="text-[9px] sm:text-[10px] text-gray-500 whitespace-nowrap">{step.label}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
            {hasRunning && (
                <p className="text-center text-xs text-gray-600 mt-2">Videos waiting at each step</p>
            )}
        </div>
    );
}

// ─── Inline Stat ─────────────────────────────────

function Stat({ label, value, color = 'text-white' }: { label: string; value: string | number; color?: string }) {
    return (
        <span className="text-gray-500">
            {label}: <span className={`font-semibold ${color}`}>{value}</span>
        </span>
    );
}

// ─── Pipeline Progress View (when running) ───────

function PipelineProgressView({ progress }: { progress: VideoProgressData }) {
    if (progress.steps) {
        const pipelineInfo = progress.pipeline;
        const steps = progress.steps;
        const activeSteps = Object.values(steps);
        const totalElapsed = pipelineInfo?.elapsedMs || Math.max(...activeSteps.map(s => s.elapsedMs || 0), 0);
        const completedCount = activeSteps.filter(s => s.status === 'completed').length;
        const activeCount = activeSteps.filter(s => s.status === 'active').length;
        const isFinished = pipelineInfo?.status === 'finished';

        return (
            <div className="space-y-2">
                {/* Pipeline header */}
                <div className={`flex items-center justify-between rounded-xl border px-3 sm:px-4 py-3 ${
                    isFinished ? 'border-green-800/50 bg-green-900/10' : 'border-gray-800 bg-gray-900/50'
                }`}>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg">{isFinished ? '✅' : '🔄'}</span>
                        <span className={`text-sm font-medium ${isFinished ? 'text-green-400' : 'text-gray-300'}`}>
                            {isFinished ? 'Pipeline Complete' : 'Scheduler Pipeline'}
                        </span>
                        <span className="text-xs text-gray-500">
                            {completedCount} done, {activeCount} active
                        </span>
                    </div>
                    <span className={`text-sm font-semibold tabular-nums ${isFinished ? 'text-green-400' : 'text-gray-500'}`}>
                        {totalElapsed > 0 ? formatMs(totalElapsed) : ''}
                    </span>
                </div>

                {/* Step panels — only active/completed */}
                {STEP_ORDER.map(stepId => {
                    const stepData = steps[stepId];
                    if (!stepData) return null;
                    return <StepPanel key={stepId} stepId={stepId} data={stepData} />;
                })}
            </div>
        );
    }

    // Legacy single-step
    return <StepPanel stepId={progress.step || 'unknown'} data={{
        step: progress.step || 'unknown',
        stepLabel: progress.stepLabel || 'Processing',
        videosTotal: progress.videosTotal || 0,
        videosDone: progress.videosDone || 0,
        status: 'active',
        currentVideo: progress.currentVideo,
        downloads: progress.downloads,
        completedVideos: progress.completedVideos,
        errors: progress.errors,
        elapsedMs: progress.elapsedMs,
    }} />;
}

// ─── Step Panel ──────────────────────────────────

function StepPanel({ stepId, data }: { stepId: string; data: StepProgressData }) {
    const [showCompleted, setShowCompleted] = useState(false);
    const isCompleted = data.status === 'completed';
    const noItems = data.videosDone === 0 && data.videosTotal === 0;
    const pct = data.videosTotal > 0
        ? Math.round((data.videosDone / data.videosTotal) * 100)
        : (isCompleted && !noItems ? 100 : 0);
    const icon = STEP_ICONS[stepId] || '⏳';
    const label = data.stepLabel || STEP_LABELS[stepId] || stepId;
    const eta = data.elapsedMs && data.videosDone > 0 && !isCompleted
        ? calcETA(data.elapsedMs, data.videosDone, data.videosTotal) : '';
    const completedList = data.completedVideos || [];
    const errorList = data.errors || [];
    const downloads = data.downloads || [];

    let stepDuration = '';
    if (data.startedAt && data.finishedAt) {
        stepDuration = formatMs(new Date(data.finishedAt).getTime() - new Date(data.startedAt).getTime());
    } else if (data.elapsedMs && data.elapsedMs > 0) {
        stepDuration = formatMs(data.elapsedMs);
    }

    const isPending = data.status === 'pending';
    const isIdle = data.status === 'idle';
    const isWaiting = data.status === 'waiting';

    if (isPending) {
        return (
            <div className="rounded-xl border border-gray-800/50 bg-gray-900/20 px-3 sm:px-4 py-2.5 flex items-center gap-2.5 opacity-50">
                <span className="text-lg">{icon}</span>
                <span className="text-sm text-gray-500">{label}</span>
                <span className="text-xs text-gray-600 ml-auto">pending</span>
            </div>
        );
    }

    if (isWaiting) {
        return (
            <div className="rounded-xl border border-gray-800/50 bg-gray-900/20 px-3 sm:px-4 py-2.5 flex items-center gap-2.5 opacity-60">
                <span className="text-lg">{icon}</span>
                <span className="text-sm text-gray-400">{label}</span>
                <span className="text-xs text-gray-500 ml-auto">waiting...</span>
            </div>
        );
    }

    if (isIdle) {
        return (
            <div className="rounded-xl border border-blue-800/30 bg-blue-900/5 px-3 sm:px-4 py-2.5 flex items-center gap-2.5">
                <span className="text-lg">{icon}</span>
                <span className="text-sm text-blue-300">{label}</span>
                <span className="text-xs text-blue-500/70 ml-auto flex items-center gap-1.5">
                    {data.videosDone > 0 ? `${data.videosDone} done — polling...` : 'polling...'}
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400/50 animate-pulse" />
                </span>
            </div>
        );
    }

    const borderColor = isCompleted ? 'border-green-800/50' : 'border-purple-800/50';
    const bgColor = isCompleted ? 'bg-green-900/10' : 'bg-purple-900/10';
    const barGradient = isCompleted
        ? (noItems ? 'bg-gray-700' : 'bg-gradient-to-r from-green-600 to-emerald-500')
        : 'bg-gradient-to-r from-purple-600 to-pink-500';

    return (
        <div className={`rounded-xl border ${borderColor} ${bgColor} p-3 sm:p-4 space-y-3`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <span className="text-lg">{icon}</span>
                    <div>
                        <h3 className={`text-sm font-semibold ${isCompleted ? 'text-green-400' : 'text-purple-300'}`}>
                            {label} {isCompleted && '✓'}
                            {isCompleted && stepDuration && <span className="ml-2 text-xs font-normal text-green-600">({stepDuration})</span>}
                        </h3>
                        <p className="text-xs text-gray-500">
                            {noItems && isCompleted ? 'no items' : <>{data.videosDone}/{data.videosTotal} videos</>}
                            {!isCompleted && stepDuration ? <span className="ml-2 text-gray-600">{stepDuration}</span> : null}
                            {eta && <span className="ml-2 text-cyan-500">ETA: {eta}</span>}
                        </p>
                    </div>
                </div>
                <span className={`text-xl font-bold tabular-nums ${isCompleted ? (noItems ? 'text-gray-500' : 'text-green-400') : 'text-purple-400'}`}>
                    {noItems && isCompleted ? '—' : `${pct}%`}
                </span>
            </div>

            <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden">
                <div className={`h-full rounded-full ${barGradient} transition-all duration-700 ease-out`}
                    style={{ width: `${isCompleted ? 100 : pct}%` }} />
            </div>

            {/* Downloads */}
            {downloads.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-xs text-gray-400">Downloads ({downloads.length})</p>
                    {downloads.map((dl, i) => (
                        <div key={dl.id || i} className="rounded-lg bg-gray-900/60 border border-gray-800 p-2">
                            <div className="flex items-center justify-between mb-1">
                                <p className="text-xs text-gray-300 truncate flex-1 mr-2">{dl.label || dl.id}</p>
                                <div className="flex items-center gap-2 shrink-0">
                                    {dl.total > 0 && <span className="text-xs text-gray-500">{formatBytes(dl.downloaded)} / {formatBytes(dl.total)}</span>}
                                    <span className="text-xs font-medium text-cyan-400 tabular-nums">{dl.pct}%</span>
                                </div>
                            </div>
                            <div className="w-full h-1 rounded-full bg-gray-800 overflow-hidden">
                                <div className="h-full rounded-full bg-cyan-500 transition-all duration-500" style={{ width: `${dl.pct}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Active items */}
            {(data.activeItems?.length ?? 0) > 0 && !isCompleted && (
                <div className="space-y-1.5">
                    <p className="text-xs text-gray-400">Processing ({data.activeItems!.length})</p>
                    {data.activeItems!.map((item, i) => {
                        const elapsed = Date.now() - item.startedAt;
                        const elapsedStr = elapsed > 1000 ? `${Math.floor(elapsed / 1000)}s` : '';
                        const itemEta = item.pct > 5 && item.pct < 100
                            ? formatMs(Math.round((elapsed / item.pct) * (100 - item.pct))) : '';
                        return (
                            <div key={item.id || i} className="rounded-lg bg-gray-900/60 border border-gray-800 p-2">
                                <div className="flex items-center justify-between mb-1">
                                    <p className="text-xs text-gray-300 truncate flex-1 mr-2">{item.label}</p>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {item.subStep && <span className="text-xs text-gray-500">{item.subStep}</span>}
                                        {itemEta && <span className="text-xs text-cyan-500/70">~{itemEta}</span>}
                                        <span className="text-xs font-medium text-purple-400 tabular-nums">{item.pct}%</span>
                                    </div>
                                </div>
                                <div className="w-full h-1 rounded-full bg-gray-800 overflow-hidden">
                                    <div className="h-full rounded-full bg-purple-500 transition-all duration-500" style={{ width: `${item.pct}%` }} />
                                </div>
                                {elapsedStr && <p className="text-xs text-gray-600 mt-0.5 text-right">{elapsedStr}</p>}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Current video fallback */}
            {data.currentVideo && !isCompleted && downloads.length === 0 && !(data.activeItems?.length) && (
                <div className="rounded-lg bg-gray-900/60 border border-gray-800 p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-xs text-gray-400">Processing</span>
                    </div>
                    <p className="text-xs text-gray-200 truncate">{data.currentVideo.title || data.currentVideo.id?.slice(0, 12)}</p>
                    {data.currentVideo.subStep && <p className="text-xs text-gray-500 mt-0.5">{data.currentVideo.subStep}</p>}
                    {data.currentVideo.pct != null && data.currentVideo.pct > 0 && (
                        <div className="mt-1.5 w-full h-1 rounded-full bg-gray-800 overflow-hidden">
                            <div className="h-full rounded-full bg-green-500 transition-all duration-500" style={{ width: `${data.currentVideo.pct}%` }} />
                        </div>
                    )}
                </div>
            )}

            {/* Errors */}
            {errorList.length > 0 && (
                <div className="space-y-1">
                    {errorList.slice(-3).map((e, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs rounded-lg bg-red-900/20 border border-red-900/30 px-2.5 py-1.5">
                            <span className="text-red-500 shrink-0">✗</span>
                            <div className="min-w-0">
                                <p className="text-red-300 truncate">{e.title || e.id?.slice(0, 12)}</p>
                                <p className="text-red-500/70 truncate">{e.error}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Completed list */}
            {completedList.length > 0 && (
                <div>
                    <button onClick={() => setShowCompleted(!showCompleted)}
                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1">
                        <svg className={`w-3 h-3 transition-transform ${showCompleted ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 24 24">
                            <path d="M9 5l7 7-7 7" />
                        </svg>
                        {completedList.length} completed
                    </button>
                    {showCompleted && (
                        <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
                            {completedList.map((v, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs px-2 py-0.5 rounded bg-gray-900/40">
                                    <span className="text-green-500">✓</span>
                                    <span className="text-gray-400 truncate flex-1">{v.title || v.id?.slice(0, 12)}</span>
                                    {v.ms && <span className="text-gray-600 shrink-0">{(v.ms / 1000).toFixed(1)}s</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
