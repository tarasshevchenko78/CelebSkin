import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Celebrity } from '@/lib/types';
import AdminCelebritiesTable from '@/components/admin/AdminCelebritiesTable';

export const dynamic = 'force-dynamic';

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
        logger.error('Admin celebrities page DB error', { page: 'admin/celebrities', error: error instanceof Error ? error.message : String(error) });
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
                    className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
                />
            </form>

            <AdminCelebritiesTable celebrities={celebrities} />

            {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-3">
                    {page > 1 && (
                        <a href={`/admin/celebrities?${query ? `q=${encodeURIComponent(query)}&` : ''}page=${page - 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            &larr; Prev
                        </a>
                    )}
                    <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
                    {page < totalPages && (
                        <a href={`/admin/celebrities?${query ? `q=${encodeURIComponent(query)}&` : ''}page=${page + 1}`}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            Next &rarr;
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
