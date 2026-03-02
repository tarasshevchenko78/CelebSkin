import { pool } from '@/lib/db';
import type { Celebrity } from '@/lib/types';

export default async function AdminCelebritiesPage({
    searchParams,
}: {
    searchParams: { page?: string; q?: string };
}) {
    const page = parseInt(searchParams.page || '1');
    const query = searchParams.q || '';
    const limit = 25;
    const offset = (page - 1) * limit;

    let celebrities: Celebrity[] = [];
    let total = 0;

    try {
        const whereClause = query ? `WHERE c.name ILIKE $3` : '';
        const params = query ? [limit, offset, `%${query}%`] : [limit, offset];

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT c.* FROM celebrities c ${whereClause} ORDER BY c.total_views DESC LIMIT $1 OFFSET $2`,
                params
            ),
            pool.query(
                `SELECT COUNT(*) FROM celebrities c ${query ? `WHERE c.name ILIKE $1` : ''}`,
                query ? [`%${query}%`] : []
            ),
        ]);
        celebrities = dataResult.rows;
        total = parseInt(countResult.rows[0].count);
    } catch (error) {
        console.error('[AdminCelebrities] DB error:', error);
    }

    const totalPages = Math.ceil(total / limit);

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-white">Celebrities ({total})</h1>
            </div>

            {/* Search */}
            <form className="mb-6">
                <input
                    name="q"
                    type="text"
                    defaultValue={query}
                    placeholder="Search by name..."
                    className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-red-500"
                />
            </form>

            <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-sm">
                    <thead className="bg-gray-900/70">
                        <tr>
                            <th className="text-left p-3 text-gray-400 font-medium">Photo</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Name</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Videos</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Movies</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Views</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Featured</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {celebrities.map((celeb) => (
                            <tr key={celeb.id} className="hover:bg-gray-900/50">
                                <td className="p-3">
                                    {celeb.photo_url ? (
                                        <img src={celeb.photo_url} alt={celeb.name} className="w-10 h-10 rounded-full object-cover" />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-xs text-gray-500">
                                            {celeb.name.charAt(0)}
                                        </div>
                                    )}
                                </td>
                                <td className="p-3 text-gray-200 font-medium">{celeb.name}</td>
                                <td className="p-3 text-gray-400">{celeb.videos_count}</td>
                                <td className="p-3 text-gray-400">{celeb.movies_count}</td>
                                <td className="p-3 text-gray-400">{celeb.total_views.toLocaleString()}</td>
                                <td className="p-3">
                                    {celeb.is_featured ? (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/50 text-yellow-400">Featured</span>
                                    ) : (
                                        <span className="text-xs text-gray-600">—</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {celebrities.length === 0 && (
                            <tr>
                                <td colSpan={6} className="p-8 text-center text-gray-500">
                                    No celebrities found
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-3">
                    {page > 1 && (
                        <a href={`/admin/celebrities?${query ? `q=${encodeURIComponent(query)}&` : ''}page=${page - 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            ← Prev
                        </a>
                    )}
                    <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
                    {page < totalPages && (
                        <a href={`/admin/celebrities?${query ? `q=${encodeURIComponent(query)}&` : ''}page=${page + 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            Next →
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
