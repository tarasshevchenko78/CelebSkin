'use client';

import { useState, useEffect, useCallback } from 'react';

interface DownloadProgress {
    id: string;
    label: string;
    downloaded: number;
    total: number;
    pct: number;
}

interface StepProgressData {
    step: string;
    stepLabel: string;
    videosTotal: number;
    videosDone: number;
    status: 'active' | 'completed' | 'pending' | 'idle' | 'waiting';
    currentVideo?: {
        id: string;
        title: string;
        subStep?: string;
        pct?: number;
    } | null;
    downloads?: DownloadProgress[];
    completedVideos?: Array<{
        id: string;
        title: string;
        status: string;
        ms?: number;
    }>;
    errors?: Array<{
        id: string;
        title: string;
        error: string;
    }>;
    elapsedMs?: number;
    startedAt?: string;
    finishedAt?: string;
    updatedAt?: string;
    conveyorRun?: number;
}

interface PipelineProgressData {
    totalSteps: number;
    completedSteps: number;
    currentStep: string;
    currentLabel: string;
    elapsedMs: number;
    status?: 'finished' | 'running';
    mode?: 'conveyor' | 'sequential';
    stepTimings?: Array<{
        step: string;
        success: boolean;
        duration: number;
        processed?: number;
        runs?: number;
    }>;
}

interface VideoProgressData {
    // Multi-step format
    steps?: Record<string, StepProgressData>;
    pipeline?: PipelineProgressData;
    // Legacy single-step format
    step?: string;
    stepLabel?: string;
    videosTotal?: number;
    videosDone?: number;
    currentVideo?: {
        id: string;
        title: string;
        subStep?: string;
        pct?: number;
    } | null;
    downloads?: DownloadProgress[];
    completedVideos?: Array<{
        id: string;
        title: string;
        status: string;
        ms?: number;
    }>;
    errors?: Array<{
        id: string;
        title: string;
        error: string;
    }>;
    elapsedMs?: number;
    updatedAt: string;
}

interface PipelineStats {
    raw: {
        total: string;
        pending: string;
        processing: string;
        processed: string;
        failed: string;
        skipped: string;
    };
    videos: {
        total: string;
        new: string;
        enriched: string;
        auto_recognized: string;
        watermarked: string;
        needs_review: string;
        unknown_with_suggestions: string;
        published: string;
        rejected: string;
        avg_confidence: string;
    };
    celebrities: { total: string; enriched: string };
    movies: { total: string; enriched: string };
    tags: { total: string };
    recentLogs: Array<{
        step: string;
        status: string;
        metadata: Record<string, unknown>;
        created_at: string;
    }>;
    runningProcesses: string[];
    videoProgress: VideoProgressData | null;
    progress: Array<{
        step: string;
        metadata: Record<string, unknown>;
        created_at: string;
        elapsed_seconds: number;
    }>;
    categories: Array<{ slug: string; name: string; videos_count: number }>;
    actions: Array<{ id: string; label: string; script: string }>;
}

interface ActionOption {
    limit: number;
    model: string;
    force: boolean;
    test: boolean;
    categories: string[];
}

