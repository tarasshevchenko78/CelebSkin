'use client';

import { useState, useEffect, useCallback } from 'react';

interface VideoResult {
    id: string;
    title: string;
    slug: string;
    src: string;
    poster: string;
    status: 'pending' | 'testing' | 'ok' | 'error';
    error?: string;
    details?: {
        canLoadMetadata: boolean;
        canPlay: boolean;
        duration: number;
        videoWidth: number;
        videoHeight: number;
        posterLoaded: boolean;
        loadTimeMs: number;
    };
}

export default function VideoTestPage() {
    const [videos, setVideos] = useState<VideoResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [testing, setTesting] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });

    useEffect(() => {
        fetch('/api/admin/health-check')
            .then(r => r.json())
            .then(data => {
                const items: VideoResult[] = (data.all || []).map((v: Record<string, unknown>) => ({
                    id: v.video_id,
                    title: v.title,
                    slug: v.slug || '',
                    src: (v.checks as Record<string, Record<string, unknown>>)?.video_url_watermarked?.url
                        || (v.checks as Record<string, Record<string, unknown>>)?.video_url?.url || '',
                    poster: (v.checks as Record<string, Record<string, unknown>>)?.thumbnail_url?.url || '',
                    status: 'pending' as const,
                }));
                setVideos(items);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    const testVideo = useCallback((video: VideoResult): Promise<VideoResult> => {
        return new Promise((resolve) => {
            const v = document.createElement('video');
            v.crossOrigin = 'anonymous';
            v.preload = 'metadata';
            const startTime = Date.now();
            let settled = false;

            const finish = (result: Partial<VideoResult>) => {
                if (settled) return;
                settled = true;
                v.src = '';
                v.load();
                resolve({ ...video, ...result } as VideoResult);
            };

            const timeout = setTimeout(() => {
                finish({ status: 'error', error: 'Timeout (15s) loading metadata' });
            }, 15000);

            v.onloadedmetadata = () => {
                clearTimeout(timeout);
                // Also check if poster loads
                const img = new Image();
                img.crossOrigin = 'anonymous';
                let posterLoaded = false;
                img.onload = () => { posterLoaded = true; };
                img.onerror = () => { posterLoaded = false; };
                if (video.poster) img.src = video.poster;

                // Try to get canplay event
                const canPlayTimeout = setTimeout(() => {
                    finish({
                        status: 'ok',
                        details: {
                            canLoadMetadata: true,
                            canPlay: false,
                            duration: v.duration,
                            videoWidth: v.videoWidth,
                            videoHeight: v.videoHeight,
                            posterLoaded,
                            loadTimeMs: Date.now() - startTime,
                        },
                    });
                }, 5000);

                v.oncanplay = () => {
                    clearTimeout(canPlayTimeout);
                    finish({
                        status: 'ok',
                        details: {
                            canLoadMetadata: true,
                            canPlay: true,
                            duration: v.duration,
                            videoWidth: v.videoWidth,
                            videoHeight: v.videoHeight,
                            posterLoaded,
                            loadTimeMs: Date.now() - startTime,
                        },
                    });
                };
            };

            v.onerror = () => {
                clearTimeout(timeout);
                const err = v.error;
                const msg = err
                    ? `Code ${err.code}: ${err.message || ['', 'MEDIA_ERR_ABORTED', 'MEDIA_ERR_NETWORK', 'MEDIA_ERR_DECODE', 'MEDIA_ERR_SRC_NOT_SUPPORTED'][err.code] || 'Unknown'}`
                    : 'Unknown error';
                finish({ status: 'error', error: msg });
            };

            v.src = video.src;
        });
    }, []);

    const runTests = useCallback(async () => {
        setTesting(true);
        setProgress({ done: 0, total: videos.length });

        // Test 3 at a time
        const results = [...videos];
        for (let i = 0; i < results.length; i += 3) {
            const batch = results.slice(i, i + 3).map((v, j) => {
                results[i + j] = { ...results[i + j], status: 'testing' };
                return testVideo(results[i + j]);
            });
            const batchResults = await Promise.all(batch);
            for (let j = 0; j < batchResults.length; j++) {
                results[i + j] = batchResults[j];
            }
            setVideos([...results]);
            setProgress({ done: Math.min(i + 3, results.length), total: results.length });
        }

        setTesting(false);
    }, [videos, testVideo]);

    const okCount = videos.filter(v => v.status === 'ok').length;
    const errCount = videos.filter(v => v.status === 'error').length;

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <h1 className="text-2xl font-bold text-white mb-2">Video Playback Test</h1>
            <p className="text-gray-400 mb-4 text-sm">
                Tests each video by loading it in a hidden &lt;video&gt; element to verify browser-side playback.
            </p>

            <div className="flex items-center gap-4 mb-6">
                <button
                    onClick={runTests}
                    disabled={loading || testing}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium"
                >
                    {testing ? `Testing ${progress.done}/${progress.total}...` : `Test All ${videos.length} Videos`}
                </button>

                {(okCount > 0 || errCount > 0) && (
                    <div className="flex gap-3 text-sm">
                        <span className="text-green-400">{okCount} OK</span>
                        {errCount > 0 && <span className="text-red-400">{errCount} BROKEN</span>}
                    </div>
                )}
            </div>

            {loading ? (
                <p className="text-gray-500">Loading videos...</p>
            ) : (
                <div className="space-y-2">
                    {videos.map((v) => (
                        <div
                            key={v.id}
                            className={`flex items-center gap-3 p-3 rounded-lg border ${
                                v.status === 'ok' ? 'bg-green-900/20 border-green-800' :
                                v.status === 'error' ? 'bg-red-900/20 border-red-800' :
                                v.status === 'testing' ? 'bg-yellow-900/20 border-yellow-800' :
                                'bg-gray-900/40 border-gray-800'
                            }`}
                        >
                            <div className="w-6 text-center shrink-0">
                                {v.status === 'ok' && <span className="text-green-400 text-lg">&#10003;</span>}
                                {v.status === 'error' && <span className="text-red-400 text-lg">&#10007;</span>}
                                {v.status === 'testing' && <span className="text-yellow-400 animate-spin inline-block">&#9696;</span>}
                                {v.status === 'pending' && <span className="text-gray-600">&#8226;</span>}
                            </div>

                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-white truncate">{v.title}</p>
                                {v.status === 'ok' && v.details && (
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        {v.details.videoWidth}x{v.details.videoHeight} &bull; {Math.round(v.details.duration)}s
                                        &bull; {v.details.canPlay ? 'canplay' : 'metadata only'}
                                        &bull; poster: {v.details.posterLoaded ? 'ok' : 'failed'}
                                        &bull; {v.details.loadTimeMs}ms
                                    </p>
                                )}
                                {v.status === 'error' && (
                                    <p className="text-xs text-red-400 mt-0.5">{v.error}</p>
                                )}
                            </div>

                            <a
                                href={`/en/video/${v.slug}`}
                                target="_blank"
                                className="text-xs text-blue-400 hover:text-blue-300 shrink-0"
                            >
                                Open
                            </a>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
