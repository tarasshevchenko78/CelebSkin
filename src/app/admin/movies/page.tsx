import { pool } from '@/lib/db';
import type { Movie } from '@/lib/types';

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
        console.error('[AdminMovies] DB error:', error);
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
                    className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-red-500"
                />
            </form>

            <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-sm">
                    <thead className="bg-gray-900/70">
                        <tr>
                            <th className="text-left p-3 text-gray-400 font-medium w-12">Poster</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Title</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Year</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Scenes</th>
                            <th className="text-left p-3 text-gray-400 font-medium">TMDB</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {movies.map((movie) => (
                            <tr key={movie.id} className="hover:bg-gray-900/50">
                                <td className="p-3">
                                    {movie.poster_url ? (
                                        <img src={movie.poster_url} alt="" className="w-8 h-12 rounded object-cover" />
                                    ) : (
                                        <div className="w-8 h-12 rounded bg-gray-800 flex items-center justify-center text-[10px] text-gray-600">?</div>
                                    )}
                                </td>
                                <td className="p-3">
                                    <a href={`/admin/movies/${movie.id}`}
                                        className="text-gray-200 font-medium hover:text-white hover:underline">
                                        {movie.title}
                                    </a>
                                </td>
                                <td className="p-3 text-gray-400">{movie.year || '—'}</td>
                                <td className="p-3 text-gray-400">{movie.scenes_count}</td>
                                <td className="p-3 text-gray-500 text-xs">{movie.tmdb_id || '—'}</td>
                            </tr>
                        ))}
                        {movies.length === 0 && (
                            <tr>
                                <td colSpan={5} className="p-8 text-center text-gray-500">No movies found</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-3">
                    {page > 1 && (
                        <a href={`/admin/movies?${query ? `q=${encodeURIComponent(query)}&` : ''}page=${page - 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">← Prev</a>
                    )}
                    <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
                    {page < totalPages && (
                        <a href={`/admin/movies?${query ? `q=${encodeURIComponent(query)}&` : ''}page=${page + 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">Next →</a>
                    )}
                </div>
            )}
        </div>
    );
}
