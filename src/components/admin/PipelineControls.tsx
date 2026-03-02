'use client';

import { useState, useEffect, useCallback } from 'react';

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
    actions: Array<{ id: string; label: string; script: string }>;
}

interface ActionOption {
    limit: number;
    model: string;
    force: boolean;
    test: boolean;
}

const GEMINI_MODELS = [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro' },
];

const STEP_ICONS: Record<string, string> = {
    'scrape': '🕷️',
    'ai-process': '🤖',
    'tmdb-enrich': '🎬',
    'watermark': '💧',
    'thumbnails': '📸',
    'cdn-upload': '☁️',
    'publish': '🚀',
    'full-pipeline': '⚡',
};

export default function PipelineControls() {
    const [stats, setStats] = useState<PipelineStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState<string | null>(null);
    const [logs, setLogs] = useState<string>('');
    const [showLogs, setShowLogs] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [options, setOptions] = useState<ActionOption>({
        limit: 10,
        model: 'gemini-2.5-flash',
        force: false,
        test: false,
    });

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

    useEffect(() => {
        fetchStats();
        const interval = setInterval(fetchStats, 10000); // Refresh every 10s
        return () => clearInterval(interval);
    }, [fetchStats]);

    useEffect(() => {
        if (showLogs) {
            fetchLogs();
            const logInterval = setInterval(fetchLogs, 5000); // Refresh logs every 5s
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

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400" />
            </div>
        );
    }

    const raw = stats?.raw;
    const videos = stats?.videos;

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
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Celebrities" value={`${stats?.celebrities?.enriched || 0}/${stats?.celebrities?.total || 0}`} sublabel="TMDB enriched" color="text-pink-400" />
                <StatCard label="Movies" value={`${stats?.movies?.enriched || 0}/${stats?.movies?.total || 0}`} sublabel="TMDB enriched" color="text-cyan-400" />
                <StatCard label="Tags" value={stats?.tags?.total || '0'} color="text-orange-400" />
                <StatCard label="Avg Confidence" value={`${(parseFloat(videos?.avg_confidence || '0') * 100).toFixed(1)}%`} color="text-blue-400" />
            </div>

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
            </div>

            {/* Pipeline Steps */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Run Pipeline Steps</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                        { id: 'scrape', label: 'Scrape', desc: 'Boobsradar' },
                        { id: 'ai-process', label: 'AI Process', desc: 'Gemini' },
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

            {/* Running Processes */}
            {stats?.runningProcesses && stats.runningProcesses.length > 0 && (
                <div className="rounded-xl border border-yellow-800/50 bg-yellow-900/10 p-4">
                    <h3 className="text-sm font-medium text-yellow-400 mb-2">🔄 Running Processes on Contabo</h3>
                    <div className="flex flex-wrap gap-2">
                        {stats.runningProcesses.map((proc, i) => (
                            <span key={i} className="text-xs px-2 py-1 rounded bg-yellow-900/30 text-yellow-300 border border-yellow-800/50">
                                {proc}
                            </span>
                        ))}
                    </div>
                </div>
            )}

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
