import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Movie } from '@/lib/types';
import AdminMoviesTable from '@/components/admin/AdminMoviesTable';

export const dynamic = 'force-dynamic';

export default async function AdminMoviesPage({
    searchParams,
}: {
    searchParams: { page?: string; q?: string };
}) {
    const page = parseInt(searchParams.page || '1');
    const query = searchParams.q || '';
    const limit = 25;
    const offset = (page - 1) * limit;

    let movies: Movie[] = [];
    let total = 0;

    try {
        const whereClause = query ? `WHERE m.title ILIKE $3` : '';
        const params = query ? [limit, offset, `%${query}%`] : [limit, offset];

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT m.* FROM movies m ${whereClause} ORDER BY m.scenes_count DESC, m.created_at DESC LIMIT $1 OFFSET $2`,
                params
            ),
            pool.query(
                `SELECT COUNT(*) FROM movies m ${query ? `WHERE m.title ILIKE $1` : ''}`,
                query ? [`%${query}%`] : []
            ),
        ]);
        movies = dataResult.rows;
        total = parseInt(countResult.rows[0].count);
    } catch (error) {
        logger.error('Admin movies page DB error', { page: 'admin/movies', error: error instanceof Error ? error.message : String(error) });
    }

    const totalPages = Math.ceil(total / limit);

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-white">Movies ({total})</h1>
            </div>

            <form className="mb-6">
                <input
                    name="q"
                    type="text"
                    defaultValue={query}
                    placeholder="Search by title..."
                    className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
                />
            </form>

            <AdminMoviesTable movies={movies} />

            {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-3">
                    {page > 1 && (
                        <a href={`/admin/movies?${query ? `q=${encodeURIComponent(query)}&` : ''}page=${page - 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            &larr; Prev
                        </a>
                    )}
                    <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
                    {page < totalPages && (
                        <a href={`/admin/movies?${query ? `q=${encodeURIComponent(query)}&` : ''}page=${page + 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            Next &rarr;
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
