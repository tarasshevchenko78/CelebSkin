import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import XcadrImportTable, { type XcadrImportRow } from './XcadrImportTable';
import XcadrPipelineControls from '@/components/admin/XcadrPipelineControls';

export const dynamic = 'force-dynamic';

const STATUSES = ['parsed', 'translated', 'matched', 'no_match', 'imported', 'skipped', 'duplicate'] as const;

const STATUS_LABELS: Record<string, string> = {
    parsed:     'Разобрано',
    translated: 'Переведено',
    matched:    'Совпало',
    no_match:   'Нет совпадения',
    imported:   'Импортировано',
    skipped:    'Пропущено',
    duplicate:  'Дубликат',
};

const STATUS_STAT_STYLES: Record<string, { card: string; number: string; label: string }> = {
    parsed:     { card: 'bg-blue-900/20 border-blue-800/40',    number: 'text-blue-400',    label: 'text-blue-500' },
    translated: { card: 'bg-yellow-900/20 border-yellow-800/40', number: 'text-yellow-400', label: 'text-yellow-500' },
    matched:    { card: 'bg-green-900/20 border-green-800/40',   number: 'text-green-400',  label: 'text-green-500' },
    no_match:   { card: 'bg-orange-900/20 border-orange-800/40', number: 'text-orange-400', label: 'text-orange-500' },
    imported:   { card: 'bg-emerald-900/20 border-emerald-800/40', number: 'text-emerald-400', label: 'text-emerald-500' },
    skipped:    { card: 'bg-gray-800/40 border-gray-700/40',     number: 'text-gray-400',   label: 'text-gray-500' },
    duplicate:  { card: 'bg-gray-800/40 border-gray-700/40',     number: 'text-gray-400',   label: 'text-gray-500' },
};

interface PageProps {
    searchParams: { status?: string; search?: string; page?: string };
}

