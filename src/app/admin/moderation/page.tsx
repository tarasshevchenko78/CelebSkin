import { pool } from '@/lib/db';
import { getLocalizedField } from '@/lib/i18n';
import type { Video } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AdminModerationPage({
    searchParams,
}: {
    searchParams: { page?: string };
}) {
    const page = parseInt(searchParams.page || '1');
    const limit = 20;
    const offset = (page - 1) * limit;

    let videos: Video[] = [];
    let total = 0;

    try {
        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT v.* FROM videos v
                 WHERE v.status IN ('needs_review', 'enriched', 'auto_recognized', 'unknown_with_suggestions')
                 ORDER BY v.created_at DESC
                 LIMIT $1 OFFSET $2`,
                [limit, offset]
            ),
            pool.query(
                `SELECT COUNT(*) FROM videos
                 WHERE status IN ('needs_review', 'enriched', 'auto_recognized', 'unknown_with_suggestions')`
            ),
        ]);
        videos = dataResult.rows;
        total = parseInt(countResult.rows[0].count);
    } catch (error) {
        console.error('[AdminModeration] DB error:', error);
    }

    const totalPages = Math.ceil(total / limit);

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-white">Moderation Queue ({total})</h1>
            </div>

            {total === 0 ? (
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-12 text-center">
                    <svg className="w-12 h-12 text-green-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-gray-400">All caught up! No videos pending review.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {videos.map((video) => (
                        <div key={video.id} className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 flex gap-4 items-start">
                            {/* Thumbnail */}
                            <div className="w-32 aspect-video rounded-lg overflow-hidden bg-gray-800 shrink-0">
                                {video.thumbnail_url ? (
                                    <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-600">
                                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                        </svg>
                                    </div>
                                )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-medium text-white truncate">
                                    {getLocalizedField(video.title, 'en') || video.original_title || 'Untitled'}
                                </h3>
                                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                                    <span className={`px-2 py-0.5 rounded-full ${
                                        video.status === 'needs_review' ? 'bg-yellow-900/50 text-yellow-400' :
                                        video.status === 'enriched' ? 'bg-blue-900/50 text-blue-400' :
                                        'bg-gray-800 text-gray-400'
                                    }`}>
                                        {video.status}
                                    </span>
                                    {video.duration_formatted && <span>{video.duration_formatted}</span>}
                                    <span>{new Date(video.created_at).toLocaleDateString()}</span>
                                </div>
                                {video.ai_confidence !== null && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="text-xs text-gray-500">AI Confidence:</span>
                                        <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${
                                                    video.ai_confidence > 0.8 ? 'bg-green-500' :
                                                    video.ai_confidence > 0.5 ? 'bg-yellow-500' : 'bg-red-500'
                                                }`}
                                                style={{ width: `${(video.ai_confidence * 100).toFixed(0)}%` }}
                                            />
                                        </div>
                                        <span className="text-xs text-gray-400">{(video.ai_confidence * 100).toFixed(0)}%</span>
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 shrink-0">
                                <form action={`/api/admin/moderation`} method="POST">
                                    <input type="hidden" name="videoId" value={video.id} />
                                    <input type="hidden" name="action" value="approve" />
                                    <button
                                        type="submit"
                                        className="px-3 py-1.5 text-xs rounded-lg bg-green-900/50 text-green-400 border border-green-800 hover:bg-green-900 transition-colors"
                                    >
                                        Approve
                                    </button>
                                </form>
                                <form action={`/api/admin/moderation`} method="POST">
                                    <input type="hidden" name="videoId" value={video.id} />
                                    <input type="hidden" name="action" value="reject" />
                                    <button
                                        type="submit"
                                        className="px-3 py-1.5 text-xs rounded-lg bg-red-900/50 text-red-400 border border-red-800 hover:bg-red-900 transition-colors"
                                    >
                                        Reject
                                    </button>
                                </form>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-3">
                    {page > 1 && (
                        <a href={`/admin/moderation?page=${page - 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            ← Prev
                        </a>
                    )}
                    <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
                    {page < totalPages && (
                        <a href={`/admin/moderation?page=${page + 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            Next →
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
