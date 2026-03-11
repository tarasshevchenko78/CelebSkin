'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRowSelection } from '@/hooks/useRowSelection';

export interface XcadrImportRow {
    id: number;
    xcadr_url: string;
    title_ru: string;
    title_en: string | null;
    celebrity_name_ru: string | null;
    celebrity_name_en: string | null;
    movie_title_ru: string | null;
    movie_title_en: string | null;
    movie_year: number | null;
    tags_ru: string[] | null;
    collections_ru: string[] | null;
    screenshot_urls: string[] | null;
    status: string;
    matched_video_id: string | null;
    boobsradar_url: string | null;
    created_at: string;
}

interface Props {
    imports: XcadrImportRow[];
    total: number;
    page: number;
    limit: number;
}

const STATUS_STYLES: Record<string, string> = {
    parsed:     'bg-blue-600/20 text-blue-400 border-blue-600/30',
    translated: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
    matched:    'bg-green-600/20 text-green-400 border-green-600/30',
    no_match:   'bg-orange-600/20 text-orange-400 border-orange-600/30',
    imported:   'bg-emerald-600/20 text-emerald-400 border-emerald-600/30',
    skipped:    'bg-gray-600/20 text-gray-400 border-gray-600/30',
    duplicate:  'bg-gray-600/20 text-gray-400 border-gray-600/30',
};


