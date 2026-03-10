import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export default async function AdminAiPage() {
    let stats = {
        totalProcessed: 0,
        autoRecognized: 0,
        needsReview: 0,
        avgConfidence: 0,
        enriched: 0,
        published: 0,
    };

    let recentVideos: {
        id: string;
        title: string;
        status: string;
        ai_model: string | null;
        ai_confidence: number | null;
        updated_at: string;
    }[] = [];

    let celebStats = { total: 0, tmdbEnriched: 0 };
    let movieStats = { total: 0, tmdbEnriched: 0 };

    try {
        const [statsResult, videosResult, celebResult, movieResult] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE ai_model IS NOT NULL) AS total_processed,
                    COUNT(*) FILTER (WHERE status = 'auto_recognized') AS auto_recognized,
                    COUNT(*) FILTER (WHERE status = 'needs_review') AS needs_review,
                    COUNT(*) FILTER (WHERE status = 'enriched') AS enriched,
                    COUNT(*) FILTER (WHERE status = 'published') AS published,
                    COALESCE(AVG(ai_confidence) FILTER (WHERE ai_confidence IS NOT NULL), 0) AS avg_confidence
                FROM videos
            `),
            pool.query(`
                SELECT id, original_title AS title, status, ai_model, ai_confidence, updated_at
                FROM videos
                WHERE ai_model IS NOT NULL
                ORDER BY updated_at DESC
                LIMIT 30
            `),
            pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE tmdb_id IS NOT NULL) AS enriched FROM celebrities`),
            pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE tmdb_id IS NOT NULL) AS enriched FROM movies`),
        ]);

        const row = statsResult.rows[0];
        stats = {
            totalProcessed: parseInt(row.total_processed),
            autoRecognized: parseInt(row.auto_recognized),
            needsReview: parseInt(row.needs_review),
            enriched: parseInt(row.enriched),
            published: parseInt(row.published),
            avgConfidence: parseFloat(row.avg_confidence),
        };
        recentVideos = videosResult.rows;
        celebStats = { total: parseInt(celebResult.rows[0].total), tmdbEnriched: parseInt(celebResult.rows[0].enriched) };
        movieStats = { total: parseInt(movieResult.rows[0].total), tmdbEnriched: parseInt(movieResult.rows[0].enriched) };
    } catch (error) {
        logger.error('Admin AI page DB error', { page: 'admin/ai', error: error instanceof Error ? error.message : String(error) });
    }

    return (
        <div>
            <h1 className="text-2xl font-bold text-white mb-6">AI Pipeline</h1>

            {/* Main Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <p className="text-xs text-gray-400">AI Processed</p>
                    <p className="mt-1 text-2xl font-bold text-white">{stats.totalProcessed}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <p className="text-xs text-gray-400">Auto Recognized</p>
                    <p className="mt-1 text-2xl font-bold text-green-400">{stats.autoRecognized}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <p className="text-xs text-gray-400">Enriched</p>
                    <p className="mt-1 text-2xl font-bold text-purple-400">{stats.enriched}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <p className="text-xs text-gray-400">Needs Review</p>
                    <p className="mt-1 text-2xl font-bold text-yellow-400">{stats.needsReview}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <p className="text-xs text-gray-400">Published</p>
                    <p className="mt-1 text-2xl font-bold text-green-400">{stats.published}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <p className="text-xs text-gray-400">Avg Confidence</p>
                    <p className="mt-1 text-2xl font-bold text-blue-400">{(stats.avgConfidence * 100).toFixed(1)}%</p>
                </div>
            </div>

            {/* TMDB Enrichment Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-300">Celebrity Enrichment</h3>
                        <span className="text-xs text-pink-400">TMDB</span>
                    </div>
                    <div className="flex items-end gap-2">
                        <span className="text-3xl font-bold text-pink-400">{celebStats.tmdbEnriched}</span>
                        <span className="text-gray-500 mb-1">/ {celebStats.total} celebrities</span>
                    </div>
                    {celebStats.total > 0 && (
                        <div className="mt-3 h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-pink-500 rounded-full transition-all"
                                style={{ width: `${(celebStats.tmdbEnriched / celebStats.total) * 100}%` }}
                            />
                        </div>
                    )}
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-300">Movie Enrichment</h3>
                        <span className="text-xs text-cyan-400">TMDB</span>
                    </div>
                    <div className="flex items-end gap-2">
                        <span className="text-3xl font-bold text-cyan-400">{movieStats.tmdbEnriched}</span>
                        <span className="text-gray-500 mb-1">/ {movieStats.total} movies</span>
                    </div>
                    {movieStats.total > 0 && (
                        <div className="mt-3 h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-cyan-500 rounded-full transition-all"
                                style={{ width: `${(movieStats.tmdbEnriched / movieStats.total) * 100}%` }}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Model Info + Quick Actions */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 mb-8">
                <h2 className="text-lg font-semibold text-white mb-3">AI Models</h2>
                <div className="flex flex-wrap gap-4 mb-4">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="text-sm text-gray-300">Gemini 2.5 Flash</span>
                        <span className="text-xs text-gray-500">— fast processing, $0.005/video</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-400" />
                        <span className="text-sm text-gray-300">Gemini 2.5 Pro</span>
                        <span className="text-xs text-gray-500">— better quality, higher cost</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-sm text-gray-300">Gemini 3.0 Flash</span>
                        <span className="text-xs text-gray-500">— next-gen fast, low cost</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-indigo-400" />
                        <span className="text-sm text-gray-300">Gemini 3.0 Pro</span>
                        <span className="text-xs text-gray-500">— next-gen quality, higher cost</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-yellow-400" />
                        <span className="text-sm text-gray-300">TMDB API</span>
                        <span className="text-xs text-gray-500">— celebrity photos, movie posters, bios</span>
                    </div>
                </div>
                <p className="text-xs text-gray-500">
                    Switch models in Pipeline Dashboard → Options → AI Model. Use <code className="text-gray-400">Scraper</code> tab for full pipeline control.
                </p>
            </div>

            {/* Recent AI Pipeline Activity */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
                <div className="p-4 border-b border-gray-800">
                    <h2 className="text-lg font-semibold text-white">Recent AI Activity</h2>
                </div>
                {recentVideos.length > 0 ? (
                    <table className="w-full text-sm">
                        <thead className="bg-gray-900/70">
                            <tr>
                                <th className="text-left p-3 text-gray-400 font-medium">Title</th>
                                <th className="text-left p-3 text-gray-400 font-medium">Status</th>
                                <th className="text-left p-3 text-gray-400 font-medium">Model</th>
                                <th className="text-left p-3 text-gray-400 font-medium">Confidence</th>
                                <th className="text-left p-3 text-gray-400 font-medium">Updated</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {recentVideos.map((v) => (
                                <tr key={v.id} className="hover:bg-gray-900/50">
                                    <td className="p-3 text-gray-200 max-w-xs truncate">{v.title || 'Untitled'}</td>
                                    <td className="p-3">
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                                            v.status === 'published' ? 'bg-green-900/50 text-green-400' :
                                            v.status === 'enriched' ? 'bg-purple-900/50 text-purple-400' :
                                            v.status === 'auto_recognized' ? 'bg-blue-900/50 text-blue-400' :
                                            v.status === 'needs_review' ? 'bg-yellow-900/50 text-yellow-400' :
                                            'bg-gray-800 text-gray-400'
                                        }`}>
                                            {v.status}
                                        </span>
                                    </td>
                                    <td className="p-3 text-gray-400 text-xs">{v.ai_model || '—'}</td>
                                    <td className="p-3 text-gray-400">
                                        {v.ai_confidence !== null ? `${(v.ai_confidence * 100).toFixed(0)}%` : '—'}
                                    </td>
                                    <td className="p-3 text-gray-500 text-xs">
                                        {new Date(v.updated_at).toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <p className="p-8 text-center text-gray-500">No AI pipeline activity yet</p>
                )}
            </div>
        </div>
    );
}
