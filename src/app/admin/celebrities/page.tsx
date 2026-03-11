import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Celebrity } from '@/lib/types';
import AdminCelebritiesTable from '@/components/admin/AdminCelebritiesTable';

export const dynamic = 'force-dynamic';

export default async function AdminCelebritiesPage({
    searchParams,
}: {
    searchParams: { page?: string; q?: string; status?: string };
}) {
    const page = parseInt(searchParams.page || '1');
    const query = searchParams.q || '';
    const statusFilter = searchParams.status || '';
    const limit = 25;
    const offset = (page - 1) * limit;

    let celebrities: Celebrity[] = [];
    let total = 0;

    try {
        const conditions: string[] = [];
        const params: (string | number)[] = [limit, offset];
        let idx = 3;

        if (query) {
            conditions.push(`c.name ILIKE $${idx++}`);
            params.push(`%${query}%`);
        }
        if (statusFilter === 'published' || statusFilter === 'draft') {
            conditions.push(`c.status = $${idx++}`);
            params.push(statusFilter);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countConditions: string[] = [];
        const countParams: (string | number)[] = [];
        let cidx = 1;
        if (query) { countConditions.push(`c.name ILIKE $${cidx++}`); countParams.push(`%${query}%`); }
        if (statusFilter === 'published' || statusFilter === 'draft') { countConditions.push(`c.status = $${cidx++}`); countParams.push(statusFilter); }
        const countWhere = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT c.* FROM celebrities c ${whereClause} ORDER BY c.total_views DESC LIMIT $1 OFFSET $2`,
                params
            ),
            pool.query(
                `SELECT COUNT(*) FROM celebrities c ${countWhere}`,
                countParams
            ),
        ]);
        celebrities = dataResult.rows;
        total = parseInt(countResult.rows[0].count);
    } catch (error) {
        logger.error('Admin celebrities page DB error', { page: 'admin/celebrities', error: error instanceof Error ? error.message : String(error) });
    }

    const totalPages = Math.ceil(total / limit);

    const buildUrl = (overrides: Record<string, string>) => {
        const p = new URLSearchParams();
        if (query) p.set('q', query);
        if (statusFilter) p.set('status', statusFilter);
        p.set('page', '1');
        Object.entries(overrides).forEach(([k, v]) => { if (v) p.set(k, v); else p.delete(k); });
        return `/admin/celebrities?${p.toString()}`;
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-white">Актрисы ({total})</h1>
            </div>

            {/* Filters row */}
            <div className="mb-6 flex flex-wrap items-center gap-3">
                <form className="flex-1 min-w-[200px] max-w-sm">
                    <input
                        name="q"
                        type="text"
                        defaultValue={query}
                        placeholder="Поиск по имени..."
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
                    />
                    {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
                </form>
                <div className="flex items-center gap-1 text-sm">
                    {(['', 'published', 'draft'] as const).map((s) => (
                        <a
                            key={s || 'all'}
                            href={buildUrl({ status: s, page: '1' })}
                            className={`px-3 py-1.5 rounded-lg border transition-colors ${
                                statusFilter === s
                                    ? 'bg-purple-700 border-purple-600 text-white'
                                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                            }`}
                        >
                            {s === '' ? 'Все' : s === 'published' ? 'Опубликовано' : 'Черновик'}
                        </a>
                    ))}
                </div>
            </div>

            <AdminCelebritiesTable celebrities={celebrities} />

            {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-3">
                    {page > 1 && (
                        <a href={buildUrl({ page: String(page - 1) })}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            &larr; Назад
                        </a>
                    )}
                    <span className="text-sm text-gray-500">Стр. {page} / {totalPages}</span>
                    {page < totalPages && (
                        <a href={buildUrl({ page: String(page + 1) })}
                           className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            Вперёд &rarr;
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
