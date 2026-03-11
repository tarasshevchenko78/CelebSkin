'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRowSelection } from '@/hooks/useRowSelection';
import type { Celebrity } from '@/lib/types';

export default function AdminCelebritiesTable({ celebrities }: { celebrities: Celebrity[] }) {
    const router = useRouter();
    const [deleting, setDeleting] = useState(false);
    const { selected, toggle, toggleAll, clear, isAllSelected, selectedCount, selectedIds } =
        useRowSelection<number>(celebrities.map(c => c.id));

    const bulkDelete = async () => {
        if (!confirm(`Удалить ${selectedCount} актрис(у) безвозвратно? Это действие нельзя отменить.`)) return;
        setDeleting(true);
        try {
            const res = await fetch('/api/admin/celebrities', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: selectedIds }),
            });
            if (res.ok) {
                clear();
                router.refresh();
            }
        } catch {
            // error handled silently
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="relative">
            <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-sm">
                    <thead className="bg-gray-900/70">
                        <tr>
                            <th className="p-3 w-10">
                                <input
                                    type="checkbox"
                                    checked={isAllSelected}
                                    onChange={toggleAll}
                                    className="rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
                                />
                            </th>
                            <th className="text-left p-3 text-gray-400 font-medium">Фото</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Имя</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Статус</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Видео</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Фильмы</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Просмотры</th>
                            <th className="text-left p-3 text-gray-400 font-medium">В подборке</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {celebrities.map((celeb) => (
                            <tr key={celeb.id} className={`hover:bg-gray-900/50 ${selected.has(celeb.id) ? 'bg-purple-900/10' : ''}`}>
                                <td className="p-3">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(celeb.id)}
                                        onChange={() => toggle(celeb.id)}
                                        className="rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
                                    />
                                </td>
                                <td className="p-3">
                                    {celeb.photo_url ? (
                                        <img src={celeb.photo_url} alt={celeb.name} className="w-10 h-10 rounded-full object-cover" />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-xs text-gray-500">
                                            {celeb.name.charAt(0)}
                                        </div>
                                    )}
                                </td>
                                <td className="p-3">
                                    <a href={`/admin/celebrities/${celeb.id}`}
                                       className="text-gray-200 font-medium hover:text-white hover:underline">
                                        {celeb.name}
                                    </a>
                                </td>
                                <td className="p-3">
                                    {celeb.status === 'draft' ? (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-400">draft</span>
                                    ) : (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-400">published</span>
                                    )}
                                </td>
                                <td className="p-3 text-gray-400">{celeb.videos_count}</td>
                                <td className="p-3 text-gray-400">{celeb.movies_count}</td>
                                <td className="p-3 text-gray-400">{celeb.total_views.toLocaleString()}</td>
                                <td className="p-3">
                                    {celeb.is_featured ? (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/50 text-yellow-400">В подборке</span>
                                    ) : (
                                        <span className="text-xs text-gray-600">{'\u2014'}</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {celebrities.length === 0 && (
                            <tr>
                                <td colSpan={8} className="p-8 text-center text-gray-500">
                                    Актрисы не найдены
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Bulk action bar */}
            {selectedCount > 0 && (
                <div className="sticky bottom-0 mt-3 flex items-center justify-between rounded-xl border border-gray-700 bg-gray-900/95 backdrop-blur px-4 py-3">
                    <span className="text-sm text-gray-300">{selectedCount} выбрано</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={clear}
                            className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700"
                        >
                            Снять выделение
                        </button>
                        <button
                            onClick={bulkDelete}
                            disabled={deleting}
                            className="px-4 py-1.5 text-xs rounded-lg bg-red-700 text-white font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
                        >
                            {deleting ? 'Удаление...' : `Удалить (${selectedCount})`}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
