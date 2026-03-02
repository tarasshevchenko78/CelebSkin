import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AdminAiPage() {
    let stats = {
        totalProcessed: 0,
        autoRecognized: 0,
        needsReview: 0,
        avgConfidence: 0,
    };

    let recentLogs: { id: string; title: string; status: string; ai_confidence: number | null; updated_at: string }[] = [];

    try {
        const [statsResult, logsResult] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE ai_model IS NOT NULL) AS total_processed,
                    COUNT(*) FILTER (WHERE status = 'auto_recognized') AS auto_recognized,
                    COUNT(*) FILTER (WHERE status = 'needs_review') AS needs_review,
                    COALESCE(AVG(ai_confidence) FILTER (WHERE ai_confidence IS NOT NULL), 0) AS avg_confidence
                FROM videos
            `),
            pool.query(`
                SELECT id, original_title AS title, status, ai_confidence, updated_at
                FROM videos
                WHERE ai_model IS NOT NULL
                ORDER BY updated_at DESC
                LIMIT 20
            `),
        ]);

        const row = statsResult.rows[0];
        stats = {
            totalProcessed: parseInt(row.total_processed),
            autoRecognized: parseInt(row.auto_recognized),
            needsReview: parseInt(row.needs_review),
            avgConfidence: parseFloat(row.avg_confidence),
        };
        recentLogs = logsResult.rows;
    } catch (error) {
        console.error('[AdminAI] DB error:', error);
    }

    return (
        <div>
            <h1 className="text-2xl font-bold text-white mb-6">AI Pipeline</h1>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
                    <p className="text-xs text-gray-400">AI Processed</p>
                    <p className="mt-1 text-2xl font-bold text-white">{stats.totalProcessed.toLocaleString()}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
                    <p className="text-xs text-gray-400">Auto Recognized</p>
                    <p className="mt-1 text-2xl font-bold text-green-400">{stats.autoRecognized.toLocaleString()}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
                    <p className="text-xs text-gray-400">Needs Review</p>
                    <p className="mt-1 text-2xl font-bold text-yellow-400">{stats.needsReview.toLocaleString()}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
                    <p className="text-xs text-gray-400">Avg Confidence</p>
                    <p className="mt-1 text-2xl font-bold text-blue-400">{(stats.avgConfidence * 100).toFixed(1)}%</p>
                </div>
            </div>

            {/* Model info */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 mb-8">
                <h2 className="text-lg font-semibold text-white mb-3">AI Models</h2>
                <div className="flex gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="text-sm text-gray-300">Gemini 2.5 Flash</span>
                        <span className="text-xs text-gray-500">— primary</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-400" />
                        <span className="text-sm text-gray-300">Gemini 2.5 Pro</span>
                        <span className="text-xs text-gray-500">— enrichment</span>
                    </div>
                </div>
            </div>

            {/* Recent pipeline logs */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
                <div className="p-4 border-b border-gray-800">
                    <h2 className="text-lg font-semibold text-white">Recent Pipeline Activity</h2>
                </div>
                {recentLogs.length > 0 ? (
                    <table className="w-full text-sm">
                        <thead className="bg-gray-900/70">
                            <tr>
                                <th className="text-left p-3 text-gray-400 font-medium">Title</th>
                                <th className="text-left p-3 text-gray-400 font-medium">Status</th>
                                <th className="text-left p-3 text-gray-400 font-medium">Confidence</th>
                                <th className="text-left p-3 text-gray-400 font-medium">Updated</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {recentLogs.map((log) => (
                                <tr key={log.id} className="hover:bg-gray-900/50">
                                    <td className="p-3 text-gray-200 max-w-xs truncate">{log.title || 'Untitled'}</td>
                                    <td className="p-3">
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                                            log.status === 'published' ? 'bg-green-900/50 text-green-400' :
                                            log.status === 'auto_recognized' ? 'bg-blue-900/50 text-blue-400' :
                                            log.status === 'needs_review' ? 'bg-yellow-900/50 text-yellow-400' :
                                            'bg-gray-800 text-gray-400'
                                        }`}>
                                            {log.status}
                                        </span>
                                    </td>
                                    <td className="p-3 text-gray-400">
                                        {log.ai_confidence !== null ? `${(log.ai_confidence * 100).toFixed(0)}%` : '—'}
                                    </td>
                                    <td className="p-3 text-gray-500 text-xs">
                                        {new Date(log.updated_at).toLocaleString()}
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