const GEMINI_MODELS = [
    { value: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash' },
    { value: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro' },
];

const STEP_ICONS: Record<string, string> = {
    'scrape': '🕷️',
    'ai-process': '🤖',
    'visual-recognize': '👁️',
    'tmdb-enrich': '🎬',
    'watermark': '💧',
    'thumbnails': '📸',
    'cdn-upload': '☁️',
    'publish': '🚀',
    'full-pipeline': '⚡',
};

function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
}

function formatMs(ms: number): string {
    const secs = Math.round(ms / 1000);
    return formatElapsed(secs);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function calcETA(elapsedMs: number, done: number, total: number): string {
    if (done <= 0 || total <= 0) return '';
    const msPerItem = elapsedMs / done;
    const remaining = (total - done) * msPerItem;
    if (remaining < 1000) return 'почти готово';
    return `~${formatMs(remaining)}`;
}

export default function PipelineControls() {
    const [stats, setStats] = useState<PipelineStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState<string | null>(null);
    const [stopping, setStopping] = useState(false);
    const [logs, setLogs] = useState<string>('');
    const [showLogs, setShowLogs] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [options, setOptions] = useState<ActionOption>({
        limit: 10,
        model: 'gemini-2.5-flash',
        force: false,
        test: false,
        categories: [],
    });
    const [cleanupData, setCleanupData] = useState<{
        orphanedMoviesCount: number;
        orphanedMovieCelebsCount: number;
        orphanedMovies: Array<{ id: number; title: string; year: number | null; celeb_count: string }>;
    } | null>(null);
    const [cleanupLoading, setCleanupLoading] = useState(false);
    const [showCleanup, setShowCleanup] = useState(false);

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/pipeline');
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            }
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
        } catch {
            // Silently fail
        }
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
                setMessage({ type: 'success', text: `✓ ${data.message}` });
                setShowLogs(true);
                setTimeout(fetchStats, 3000);
            } else {
                setMessage({ type: 'error', text: `✗ ${data.error}` });
            }
        } catch (err) {
            setMessage({ type: 'error', text: `✗ Connection error: ${err}` });
        } finally {
            setRunning(null);
        }
    };

    const stopAll = async () => {
        if (!confirm('Stop all running pipeline processes on Contabo?')) return;
        setStopping(true);
        setMessage(null);
        try {
            const res = await fetch('/api/admin/pipeline', { method: 'DELETE' });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: `✓ ${data.message}` });
                setTimeout(fetchStats, 2000);
            } else {
                setMessage({ type: 'error', text: `✗ ${data.error}` });
            }
        } catch (err) {
            setMessage({ type: 'error', text: `✗ Connection error: ${err}` });
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
            if (res.ok) {
                const data = await res.json();
                setCleanupData(data);
                setShowCleanup(true);
            }
        } catch (err) {
            setMessage({ type: 'error', text: `Failed to analyze: ${err}` });
        } finally {
            setCleanupLoading(false);
        }
    };

    const runCleanup = async (action: string) => {
        if (!confirm(`Remove ${cleanupData?.orphanedMoviesCount || 0} orphaned movies and ${cleanupData?.orphanedMovieCelebsCount || 0} movie-celebrity links? This cannot be undone.`)) return;
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
                setMessage({ type: 'success', text: `Cleaned: ${data.deletedMovies} movies, ${data.deletedMovieCelebs} movie-celebrity links removed` });
                setCleanupData(null);
                setShowCleanup(false);
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

    return (
        <div className="space-y-6">
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

            {/* Pipeline Overview Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <StatCard label="Raw Pending" value={raw?.pending || '0'} color="text-blue-400" />
                <StatCard label="Raw Processed" value={raw?.processed || '0'} color="text-green-400" />
                <StatCard label="Raw Failed" value={raw?.failed || '0'} color="text-red-400" />
                <StatCard label="Videos Enriched" value={String(Number(videos?.enriched || 0) + Number(videos?.auto_recognized || 0))} color="text-purple-400" />
                <StatCard label="Videos Published" value={videos?.published || '0'} color="text-green-400" />
                <StatCard label="Needs Review" value={videos?.needs_review || '0'} color="text-yellow-400" />
                <StatCard label="Unknown + Suggestions" value={videos?.unknown_with_suggestions || '0'} color="text-orange-400" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Celebrities" value={`${stats?.celebrities?.enriched || 0}/${stats?.celebrities?.total || 0}`} sublabel="TMDB enriched" color="text-pink-400" />
                <StatCard label="Movies" value={`${stats?.movies?.enriched || 0}/${stats?.movies?.total || 0}`} sublabel="TMDB enriched" color="text-cyan-400" />
                <StatCard label="Tags" value={stats?.tags?.total || '0'} color="text-orange-400" />
                <StatCard label="Avg Confidence" value={`${(parseFloat(videos?.avg_confidence || '0') * 100).toFixed(1)}%`} color="text-blue-400" />
            </div>

            {/* Running Processes + Stop Button */}
            {hasRunning && (
                <div className="rounded-xl border border-yellow-800/50 bg-yellow-900/10 p-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-yellow-400">Running Processes on Contabo</h3>
                        <button
                            onClick={stopAll}
                            disabled={stopping}
                            className="px-4 py-1.5 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-500 disabled:opacity-50 transition-colors"
                        >
                            {stopping ? 'Stopping...' : 'Stop All'}
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {stats!.runningProcesses.map((proc, i) => (
                            <span key={i} className="text-xs px-2 py-1 rounded bg-yellow-900/30 text-yellow-300 border border-yellow-800/50 animate-pulse">
                                {proc}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Real-time Pipeline Progress — Multi-step conveyor belt */}
            {stats?.videoProgress && (
                <PipelineProgressView progress={stats.videoProgress} dbProgress={stats.progress} />
            )}

            {/* Fallback: DB-based Active Steps (when no file progress available) */}
            {!stats?.videoProgress && stats?.progress && stats.progress.length > 0 && (
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <h3 className="text-sm font-medium text-gray-300 mb-3">Active Steps</h3>
                    <div className="space-y-3">
                        {stats.progress.map((p, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <span className="text-lg">{STEP_ICONS[p.step.replace('admin:', '')] || '⏳'}</span>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs text-gray-300 font-medium">{p.step}</span>
                                        <span className="text-xs text-gray-500">{formatElapsed(p.elapsed_seconds)}</span>
                                    </div>
                                    <div className="w-full h-1.5 rounded-full bg-gray-800 overflow-hidden">
                                        <div className="h-full rounded-full bg-purple-500 animate-pulse" style={{ width: '60%' }} />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Options Panel */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Pipeline Options</h3>
                <div className="flex flex-wrap gap-4 items-center">
                    <div>
                        <label className="text-xs text-gray-500 block mb-1">Limit</label>
                        <input
                            type="number"
                            value={options.limit}
                            onChange={e => setOptions({ ...options, limit: parseInt(e.target.value) || 10 })}
                            className="w-20 px-2 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                            min={1}
                            max={500}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500 block mb-1">AI Model</label>
                        <select
                            value={options.model}
                            onChange={e => setOptions({ ...options, model: e.target.value })}
                            className="px-2 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                        >
                            {GEMINI_MODELS.map(m => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-4 mt-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={options.force}
                                onChange={e => setOptions({ ...options, force: e.target.checked })}
                                className="rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
                            />
                            <span className="text-sm text-gray-400">Force re-process</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={options.test}
                                onChange={e => setOptions({ ...options, test: e.target.checked })}
                                className="rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
                            />
                            <span className="text-sm text-gray-400">Test mode (limit=3)</span>
                        </label>
                    </div>
                </div>

                {/* Categories */}
                {stats?.categories && stats.categories.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-800">
                        <label className="text-xs text-gray-500 block mb-2">
                            Categories {options.categories.length > 0 && <span className="text-purple-400">({options.categories.length} selected)</span>}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {stats.categories.map(cat => (
                                <button
                                    key={cat.slug}
                                    onClick={() => toggleCategory(cat.slug)}
                                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                                        options.categories.includes(cat.slug)
                                            ? 'border-purple-500 bg-purple-900/30 text-purple-300'
                                            : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
                                    }`}
                                >
                                    {cat.name} <span className="text-gray-600">({cat.videos_count})</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Pipeline Steps */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Run Pipeline Steps</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                        { id: 'scrape', label: 'Scrape', desc: 'Boobsradar' },
                        { id: 'ai-process', label: 'AI Process', desc: 'Gemini' },
                        { id: 'visual-recognize', label: 'Visual', desc: 'Gemini Vision' },
                        { id: 'tmdb-enrich', label: 'TMDB Enrich', desc: 'Photos & Posters' },
                        { id: 'watermark', label: 'Watermark', desc: 'celeb.skin overlay' },
                        { id: 'thumbnails', label: 'Thumbnails', desc: 'Screenshots & GIF' },
                        { id: 'cdn-upload', label: 'CDN Upload', desc: 'BunnyCDN' },
                        { id: 'publish', label: 'Publish', desc: 'Go live' },
                    ].map((step) => (
                        <button
                            key={step.id}
                            onClick={() => runAction(step.id)}
                            disabled={running !== null}
                            className={`flex flex-col items-start p-3 rounded-lg border transition-all ${
                                running === step.id
                                    ? 'border-purple-500 bg-purple-900/30 animate-pulse'
                                    : 'border-gray-700 bg-gray-800/50 hover:border-purple-600 hover:bg-gray-800'
                            } ${running !== null && running !== step.id ? 'opacity-50' : ''}`}
                        >
                            <span className="text-lg">{STEP_ICONS[step.id]}</span>
                            <span className="text-sm font-medium text-gray-200 mt-1">{step.label}</span>
                            <span className="text-xs text-gray-500">{step.desc}</span>
                        </button>
                    ))}
                </div>

                {/* Full Pipeline Button */}
                <div className="mt-4 pt-4 border-t border-gray-800">
                    <button
                        onClick={() => runAction('full-pipeline')}
                        disabled={running !== null}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${
                            running === 'full-pipeline'
                                ? 'bg-purple-600 animate-pulse text-white'
                                : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white'
                        } ${running !== null && running !== 'full-pipeline' ? 'opacity-50' : ''}`}
                    >
                        <span>⚡</span>
                        <span>{running === 'full-pipeline' ? 'Starting...' : 'Run Full Pipeline'}</span>
                    </button>
                </div>
            </div>

            {/* Live Logs */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-gray-800">
                    <h3 className="text-sm font-medium text-gray-300">Pipeline Logs (Contabo)</h3>
                    <button
                        onClick={() => { setShowLogs(!showLogs); if (!showLogs) fetchLogs(); }}
                        className="text-xs px-3 py-1 rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700"
                    >
                        {showLogs ? 'Hide' : 'Show'} Live Logs
                    </button>
                </div>
                {showLogs && (
                    <div className="p-4 max-h-96 overflow-y-auto">
                        <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap leading-relaxed">
                            {logs || 'Loading logs...'}
                        </pre>
                    </div>
                )}
            </div>

            {/* Recent Activity */}
            {stats?.recentLogs && stats.recentLogs.length > 0 && (
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
                    <div className="p-4 border-b border-gray-800">
                        <h3 className="text-sm font-medium text-gray-300">Recent Pipeline Activity</h3>
                    </div>
                    <div className="divide-y divide-gray-800/50 max-h-64 overflow-y-auto">
                        {stats.recentLogs.map((log, i) => (
                            <div key={i} className="px-4 py-2 flex items-center gap-3 text-xs">
                                <span className={`px-2 py-0.5 rounded-full ${
                                    log.status === 'completed' ? 'bg-green-900/50 text-green-400' :
                                    log.status === 'started' ? 'bg-blue-900/50 text-blue-400' :
                                    log.status === 'failed' ? 'bg-red-900/50 text-red-400' :
                                    'bg-gray-800 text-gray-400'
                                }`}>
                                    {log.status}
                                </span>
                                <span className="text-gray-300 flex-1 truncate">{log.step}</span>
                                <span className="text-gray-600">
                                    {new Date(log.created_at).toLocaleString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Database Cleanup */}
            <div className="rounded-xl border border-orange-800/50 bg-orange-900/10 p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-orange-400">Database Cleanup</h3>
                    <button
                        onClick={fetchCleanupPreview}
                        disabled={cleanupLoading}
                        className="px-3 py-1.5 text-xs rounded-lg bg-orange-800/30 text-orange-300 border border-orange-700/50 hover:bg-orange-800/50 disabled:opacity-50 transition-colors"
                    >
                        {cleanupLoading ? 'Analyzing...' : 'Analyze Orphaned Data'}
                    </button>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                    Remove movies that have no video scenes linked (pulled from full filmography instead of specific video clips).
                </p>

                {showCleanup && cleanupData && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-gray-900/50 border border-gray-800 p-3">
                                <p className="text-xs text-gray-500">Orphaned Movies</p>
                                <p className="text-lg font-bold text-orange-400">{cleanupData.orphanedMoviesCount}</p>
                            </div>
                            <div className="rounded-lg bg-gray-900/50 border border-gray-800 p-3">
                                <p className="text-xs text-gray-500">Orphaned Movie-Celeb Links</p>
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
                                        {cleanupData.orphanedMovies.map((m) => (
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

                        {cleanupData.orphanedMoviesCount > 0 && (
                            <button
                                onClick={() => runCleanup('remove-orphaned-movies')}
                                disabled={cleanupLoading}
                                className="w-full px-4 py-2.5 text-sm rounded-lg bg-red-700 text-white font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
                            >
                                {cleanupLoading ? 'Cleaning...' : `Remove ${cleanupData.orphanedMoviesCount} Orphaned Movies`}
                            </button>
                        )}

                        {cleanupData.orphanedMoviesCount === 0 && (
                            <p className="text-xs text-green-400 text-center py-2">No orphaned movies found. Database is clean.</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// Old VideoProgressPanel removed — replaced by PipelineProgressView + StepPanel above

// ============================================
// Multi-step pipeline progress view (conveyor belt)
// ============================================

const STEP_ORDER = ['scrape', 'ai-process', 'visual-recognize', 'tmdb-enrich', 'watermark', 'thumbnails', 'cdn-upload', 'publish'];
const STEP_LABELS: Record<string, string> = {
    'scrape': 'Scraping',
    'ai-process': 'AI Processing',
    'visual-recognize': 'Visual Recognition',
    'tmdb-enrich': 'TMDB Enrichment',
    'watermark': 'Watermarking',
    'thumbnails': 'Thumbnails',
    'cdn-upload': 'CDN Upload',
    'publish': 'Publishing',
};

function PipelineProgressView({ progress }: {
    progress: VideoProgressData;
    dbProgress?: Array<{ step: string; elapsed_seconds: number }>;
}) {
    // Multi-step format: progress.steps exists
    if (progress.steps) {
        const pipelineInfo = progress.pipeline;
        const steps = progress.steps;
        const activeSteps = Object.values(steps);
        const totalElapsed = pipelineInfo?.elapsedMs || Math.max(...activeSteps.map(s => s.elapsedMs || 0), 0);
        const completedCount = activeSteps.filter(s => s.status === 'completed').length;
        const activeCount = activeSteps.filter(s => s.status === 'active').length;
        const idleCount = activeSteps.filter(s => s.status === 'idle').length;
        const waitingCount = activeSteps.filter(s => s.status === 'waiting').length;
        const pendingCount = activeSteps.length - completedCount - activeCount - idleCount - waitingCount;
        const isFinished = pipelineInfo?.status === 'finished';
        const isConveyor = pipelineInfo?.mode === 'conveyor';

        return (
            <div className="space-y-3">
                {/* Pipeline header */}
                <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                    isFinished ? 'border-green-800/50 bg-green-900/10' : 'border-gray-800 bg-gray-900/50'
                }`}>
                    <div className="flex items-center gap-2">
                        <span className="text-lg">{isFinished ? '✅' : isConveyor ? '🔄' : '⚡'}</span>
                        <span className={`text-sm font-medium ${isFinished ? 'text-green-400' : 'text-gray-300'}`}>
                            {isFinished ? 'Pipeline Complete' : isConveyor ? 'Conveyor Pipeline' : 'Pipeline'}
                        </span>
                        <span className="text-xs text-gray-500">
                            {isFinished
                                ? `${completedCount} steps completed`
                                : isConveyor
                                    ? `${activeCount} active, ${idleCount} idle, ${completedCount} done`
                                    : `${completedCount} done, ${activeCount} active, ${pendingCount} pending`
                            }
                        </span>
                    </div>
                    <span className={`text-sm font-semibold tabular-nums ${isFinished ? 'text-green-400' : 'text-gray-500'}`}>
                        {totalElapsed > 0 ? formatMs(totalElapsed) : ''}
                    </span>
                </div>

                {/* Step panels — show ALL steps (pending, active, completed) */}
                {STEP_ORDER.map(stepId => {
                    const stepData = steps[stepId];
                    if (!stepData) return null;

                    return (
                        <StepPanel
                            key={stepId}
                            stepId={stepId}
                            data={stepData}
                        />
                    );
                })}
            </div>
        );
    }

    // Legacy single-step format
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

function StepPanel({ stepId, data }: { stepId: string; data: StepProgressData }) {
    const [showCompleted, setShowCompleted] = useState(false);
    const isCompleted = data.status === 'completed';
    const pct = data.videosTotal > 0
        ? Math.round((data.videosDone / data.videosTotal) * 100)
        : (isCompleted ? 100 : 0);
    const icon = STEP_ICONS[stepId] || '⏳';
    const label = data.stepLabel || STEP_LABELS[stepId] || stepId;
    const eta = data.elapsedMs && data.videosDone > 0 && !isCompleted
        ? calcETA(data.elapsedMs, data.videosDone, data.videosTotal)
        : '';
    const completedList = data.completedVideos || [];
    const errorList = data.errors || [];
    const downloads = data.downloads || [];

    // Calculate step duration from startedAt/finishedAt or elapsedMs
    let stepDuration = '';
    if (data.startedAt && data.finishedAt) {
        const durationMs = new Date(data.finishedAt).getTime() - new Date(data.startedAt).getTime();
        stepDuration = formatMs(durationMs);
    } else if (data.elapsedMs && data.elapsedMs > 0) {
        stepDuration = formatMs(data.elapsedMs);
    }

    const isPending = data.status === 'pending';
    const isIdle = data.status === 'idle';
    const isWaiting = data.status === 'waiting';
    const borderColor = isCompleted ? 'border-green-800/50' : isPending || isWaiting ? 'border-gray-800/50' : isIdle ? 'border-blue-800/30' : 'border-purple-800/50';
    const bgColor = isCompleted ? 'bg-green-900/10' : isPending || isWaiting ? 'bg-gray-900/20' : isIdle ? 'bg-blue-900/5' : 'bg-purple-900/10';
    const barGradient = isCompleted
        ? 'bg-gradient-to-r from-green-600 to-emerald-500'
        : 'bg-gradient-to-r from-purple-600 to-pink-500';

    // Pending step — compact single line
    if (isPending) {
        return (
            <div className={`rounded-xl border ${borderColor} ${bgColor} px-4 py-2.5 flex items-center gap-2.5 opacity-50`}>
                <span className="text-lg">{icon}</span>
                <span className="text-sm text-gray-500">{label}</span>
                <span className="text-xs text-gray-600 ml-auto">pending</span>
            </div>
        );
    }

    // Waiting for dependency — compact single line
    if (isWaiting) {
        return (
            <div className={`rounded-xl border ${borderColor} ${bgColor} px-4 py-2.5 flex items-center gap-2.5 opacity-60`}>
                <span className="text-lg">{icon}</span>
                <span className="text-sm text-gray-400">{label}</span>
                <span className="text-xs text-gray-500 ml-auto">waiting for dependency...</span>
            </div>
        );
    }

    // Idle (conveyor polling) — compact with pulse
    if (isIdle) {
        return (
            <div className={`rounded-xl border ${borderColor} ${bgColor} px-4 py-2.5 flex items-center gap-2.5`}>
                <span className="text-lg">{icon}</span>
                <span className="text-sm text-blue-300">{label}</span>
                <span className="text-xs text-blue-500/70 ml-auto flex items-center gap-1.5">
                    {data.videosDone > 0
                        ? `${data.videosDone} processed — polling for more...`
                        : 'polling for items...'}
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400/50 animate-pulse" />
                </span>
            </div>
        );
    }

    return (
        <div className={`rounded-xl border ${borderColor} ${bgColor} p-4 space-y-3`}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <span className="text-lg">{icon}</span>
                    <div>
                        <h3 className={`text-sm font-semibold ${isCompleted ? 'text-green-400' : 'text-purple-300'}`}>
                            {label} {isCompleted && '✓'}
                            {isCompleted && stepDuration && (
                                <span className="ml-2 text-xs font-normal text-green-600">({stepDuration})</span>
                            )}
                        </h3>
                        <p className="text-xs text-gray-500">
                            {data.videosDone}/{data.videosTotal} videos
                            {!isCompleted && stepDuration ? <span className="ml-2 text-gray-600">{stepDuration}</span> : null}
                            {eta && <span className="ml-2 text-cyan-500">ETA: {eta}</span>}
                        </p>
                    </div>
                </div>
                <span className={`text-xl font-bold tabular-nums ${isCompleted ? 'text-green-400' : 'text-purple-400'}`}>
                    {pct}%
                </span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden">
                <div
                    className={`h-full rounded-full ${barGradient} transition-all duration-700 ease-out`}
                    style={{ width: `${isCompleted ? 100 : pct}%` }}
                />
            </div>

            {/* Active downloads (parallel file progress) */}
            {downloads.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-xs text-gray-400">Active downloads ({downloads.length})</p>
                    {downloads.map((dl, i) => (
                        <div key={dl.id || i} className="rounded-lg bg-gray-900/60 border border-gray-800 p-2">
                            <div className="flex items-center justify-between mb-1">
                                <p className="text-xs text-gray-300 truncate flex-1 mr-2">{dl.label || dl.id}</p>
                                <div className="flex items-center gap-2 shrink-0">
                                    {dl.total > 0 && (
                                        <span className="text-xs text-gray-500">
                                            {formatBytes(dl.downloaded)} / {formatBytes(dl.total)}
                                        </span>
                                    )}
                                    <span className="text-xs font-medium text-cyan-400 tabular-nums w-10 text-right">
                                        {dl.pct}%
                                    </span>
                                </div>
                            </div>
                            <div className="w-full h-1 rounded-full bg-gray-800 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-cyan-500 transition-all duration-500"
                                    style={{ width: `${dl.pct}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Current video (when active, no downloads) */}
            {data.currentVideo && !isCompleted && downloads.length === 0 && (
                <div className="rounded-lg bg-gray-900/60 border border-gray-800 p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-xs text-gray-400">Processing</span>
                    </div>
                    <p className="text-xs text-gray-200 truncate">{data.currentVideo.title || data.currentVideo.id?.slice(0, 12)}</p>
                    {data.currentVideo.subStep && (
                        <p className="text-xs text-gray-500 mt-0.5">{data.currentVideo.subStep}</p>
                    )}
                    {data.currentVideo.pct != null && data.currentVideo.pct > 0 && (
                        <div className="mt-1.5 w-full h-1 rounded-full bg-gray-800 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-green-500 transition-all duration-500"
                                style={{ width: `${data.currentVideo.pct}%` }}
                            />
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

            {/* Completed videos (collapsible, only if >0 and step is completed) */}
            {completedList.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowCompleted(!showCompleted)}
                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
                    >
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

function StatCard({ label, value, sublabel, color = 'text-white' }: {
    label: string;
    value: string | number;
    sublabel?: string;
    color?: string;
}) {
    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`mt-0.5 text-xl font-bold ${color}`}>{value}</p>
            {sublabel && <p className="text-xs text-gray-600 mt-0.5">{sublabel}</p>}
        </div>
    );
}
