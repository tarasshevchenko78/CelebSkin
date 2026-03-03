import { pool } from '@/lib/db';
import { getLocalizedField } from '@/lib/i18n';
import type { Video } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUS_COLORS: Record<string, string> = {
    new: 'bg-gray-700 text-gray-300',
    processing: 'bg-blue-900/50 text-blue-300',
    enriched: 'bg-purple-900/50 text-purple-400',
    auto_recognized: 'bg-cyan-900/50 text-cyan-400',
    watermarked: 'bg-indigo-900/50 text-indigo-400',
    needs_review: 'bg-yellow-900/50 text-yellow-400',
    published: 'bg-green-900/50 text-green-400',
    rejected: 'bg-red-900/50 text-red-400',
    dmca_removed: 'bg-red-900/80 text-red-300',
};

interface VideoRow extends Video {
    celebrity_names: string | null;
}

export default async function AdminVideosPage({
    searchParams,
}: {
    searchParams: { status?: string; page?: string };
}) {
    const status = searchParams.status || '';
    const page = parseInt(searchParams.page || '1');
    const limit = 25;
    const offset = (page - 1) * limit;

    let videos: VideoRow[] = [];
    let total = 0;

    try {
        const whereClause = status ? `WHERE v.status = $3` : '';
        const params = status ? [limit, offset, status] : [limit, offset];

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT v.*,
                        (SELECT string_agg(c.name, ', ' ORDER BY c.name)
                         FROM celebrities c
                         JOIN video_celebrities vc ON vc.celebrity_id = c.id
                         WHERE vc.video_id = v.id) AS celebrity_names
                 FROM videos v ${whereClause}
                 ORDER BY v.created_at DESC LIMIT $1 OFFSET $2`,
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
    const statuses = ['', 'new', 'processing', 'auto_recognized', 'enriched', 'watermarked', 'published', 'needs_review', 'rejected'];

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-white">Videos ({total})</h1>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
                {statuses.map((s) => (
                    <a
                        key={s || 'all'}
                        href={`/admin/videos${s ? `?status=${s}` : ''}`}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                            status === s
                                ? 'bg-purple-600 text-white'
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
                            <th className="text-left p-3 text-gray-400 font-medium w-16">Thumb</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Title</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Celebrity</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Status</th>
                            <th className="text-left p-3 text-gray-400 font-medium">AI</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Views</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Created</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {videos.map((video) => (
                            <tr key={video.id} className="hover:bg-gray-900/50">
                                <td className="p-3">
                                    {video.thumbnail_url ? (
                                        <img src={video.thumbnail_url} alt="" className="w-14 h-9 rounded object-cover" />
                                    ) : (
                                        <div className="w-14 h-9 rounded bg-gray-800 flex items-center justify-center text-[10px] text-gray-600">?</div>
                                    )}
                                </td>
                                <td className="p-3 max-w-xs">
                                    <a href={`/admin/videos/${video.id}`}
                                       className="text-gray-200 font-medium hover:text-white hover:underline truncate block">
                                        {getLocalizedField(video.title, 'en') || video.original_title || 'Untitled'}
                                    </a>
                                </td>
                                <td className="p-3 text-gray-400 text-xs max-w-[150px] truncate">
                                    {video.celebrity_names || '—'}
                                </td>
                                <td className="p-3">
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[video.status] || 'bg-gray-800 text-gray-400'}`}>
                                        {video.status}
                                    </span>
                                </td>
                                <td className="p-3">
                                    {video.ai_confidence != null ? (
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-12 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full ${
                                                        video.ai_confidence >= 0.8 ? 'bg-green-500' :
                                                        video.ai_confidence >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'
                                                    }`}
                                                    style={{ width: `${Math.round(video.ai_confidence * 100)}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] text-gray-500">{Math.round(video.ai_confidence * 100)}%</span>
                                        </div>
                                    ) : (
                                        <span className="text-xs text-gray-600">—</span>
                                    )}
                                </td>
                                <td className="p-3 text-gray-400">{video.views_count.toLocaleString()}</td>
                                <td className="p-3 text-gray-500 text-xs">
                                    {new Date(video.created_at).toLocaleDateString()}
                                </td>
                            </tr>
                        ))}
                        {videos.length === 0 && (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-gray-500">
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
