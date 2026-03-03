'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRowSelection } from '@/hooks/useRowSelection';
import type { Movie } from '@/lib/types';

export default function AdminMoviesTable({ movies }: { movies: Movie[] }) {
    const router = useRouter();
    const [deleting, setDeleting] = useState(false);
    const { selected, toggle, toggleAll, clear, isAllSelected, selectedCount, selectedIds } =
        useRowSelection<number>(movies.map(m => m.id));

    const bulkDelete = async () => {
        if (!confirm(`Delete ${selectedCount} movie(s) permanently? This cannot be undone.`)) return;
        setDeleting(true);
        try {
            const res = await fetch('/api/admin/movies', {
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
                            <th className="text-left p-3 text-gray-400 font-medium w-12">Poster</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Title</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Year</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Scenes</th>
                            <th className="text-left p-3 text-gray-400 font-medium">TMDB</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {movies.map((movie) => (
                            <tr key={movie.id} className={`hover:bg-gray-900/50 ${selected.has(movie.id) ? 'bg-purple-900/10' : ''}`}>
                                <td className="p-3">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(movie.id)}
                                        onChange={() => toggle(movie.id)}
                                        className="rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
                                    />
                                </td>
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
                                <td className="p-3 text-gray-400">{movie.year || '\u2014'}</td>
                                <td className="p-3 text-gray-400">{movie.scenes_count}</td>
                                <td className="p-3 text-gray-500 text-xs">{movie.tmdb_id || '\u2014'}</td>
                            </tr>
                        ))}
                        {movies.length === 0 && (
                            <tr>
                                <td colSpan={6} className="p-8 text-center text-gray-500">No movies found</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Bulk action bar */}
            {selectedCount > 0 && (
                <div className="sticky bottom-0 mt-3 flex items-center justify-between rounded-xl border border-gray-700 bg-gray-900/95 backdrop-blur px-4 py-3">
                    <span className="text-sm text-gray-300">{selectedCount} selected</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={clear}
                            className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700"
                        >
                            Deselect All
                        </button>
                        <button
                            onClick={bulkDelete}
                            disabled={deleting}
                            className="px-4 py-1.5 text-xs rounded-lg bg-red-700 text-white font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
                        >
                            {deleting ? 'Deleting...' : `Delete Selected (${selectedCount})`}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
