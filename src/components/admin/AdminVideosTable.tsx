'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRowSelection } from '@/hooks/useRowSelection';
import type { Video } from '@/lib/types';

const STATUS_COLORS: Record<string, string> = {
    new: 'bg-gray-700 text-gray-300',
    processing: 'bg-blue-900/50 text-blue-300',
    enriched: 'bg-purple-900/50 text-purple-400',
    auto_recognized: 'bg-cyan-900/50 text-cyan-400',
    watermarked: 'bg-indigo-900/50 text-indigo-400',
    needs_review: 'bg-yellow-900/50 text-yellow-400',
    published: 'bg-green-900/50 text-green-400',
    rejected: 'bg-red-900/50 text-red-400',
    dmca_removed: 'bg-red-900/80 text-red-300',
};

interface VideoRow extends Video {
    celebrity_names: string | null;
    movie_title: string | null;
    movie_year: number | null;
}

// Re-export for page.tsx typing
export type { VideoRow };

function getLocalizedField(field: unknown, locale: string): string {
    if (!field || typeof field !== 'object') return '';
    return (field as Record<string, string>)[locale] || '';
}

export default function AdminVideosTable({ videos }: { videos: VideoRow[] }) {
    const router = useRouter();
    const [deleting, setDeleting] = useState(false);
    const { selected, toggle, toggleAll, clear, isAllSelected, selectedCount, selectedIds } =
        useRowSelection<string>(videos.map(v => v.id));

    const bulkDelete = async () => {
        if (!confirm(`Удалить ${selectedCount} видео безвозвратно? Это действие нельзя отменить.`)) return;
        setDeleting(true);
        try {
            const res = await fetch('/api/admin/videos', {
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
                            <th className="text-left p-3 text-gray-400 font-medium w-16">Превью</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Название</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Актриса</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Фильм</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Статус</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Источник</th>
                            <th className="text-left p-3 text-gray-400 font-medium">AI</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Просмотры</th>
                            <th className="text-left p-3 text-gray-400 font-medium">Создано</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {videos.map((video) => (
                            <tr key={video.id} className={`hover:bg-gray-900/50 ${selected.has(video.id) ? 'bg-purple-900/10' : ''}`}>
                                <td className="p-3">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(video.id)}
                                        onChange={() => toggle(video.id)}
                                        className="rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
                                    />
                                </td>
                                <td className="p-3">
                                    {video.thumbnail_url ? (
                                        <img
                                            src={video.thumbnail_url.startsWith('http') ? video.thumbnail_url : `https://celebskin-cdn.b-cdn.net/${video.thumbnail_url.replace(/^\//, '')}`}
                                            alt=""
                                            className="w-14 h-9 rounded object-cover"
                                        />
                                    ) : (
                                        <div className="w-14 h-9 rounded bg-gray-800 flex items-center justify-center text-[10px] text-gray-600">?</div>
                                    )}
                                </td>
                                <td className="p-3 max-w-xs">
                                    <a href={`/admin/videos/${video.id}`}
                                        className="text-gray-200 font-medium hover:text-white hover:underline truncate block">
                                        {getLocalizedField(video.title, 'en') || video.original_title || 'Untitled'}
                                    </a>
                                </td>
                                <td className="p-3 text-gray-400 text-xs max-w-[150px] truncate">
                                    {video.celebrity_names || '\u2014'}
                                </td>
                                <td className="p-3 text-gray-400 text-xs max-w-[140px] truncate">
                                    {video.movie_title ? (
                                        <span>{video.movie_title}{video.movie_year ? ` (${video.movie_year})` : ''}</span>
                                    ) : '\u2014'}
                                </td>
                                <td className="p-3">
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[video.status] || 'bg-gray-800 text-gray-400'}`}>
                                        {video.status}
                                    </span>
                                </td>
                                <td className="p-3">
                                    {video.source_url?.includes('xcadr') ? (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-900/50 text-cyan-400">xcadr</span>
                                    ) : video.raw_video_id ? (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-900/50 text-indigo-400">boobsradar</span>
                                    ) : (
                                        <span className="text-xs text-gray-600">{'\u2014'}</span>
                                    )}
                                </td>
                                <td className="p-3">
                                    {video.ai_confidence != null ? (
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-12 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full ${video.ai_confidence >= 0.8 ? 'bg-green-500' :
                                                            video.ai_confidence >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'
                                                        }`}
                                                    style={{ width: `${Math.round(video.ai_confidence * 100)}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] text-gray-500">{Math.round(video.ai_confidence * 100)}%</span>
                                        </div>
                                    ) : video.ai_vision_status ? (
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                                            video.ai_vision_status === 'completed' ? 'bg-green-900/50 text-green-400' :
                                            video.ai_vision_status === 'censored' ? 'bg-orange-900/50 text-orange-400' :
                                            video.ai_vision_status === 'timeout_fallback' ? 'bg-yellow-900/50 text-yellow-400' :
                                            video.ai_vision_status === 'error' ? 'bg-red-900/50 text-red-400' :
                                            'bg-gray-800 text-gray-400'
                                        }`}>
                                            {video.ai_vision_status === 'completed' ? 'AI OK' :
                                             video.ai_vision_status === 'censored' ? 'Цензура' :
                                             video.ai_vision_status === 'timeout_fallback' ? 'Таймаут' :
                                             video.ai_vision_status === 'error' ? 'Ошибка' :
                                             video.ai_vision_status}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-gray-600">{'\u2014'}</span>
                                    )}
                                </td>
                                <td className="p-3 text-gray-400">{video.views_count.toLocaleString()}</td>
                                <td className="p-3 text-gray-500 text-xs">
                                    {new Date(video.created_at).toLocaleDateString()}
                                </td>
                            </tr>
                        ))}
                        {videos.length === 0 && (
                            <tr>
                                <td colSpan={10} className="p-8 text-center text-gray-500">
                                    Видео не найдены
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
