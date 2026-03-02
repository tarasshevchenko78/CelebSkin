import { pool } from '@/lib/db';
import { getLocalizedField } from '@/lib/i18n';
import type { Video } from '@/lib/types';

export default async function AdminVideosPage({
    searchParams,
}: {
    searchParams: { status?: string; page?: string };
}) {
    const status = searchParams.status || '';
    const page = parseInt(searchParams.page || '1');
    const limit = 25;
    const offset = (page - 1) * limit;

    let videos: Video[] = [];
    let total = 0;

    try {
        const whereClause = status ? `WHERE v.status = $3` : '';
        const params = status ? [limit, offset, status] : [limit, offset];

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT v.* FROM videos v ${whereClause} ORDER BY v.created_at DESC LIMIT $1 OFFSET $2`,
                params
            ),
            pool.query(
                `SELECT COUNT(*) FROM videos v ${status ? `WHERE v.status = $1` : ''}`,
                status ? [status] : []
            ),
        ]);
        videos = dataResult.rows;
        total = parseInt(countResult.rows[0].count);
    } catch (error) {
        console.error('[AdminVideos] DB error:', error);
    }

    const totalPages = Math.ceil(total / limit);
    const statuses = ['', 'new', 'processing', 'enriched', 'published', 'needs_review', 'rejected'];

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-white">Videos ({total})</h1>
            </div>

            <div className="flex gap-2 mb-6">
                {statuses.map((s) => (
                    <a
                        key={s || 'all'}
                        href={`/admin/videos${s ? `?status=${s}` : ''}`}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                            status === s
                                ? 'bg-red-600 text-white'
                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        }`}
                    >
                        {s || 'All'}
                    </a>
                ))}
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-sm">
                    <thead className="bg-gray-900/70">
                        <tr>
                            <th className="text-left p-3 text-gray-400 font-medium">Title</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Status</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Views</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Created</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {videos.map((video) => (
                            <tr key={video.id} className="hover:bg-gray-900/50">
                                <td className="p-3 text-gray-200 max-w-xs truncate">
                                    {getLocalizedField(video.title, 'en') || video.original_title || 'Untitled'}
                                </td>
                                <td className="p-3">
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                                        video.status === 'published' ? 'bg-green-900/50 text-green-400' :
                                        video.status === 'needs_review' ? 'bg-yellow-900/50 text-yellow-400' :
                                        video.status === 'rejected' ? 'bg-red-900/50 text-red-400' :
                                        'bg-gray-800 text-gray-400'
                                    }`}>
                                        {video.status}
                                    </span>
                                </td>
                                <td className="p-3 text-gray-400">{video.views_count.toLocaleString()}</td>
                                <td className="p-3 text-gray-500 text-xs">
                                    {new Date(video.created_at).toLocaleDateString()}
                                </td>
                            </tr>
                        ))}
                        {videos.length === 0 && (
                            <tr>
                                <td colSpan={4} className="p-8 text-center text-gray-500">
                                    No videos found
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-3">
                    {page > 1 && (
                        <a href={`/admin/videos?${status ? `status=${status}&` : ''}page=${page - 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            ← Prev
                        </a>
                    )}
                    <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
                    {page < totalPages && (
                        <a href={`/admin/videos?${status ? `status=${status}&` : ''}page=${page + 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            Next →
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
