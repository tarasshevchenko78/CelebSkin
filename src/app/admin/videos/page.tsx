import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Video } from '@/lib/types';
import AdminVideosTable from '@/components/admin/AdminVideosTable';

export const dynamic = 'force-dynamic';

interface VideoRow extends Video {
    celebrity_names: string | null;
    movie_title: string | null;
    movie_year: number | null;
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
                         WHERE vc.video_id = v.id) AS celebrity_names,
                        (SELECT m.title FROM movies m
                         JOIN movie_scenes ms ON ms.movie_id = m.id
                         WHERE ms.video_id = v.id LIMIT 1) AS movie_title,
                        (SELECT m.year FROM movies m
                         JOIN movie_scenes ms ON ms.movie_id = m.id
                         WHERE ms.video_id = v.id LIMIT 1) AS movie_year
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
        logger.error('Admin videos page DB error', { page: 'admin/videos', error: error instanceof Error ? error.message : String(error) });
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

            <AdminVideosTable videos={videos} />

            {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-3">
                    {page > 1 && (
                        <a href={`/admin/videos?${status ? `status=${status}&` : ''}page=${page - 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            &larr; Prev
                        </a>
                    )}
                    <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
                    {page < totalPages && (
                        <a href={`/admin/videos?${status ? `status=${status}&` : ''}page=${page + 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            Next &rarr;
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