export default async function XcadrImportPage({ searchParams }: PageProps) {
    const status = searchParams.status || '';
    const search = searchParams.search || '';
    const page   = Math.max(1, parseInt(searchParams.page || '1'));
    const limit  = 20;
    const offset = (page - 1) * limit;

    let imports: XcadrImportRow[] = [];
    let total    = 0;
    const stats: Record<string, number> = { total: 0 };
    for (const s of STATUSES) stats[s] = 0;

    try {
        const [dataResult, countResult, statsResult] = await Promise.all([
            pool.query<XcadrImportRow>(
                `SELECT * FROM xcadr_imports
                 WHERE ($1::text IS NULL OR status = $1)
                   AND ($2::text IS NULL OR
                        title_ru          ILIKE '%' || $2 || '%' OR
                        title_en          ILIKE '%' || $2 || '%' OR
                        celebrity_name_ru ILIKE '%' || $2 || '%' OR
                        celebrity_name_en ILIKE '%' || $2 || '%' OR
                        movie_title_ru    ILIKE '%' || $2 || '%' OR
                        movie_title_en    ILIKE '%' || $2 || '%'
                   )
                 ORDER BY created_at DESC
                 LIMIT $3 OFFSET $4`,
                [status || null, search || null, limit, offset]
            ),
            pool.query<{ count: number }>(
                `SELECT COUNT(*)::int AS count FROM xcadr_imports
                 WHERE ($1::text IS NULL OR status = $1)
                   AND ($2::text IS NULL OR
                        title_ru          ILIKE '%' || $2 || '%' OR
                        title_en          ILIKE '%' || $2 || '%' OR
                        celebrity_name_ru ILIKE '%' || $2 || '%' OR
                        celebrity_name_en ILIKE '%' || $2 || '%' OR
                        movie_title_ru    ILIKE '%' || $2 || '%' OR
                        movie_title_en    ILIKE '%' || $2 || '%'
                   )`,
                [status || null, search || null]
            ),
            pool.query<{ status: string; count: number }>(
                `SELECT status, COUNT(*)::int AS count FROM xcadr_imports GROUP BY status`
            ),
        ]);

        imports = dataResult.rows;
        total   = countResult.rows[0].count;

        for (const row of statsResult.rows) {
            stats[row.status] = row.count;
            stats.total += row.count;
        }
    } catch (error) {
        logger.error('xcadr admin page failed', {
            page: 'admin/xcadr',
            error: error instanceof Error ? error.message : String(error),
        });
    }

    const totalPages = Math.ceil(total / limit);

    // ── Build pagination URL helper ──────────────────────────────────────────
    function pageUrl(p: number) {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (search) params.set('search', search);
        if (p > 1)  params.set('page', String(p));
        const qs = params.toString();
        return `/admin/xcadr${qs ? `?${qs}` : ''}`;
    }

    function filterUrl(newStatus: string, newSearch?: string) {
        const params = new URLSearchParams();
        if (newStatus) params.set('status', newStatus);
        const s = newSearch !== undefined ? newSearch : search;
        if (s) params.set('search', s);
        const qs = params.toString();
        return `/admin/xcadr${qs ? `?${qs}` : ''}`;
    }

    return (
        <div>
            {/* ── Title ── */}
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Очередь импорта xcadr.online</h1>
                    <p className="mt-1 text-sm text-gray-500">{stats.total} импортов всего</p>
                </div>
            </div>

            {/* ── Pipeline Controls ── */}
            <XcadrPipelineControls stats={stats} />

            {/* ── Stats bar ── */}
            <div className="mb-6 grid grid-cols-4 gap-3 lg:grid-cols-7">
                {STATUSES.map((s) => {
                    const style = STATUS_STAT_STYLES[s];
                    return (
                        <a
                            key={s}
                            href={filterUrl(status === s ? '' : s)}
                            className={`rounded-lg border p-3 transition-all hover:scale-[1.02] ${style.card} ${
                                status === s ? 'ring-1 ring-current' : ''
                            }`}
                        >
                            <p className={`text-2xl font-bold leading-none ${style.number}`}>
                                {stats[s]}
                            </p>
                            <p className={`mt-1 text-[10px] font-medium uppercase tracking-wider ${style.label}`}>
                                {STATUS_LABELS[s]}
                            </p>
                        </a>
                    );
                })}
            </div>

            {/* ── Filter bar ── */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
                {/* Status pills */}
                <div className="flex flex-wrap gap-1.5">
                    <a
                        href={filterUrl('')}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                            !status
                                ? 'border-red-600 bg-red-600/20 text-red-400'
                                : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                        }`}
                    >
                        Все ({stats.total})
                    </a>
                    {STATUSES.map((s) => (
                        <a
                            key={s}
                            href={filterUrl(s)}
                            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                                status === s
                                    ? 'border-red-600 bg-red-600/20 text-red-400'
                                    : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                            }`}
                        >
                            {STATUS_LABELS[s]} ({stats[s]})
                        </a>
                    ))}
                </div>

                {/* Search — client form using GET */}
                <form method="GET" action="/admin/xcadr" className="ml-auto flex items-center gap-2">
                    {status && <input type="hidden" name="status" value={status} />}
                    <input
                        type="text"
                        name="search"
                        defaultValue={search}
                        placeholder="Поиск по имени, названию, фильму…"
                        className="w-64 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-gray-500 focus:outline-none"
                    />
                    <button
                        type="submit"
                        className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-600 transition-colors"
                    >
                        Найти
                    </button>
                    {search && (
                        <a
                            href={filterUrl(status)}
                            className="text-xs text-gray-500 hover:text-gray-300"
                        >
                            Сбросить
                        </a>
                    )}
                </form>
            </div>

            {/* ── Content ── */}
            {stats.total === 0 ? (
                /* Empty state — no imports at all */
                <div className="rounded-xl border border-gray-800 bg-gray-900/30 py-20 text-center">
                    <p className="text-lg font-medium text-gray-400">Импортов пока нет.</p>
                    <p className="mt-2 text-sm text-gray-600">Запустите парсер для начала импорта:</p>
                    <code className="mt-3 inline-block rounded bg-gray-800 px-4 py-2 text-sm text-gray-300">
                        node scripts/xcadr/parse-xcadr.js --pages 5
                    </code>
                </div>
            ) : imports.length === 0 ? (
                /* Empty state — filters returned nothing */
                <div className="rounded-xl border border-gray-800 bg-gray-900/30 py-16 text-center">
                    <p className="text-gray-400">Нет импортов по фильтрам.</p>
                    <a href="/admin/xcadr" className="mt-3 inline-block text-xs text-red-400 hover:text-red-300">
                        Сбросить фильтры
                    </a>
                </div>
            ) : (
                <>
                    <XcadrImportTable
                        imports={imports}
                        total={total}
                        page={page}
                        limit={limit}
                    />

                    {/* ── Server-rendered pagination ── */}
                    {totalPages > 1 && (
                        <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
                            <span>
                                Показано {offset + 1}–{Math.min(offset + limit, total)} из {total}
                            </span>
                            <div className="flex gap-2">
                                {page > 1 && (
                                    <a
                                        href={pageUrl(page - 1)}
                                        className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors"
                                    >
                                        ← Предыдущая
                                    </a>
                                )}
                                <span className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-gray-300">
                                    {page} / {totalPages}
                                </span>
                                {page < totalPages && (
                                    <a
                                        href={pageUrl(page + 1)}
                                        className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors"
                                    >
                                        Следующая →
                                    </a>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
