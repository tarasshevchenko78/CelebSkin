'use client';

import { useState, useEffect, useCallback } from 'react';

interface VideoItem {
    id: string;
    title: string;
    video_url: string;
    thumb: string;
}

interface TestResult {
    id: string;
    status: 'pending' | 'loading' | 'ok' | 'fail';
    detail: string;
    logs: string[];
}

export default function TestVideoPage() {
    const [videos, setVideos] = useState<VideoItem[]>([]);
    const [results, setResults] = useState<Record<string, TestResult>>({});
    const [serverCheck, setServerCheck] = useState<string>('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/admin/video-health')
            .then(r => r.json())
            .then(data => {
                setVideos(data.videos || []);
                setLoading(false);
            })
            .catch(e => {
                setServerCheck('Failed: ' + e.message);
                setLoading(false);
            });
    }, []);

    const stats = {
        total: videos.length,
        ok: Object.values(results).filter(r => r.status === 'ok').length,
        fail: Object.values(results).filter(r => r.status === 'fail').length,
        testing: Object.values(results).filter(r => r.status === 'loading').length,
    };
    stats.testing = stats.total - stats.ok - stats.fail;

    const addLog = useCallback((id: string, msg: string) => {
        setResults(prev => ({
            ...prev,
            [id]: {
                ...prev[id],
                logs: [...(prev[id]?.logs || []), `${new Date().toLocaleTimeString()} ${msg}`],
            }
        }));
    }, []);

    const testOne = useCallback(async (v: VideoItem) => {
        return new Promise<'ok' | 'fail'>((resolve) => {
            setResults(prev => ({
                ...prev,
                [v.id]: { id: v.id, status: 'loading', detail: 'Loading...', logs: [] }
            }));

            const video = document.createElement('video');
            video.preload = 'metadata';
            video.playsInline = true;
            video.muted = true;
            video.crossOrigin = 'anonymous';

            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    video.src = '';
                    setResults(prev => ({
                        ...prev,
                        [v.id]: { ...prev[v.id], status: 'fail', detail: 'TIMEOUT 15s — video metadata did not load' }
                    }));
                    resolve('fail');
                }
            }, 15000);

            video.onloadedmetadata = () => {
                addLog(v.id, `metadata OK: ${video.duration.toFixed(1)}s ${video.videoWidth}x${video.videoHeight}`);
            };

            video.oncanplay = () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    const detail = `✓ ${video.duration.toFixed(1)}s, ${video.videoWidth}x${video.videoHeight}`;
                    addLog(v.id, 'canplay — OK!');
                    video.src = '';
                    setResults(prev => ({
                        ...prev,
                        [v.id]: { ...prev[v.id], status: 'ok', detail }
                    }));
                    resolve('ok');
                }
            };

            video.onerror = () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    const err = video.error;
                    const codes = ['', 'ABORTED', 'NETWORK', 'DECODE', 'SRC_NOT_SUPPORTED'];
                    const msg = err
                        ? `Code ${err.code} (${codes[err.code] || '?'}): ${err.message || 'no message'}`
                        : 'Unknown error';
                    addLog(v.id, 'ERROR: ' + msg);
                    video.src = '';
                    setResults(prev => ({
                        ...prev,
                        [v.id]: { ...prev[v.id], status: 'fail', detail: msg }
                    }));
                    resolve('fail');
                }
            };

            video.src = v.video_url;
            video.load();
        });
    }, [addLog]);

    const testAll = useCallback(async () => {
        setResults({});
        for (let i = 0; i < videos.length; i += 3) {
            const batch = videos.slice(i, i + 3);
            await Promise.all(batch.map(v => testOne(v)));
        }
    }, [videos, testOne]);

    const runServerCheck = useCallback(async () => {
        setServerCheck('Running server-side checks...');
        try {
            const res = await fetch('/api/admin/video-health?check=true');
            const data = await res.json();
            const lines = [`Total: ${data.total}, OK: ${data.allOk}, Issues: ${data.issues}`, ''];
            interface CheckResult { ok: boolean; status: string | number }
            interface VideoResult { title: string; checks: Record<string, CheckResult> }
            for (const r of data.results as VideoResult[]) {
                const ok = Object.values(r.checks).every((c) => c.ok);
                const issues = Object.entries(r.checks)
                    .filter(([, c]) => !c.ok)
                    .map(([n, c]) => `${n}=${c.status}`);
                lines.push(`${ok ? '✓' : '✗'} ${r.title.slice(0, 55)} ${issues.join(' | ')}`);
            }
            setServerCheck(lines.join('\n'));
        } catch (e) {
            setServerCheck('Error: ' + (e as Error).message);
        }
    }, []);

    if (loading) return <div className="p-8 text-white">Loading...</div>;

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <h1 className="text-xl font-bold text-white mb-4">🎬 Video Playback Test</h1>

            {/* Summary */}
            <div className="bg-gray-800 rounded-lg p-4 mb-4 text-sm">
                Total: <b className="text-white">{stats.total}</b>
                {' | '}<span className="text-green-400">OK: {stats.ok}</span>
                {' | '}<span className="text-red-400">Fail: {stats.fail}</span>
                {' | '}<span className="text-yellow-400">Pending: {stats.testing}</span>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 mb-4">
                <button onClick={testAll} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    ▶ Test Browser Playback (all)
                </button>
                <button onClick={runServerCheck} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    🔍 Server-Side URL Check
                </button>
            </div>

            {/* Server check output */}
            {serverCheck && (
                <pre className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs text-gray-300 mb-4 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono">
                    {serverCheck}
                </pre>
            )}

            {/* Video grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {videos.map((v, i) => {
                    const r = results[v.id];
                    const borderColor = r?.status === 'ok' ? 'border-green-500/30' : r?.status === 'fail' ? 'border-red-500/30' : 'border-gray-700';
                    return (
                        <div key={v.id} className={`bg-gray-800 border ${borderColor} rounded-lg p-3`}>
                            <h3 className="text-xs text-gray-300 truncate mb-2">{i + 1}. {v.title}</h3>
                            <video
                                poster={v.thumb}
                                preload="none"
                                playsInline
                                controls
                                crossOrigin="anonymous"
                                className="w-full rounded bg-black aspect-video"
                            >
                                <source src={v.video_url} type="video/mp4" />
                            </video>
                            <div className={`mt-2 text-xs px-2 py-1 rounded ${
                                r?.status === 'ok' ? 'bg-green-900/30 text-green-400' :
                                r?.status === 'fail' ? 'bg-red-900/30 text-red-400' :
                                r?.status === 'loading' ? 'bg-yellow-900/30 text-yellow-400' :
                                'bg-gray-900/30 text-gray-500'
                            }`}>
                                {r?.detail || 'Not tested'}
                            </div>
                            {r?.logs && r.logs.length > 0 && (
                                <div className="mt-1 text-[10px] text-gray-600 max-h-12 overflow-y-auto">
                                    {r.logs.map((l, j) => <div key={j}>{l}</div>)}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
