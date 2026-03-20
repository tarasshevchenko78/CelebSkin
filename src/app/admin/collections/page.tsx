'use client';

import { useState, useEffect, useCallback } from 'react';

interface Collection {
    id: number;
    title: { en?: string; ru?: string; [key: string]: string | undefined };
    slug: string;
    cover_url: string | null;
    videos_count: number;
    is_auto: boolean;
    featured: boolean;
    sort_order: number;
}

function CollectionRow({ coll, onSave }: { coll: Collection; onSave: (id: number, data: Partial<Collection>) => Promise<void> }) {
    const [coverUrl, setCoverUrl] = useState(coll.cover_url || '');
    const [featured, setFeatured] = useState(coll.featured);
    const [sortOrder, setSortOrder] = useState(coll.sort_order);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [previewUrl, setPreviewUrl] = useState(coll.cover_url || '');

    const dirty =
        coverUrl !== (coll.cover_url || '') ||
        featured !== coll.featured ||
        sortOrder !== coll.sort_order;

    const handleSave = async () => {
        setSaving(true);
        await onSave(coll.id, { cover_url: coverUrl || null, featured, sort_order: sortOrder });
        setSaved(true);
        setSaving(false);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex gap-4">
                {/* Cover preview */}
                <div className="w-28 h-20 rounded-lg overflow-hidden bg-gray-800 shrink-0 border border-gray-700">
                    {previewUrl ? (
                        <img
                            src={previewUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={() => setPreviewUrl('')}
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs text-center px-2">
                            нет обложки
                        </div>
                    )}
                </div>

                {/* Info + fields */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                            <p className="text-sm font-semibold text-white truncate">
                                {coll.title?.ru || coll.title?.en || coll.slug}
                            </p>
                            <p className="text-xs text-gray-500 font-mono">{coll.slug}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${coll.is_auto ? 'bg-blue-900/40 text-blue-400' : 'bg-purple-900/40 text-purple-400'}`}>
                                {coll.is_auto ? 'авто' : 'ручная'}
                            </span>
                            <span className="text-xs text-gray-500">{coll.videos_count} видео</span>
                        </div>
                    </div>

                    {/* Cover URL input */}
                    <div className="flex gap-2 mb-2">
                        <input
                            type="text"
                            value={coverUrl}
                            onChange={e => setCoverUrl(e.target.value)}
                            onBlur={() => setPreviewUrl(coverUrl)}
                            placeholder="URL обложки (CDN)"
                            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-yellow-600/60 min-w-0"
                        />
                        <button
                            onClick={() => setPreviewUrl(coverUrl)}
                            className="px-2 py-1.5 rounded-lg bg-gray-700 text-xs text-gray-300 hover:bg-gray-600 transition-colors"
                        >
                            ▶
                        </button>
                    </div>

                    {/* Controls row */}
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={featured}
                                onChange={e => setFeatured(e.target.checked)}
                                className="w-3.5 h-3.5 accent-yellow-500"
                            />
                            <span className="text-xs text-gray-400">На главной</span>
                        </label>
                        <label className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-500">Порядок</span>
                            <input
                                type="number"
                                value={sortOrder}
                                onChange={e => setSortOrder(Number(e.target.value))}
                                className="w-14 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-yellow-600/60"
                            />
                        </label>
                        <div className="ml-auto">
                            {dirty ? (
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="px-3 py-1.5 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-black text-xs font-semibold transition-colors disabled:opacity-50"
                                >
                                    {saving ? '...' : 'Сохранить'}
                                </button>
                            ) : saved ? (
                                <span className="text-xs text-green-400">✓ Сохранено</span>
                            ) : (
                                <span className="text-xs text-gray-600">—</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function AdminCollectionsPage() {
    const [collections, setCollections] = useState<Collection[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState<'all' | 'auto' | 'manual'>('all');

    const load = useCallback(async () => {
        const res = await fetch('/api/admin/collections');
        if (res.ok) setCollections(await res.json());
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleSave = async (id: number, data: Partial<Collection>) => {
        await fetch('/api/admin/collections', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, ...data }),
        });
        setCollections(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
    };

    const handleRefreshCovers = async () => {
        setRefreshing(true);
        await fetch('/api/admin/collections/refresh-covers', { method: 'POST' });
        await load();
        setRefreshing(false);
    };

    const filtered = collections.filter(c =>
        filter === 'all' ? true : filter === 'auto' ? c.is_auto : !c.is_auto
    );

    if (loading) {
        return <div className="text-gray-500 text-sm p-8">Загрузка...</div>;
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-white">Коллекции</h1>
                    <p className="text-sm text-gray-500 mt-0.5">{collections.length} коллекций</p>
                </div>
                <button
                    onClick={handleRefreshCovers}
                    disabled={refreshing}
                    className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 transition-colors disabled:opacity-50"
                >
                    {refreshing ? 'Обновление...' : '↻ Авто-обложки'}
                </button>
            </div>

            {/* Filter */}
            <div className="flex gap-2 mb-4">
                {(['all', 'auto', 'manual'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f ? 'bg-yellow-600 text-black' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
                    >
                        {f === 'all' ? 'Все' : f === 'auto' ? 'Авто (тег)' : 'Ручные'}
                    </button>
                ))}
            </div>

            <div className="space-y-3">
                {filtered.map(c => (
                    <CollectionRow key={c.id} coll={c} onSave={handleSave} />
                ))}
            </div>
        </div>
    );
}