const STATUS_LABELS_RU: Record<string, string> = {
    parsed:     'Разобрано',
    translated: 'Переведено',
    matched:    'Совпало',
    no_match:   'Нет совпадения',
    imported:   'Импортировано',
    skipped:    'Пропущено',
    duplicate:  'Дубликат',
};
export default function XcadrImportTable({ imports, total, page, limit }: Props) {
    const router = useRouter();
    const [loading, setLoading] = useState<string | null>(null); // action in progress

    const allIds = imports.map((r) => r.id);
    const { selected, toggle, toggleAll, clear, isAllSelected, selectedCount, selectedIds } =
        useRowSelection<number>(allIds);

    // ── API caller ──────────────────────────────────────────────────────────
    async function callAction(action: string, ids: number[]) {
        setLoading(action);
        try {
            const res = await fetch('/api/admin/xcadr', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ids }),
            });
            if (res.ok) {
                clear();
                router.refresh();
            } else {
                const err = await res.json().catch(() => ({}));
                alert(`Error: ${err.error || res.statusText}`);
            }
        } catch {
            alert('Network error');
        } finally {
            setLoading(null);
        }
    }

    // ── Bulk actions ────────────────────────────────────────────────────────
    const bulkSkip   = () => callAction('skip', selectedIds);
    const bulkRetry  = () => callAction('retry', selectedIds);
    const bulkDelete = () => {
        if (!confirm(`Delete ${selectedCount} import(s) permanently? This cannot be undone.`)) return;
        callAction('delete', selectedIds);
    };
    const bulkImportAllMatched = () => {
        const matchedIds = imports.filter((r) => r.status === 'matched').map((r) => r.id);
        if (matchedIds.length === 0) { alert('Нет совпавших записей на этой странице.'); return; }
        if (!confirm(`Import ${matchedIds.length} matched item(s) into the pipeline?`)) return;
        callAction('import', matchedIds);
    };

    // ── Single-row actions ──────────────────────────────────────────────────
    const rowSkip   = (id: number) => callAction('skip', [id]);
    const rowRetry  = (id: number) => callAction('retry', [id]);
    const rowDelete = (id: number) => {
        if (!confirm('Удалить эту запись? Это нельзя отменить.')) return;
        callAction('delete', [id]);
    };
    const rowImport = (id: number) => callAction('import', [id]);

    const totalPages = Math.ceil(total / limit);

    return (
        <div>
            {/* ── Bulk action bar ── */}
            {selectedCount > 0 && (
                <div className="mb-4 flex items-center gap-3 rounded-lg border border-gray-700 bg-gray-900/70 px-4 py-2">
                    <span className="text-sm text-gray-300">{selectedCount} выбрано</span>
                    <button
                        onClick={bulkSkip}
                        disabled={loading === 'skip'}
                        className="rounded px-3 py-1.5 text-xs bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-50 transition-colors"
                    >
                        Пропустить выбранные
                    </button>
                    <button
                        onClick={bulkRetry}
                        disabled={loading === 'retry'}
                        className="rounded px-3 py-1.5 text-xs bg-yellow-700/40 text-yellow-300 hover:bg-yellow-700/60 disabled:opacity-50 transition-colors"
                    >
                        Повторить выбранные
                    </button>
                    <button
                        onClick={bulkDelete}
                        disabled={loading === 'delete'}
                        className="rounded px-3 py-1.5 text-xs bg-red-700/40 text-red-300 hover:bg-red-700/60 disabled:opacity-50 transition-colors"
                    >
                        Удалить выбранные
                    </button>
                    <button
                        onClick={bulkImportAllMatched}
                        disabled={loading === 'import'}
                        className="rounded px-3 py-1.5 text-xs bg-green-700/40 text-green-300 hover:bg-green-700/60 disabled:opacity-50 transition-colors"
                    >
                        Импортировать совпавшие
                    </button>
                    <button
                        onClick={clear}
                        className="ml-auto text-xs text-gray-500 hover:text-gray-300"
                    >
                        Сбросить
                    </button>
                </div>
            )}

            {/* ── Table ── */}
            <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-gray-800 bg-gray-900/60">
                            <th className="w-8 px-3 py-3">
                                <input
                                    type="checkbox"
                                    checked={isAllSelected}
                                    onChange={toggleAll}
                                    className="rounded border-gray-600 bg-gray-800 accent-red-600"
                                />
                            </th>
                            <th className="w-24 px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                Превью
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                Инфо
                            </th>
                            <th className="w-28 px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                Статус
                            </th>
                            <th className="w-48 px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                Действия
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60">
                        {imports.map((row) => (
                            <tr
                                key={row.id}
                                className={`transition-colors hover:bg-gray-800/30 ${selected.has(row.id) ? 'bg-gray-800/50' : ''}`}
                            >
                                {/* Checkbox */}
                                <td className="px-3 py-3">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(row.id)}
                                        onChange={() => toggle(row.id)}
                                        className="rounded border-gray-600 bg-gray-800 accent-red-600"
                                    />
                                </td>

                                {/* Thumbnail */}
                                <td className="px-3 py-3">
                                    {row.screenshot_urls?.[0] ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={row.screenshot_urls[0]}
                                            alt=""
                                            width={96}
                                            height={56}
                                            className="h-14 w-24 rounded object-cover bg-gray-800"
                                            loading="lazy"
                                            onError={(e) => {
                                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                    ) : (
                                        <div className="flex h-14 w-24 items-center justify-center rounded bg-gray-800 text-gray-600">
                                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                                    d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                                            </svg>
                                        </div>
                                    )}
                                </td>

                                {/* Info */}
                                <td className="px-3 py-3 max-w-xs lg:max-w-md">
                                    <p className="text-sm font-medium text-white truncate">
                                        {row.title_en || row.title_ru}
                                    </p>
                                    {row.title_en && row.title_en !== row.title_ru && (
                                        <p className="text-xs text-gray-500 truncate">{row.title_ru}</p>
                                    )}
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                        {(row.celebrity_name_en || row.celebrity_name_ru) && (
                                            <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">
                                                {row.celebrity_name_en || row.celebrity_name_ru}
                                            </span>
                                        )}
                                        {(row.movie_title_en || row.movie_title_ru) && (
                                            <span className="text-xs text-gray-500">
                                                {row.movie_title_en || row.movie_title_ru}
                                                {row.movie_year ? ` (${row.movie_year})` : ''}
                                            </span>
                                        )}
                                    </div>
                                    {row.tags_ru && row.tags_ru.length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {row.tags_ru.slice(0, 5).map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="rounded bg-gray-800/50 px-1.5 py-0.5 text-[10px] text-gray-500"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                            {row.tags_ru.length > 5 && (
                                                <span className="text-[10px] text-gray-600">+{row.tags_ru.length - 5}</span>
                                            )}
                                        </div>
                                    )}
                                </td>

                                {/* Status */}
                                <td className="px-3 py-3">
                                    <span
                                        className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${
                                            STATUS_STYLES[row.status] ?? 'bg-gray-700 text-gray-400 border-gray-600'
                                        }`}
                                    >
                                        {STATUS_LABELS_RU[row.status] || row.status.replace('_', ' ')}
                                    </span>
                                </td>

                                {/* Actions */}
                                <td className="px-3 py-3">
                                    <div className="flex flex-wrap gap-1.5">
                                        {/* View Source */}
                                        <a
                                            href={row.xcadr_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
                                            title="Смотреть на xcadr"
                                        >
                                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                            Источник
                                        </a>

                                        {/* Find Video on boobsradar */}
                                        {row.boobsradar_url && (
                                            <a
                                                href={row.boobsradar_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 rounded bg-green-900/30 px-2 py-1 text-xs text-green-400 hover:bg-green-900/50 transition-colors"
                                                title="Найти на boobsradar"
                                            >
                                                Find Video
                                            </a>
                                        )}

                                        {/* View matched video in admin */}
                                        {row.matched_video_id && (
                                            <a
                                                href={`/admin/videos/${row.matched_video_id}`}
                                                className="inline-flex items-center gap-1 rounded bg-purple-900/30 px-2 py-1 text-xs text-purple-400 hover:bg-purple-900/50 transition-colors"
                                            >
                                                View Video
                                            </a>
                                        )}

                                        {/* Skip */}
                                        {!['skipped', 'imported'].includes(row.status) && (
                                            <button
                                                onClick={() => rowSkip(row.id)}
                                                disabled={loading !== null}
                                                className="rounded bg-gray-700/50 px-2 py-1 text-xs text-gray-400 hover:bg-gray-700 disabled:opacity-40 transition-colors"
                                            >
                                                Пропустить
                                            </button>
                                        )}

                                        {/* Retry */}
                                        <button
                                            onClick={() => rowRetry(row.id)}
                                            disabled={loading !== null}
                                            className="rounded bg-yellow-900/30 px-2 py-1 text-xs text-yellow-400 hover:bg-yellow-900/50 disabled:opacity-40 transition-colors"
                                        >
                                            Retry
                                        </button>

                                        {/* Import */}
                                        {row.status === 'matched' && (
                                            <button
                                                onClick={() => rowImport(row.id)}
                                                disabled={loading !== null}
                                                className="rounded bg-green-700/40 px-2 py-1 text-xs text-green-300 hover:bg-green-700/60 disabled:opacity-40 transition-colors"
                                            >
                                                Импортировать
                                            </button>
                                        )}

                                        {/* Delete */}
                                        <button
                                            onClick={() => rowDelete(row.id)}
                                            disabled={loading !== null}
                                            className="rounded bg-red-900/20 px-2 py-1 text-xs text-red-400 hover:bg-red-900/40 disabled:opacity-40 transition-colors"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* ── Pagination ── */}
            {totalPages > 1 && (
                <PaginationControls page={page} totalPages={totalPages} />
            )}
        </div>
    );
}

// ── Pagination (keeps current URL search params) ──────────────────────────────
function PaginationControls({ page, totalPages }: { page: number; totalPages: number }) {
    const router = useRouter();

    function go(p: number) {
        const url = new URL(window.location.href);
        url.searchParams.set('page', String(p));
        router.push(url.pathname + url.search);
    }

    return (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
            <span>Стр. {page} из {totalPages}</span>
            <div className="flex gap-2">
                <button
                    onClick={() => go(page - 1)}
                    disabled={page <= 1}
                    className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                    ← Назад
                </button>
                <button
                    onClick={() => go(page + 1)}
                    disabled={page >= totalPages}
                    className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                    Далее →
                </button>
            </div>
        </div>
    );
}
