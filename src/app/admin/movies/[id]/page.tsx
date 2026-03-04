'use client';

import { useState, useEffect, useCallback } from 'react';
import LocalizedTabs from '@/components/admin/LocalizedTabs';
import { getLocalizedField } from '@/lib/i18n';
import type { LocalizedField } from '@/lib/types';

interface MovieData {
    id: number;
    title: string;
    title_localized: LocalizedField;
    slug: string;
    year: number | null;
    poster_url: string | null;
    description: LocalizedField;
    studio: string | null;
    director: string | null;
    genres: string[];
    tmdb_id: number | null;
    imdb_id: string | null;
    scenes_count: number;
    total_views: number;
    created_at: string;
}

interface SceneRef {
    id: string;
    title: LocalizedField;
    status: string;
    thumbnail_url: string | null;
    views_count: number;
    duration_formatted: string | null;
    ai_confidence: number | null;
    scene_number: number | null;
}

interface CastRef {
    id: number;
    name: string;
    photo_url: string | null;
    role: string | null;
}

export default function AdminMovieDetailPage({ params }: { params: { id: string } }) {
    const [movie, setMovie] = useState<MovieData | null>(null);
    const [scenes, setScenes] = useState<SceneRef[]>([]);
    const [cast, setCast] = useState<CastRef[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const [title, setTitle] = useState('');
    const [titleLocalized, setTitleLocalized] = useState<LocalizedField>({});
    const [description, setDescription] = useState<LocalizedField>({});
    const [year, setYear] = useState('');
    const [posterUrl, setPosterUrl] = useState('');
    const [studio, setStudio] = useState('');
    const [director, setDirector] = useState('');
    const [posterImgError, setPosterImgError] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [sceneThumbErrors, setSceneThumbErrors] = useState<Set<string>>(new Set());
    const [castPhotoErrors, setCastPhotoErrors] = useState<Set<number>>(new Set());

    const fetchData = useCallback(async () => {
        try {
            const res = await fetch(`/api/admin/movies/${params.id}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            setMovie(data.movie);
            setScenes(data.scenes);
            setCast(data.celebrities);
            setTitle(data.movie.title);
            setTitleLocalized(data.movie.title_localized || {});
            setDescription(data.movie.description || {});
            setYear(data.movie.year?.toString() || '');
            setPosterUrl(data.movie.poster_url || '');
            setPosterImgError(false);
            setStudio(data.movie.studio || '');
            setDirector(data.movie.director || '');
        } catch {
            setMessage({ type: 'error', text: 'Failed to load movie' });
        } finally {
            setLoading(false);
        }
    }, [params.id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const save = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch(`/api/admin/movies/${params.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title, title_localized: titleLocalized, description,
                    year: year ? parseInt(year) : null,
                    poster_url: posterUrl || null,
                    studio: studio || null,
                    director: director || null,
                }),
            });
            if (!res.ok) throw new Error('Save failed');
            setMessage({ type: 'success', text: 'Saved!' });
        } catch {
            setMessage({ type: 'error', text: 'Save failed' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400" /></div>;
    }

    if (!movie) {
        return <div className="py-20 text-center"><p className="text-gray-400">Movie not found</p><a href="/admin/movies" className="text-purple-400 hover:underline text-sm">Back</a></div>;
    }

    return (
        <div className="max-w-5xl space-y-6">
            <div className="flex items-center gap-3">
                <a href="/admin/movies" className="text-gray-400 hover:text-white text-sm">← Movies</a>
                <h1 className="text-xl font-bold text-white">{movie.title} {movie.year && <span className="text-gray-400">({movie.year})</span>}</h1>
            </div>

            {message && (
                <div className={`rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-red-900/30 text-red-400 border border-red-800'}`}>
                    {message.text}
                </div>
            )}

            {/* Poster + Metadata */}
            <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-6">
                <div className="space-y-3">
                    {posterUrl && !posterImgError ? (
                        <img src={posterUrl} alt="" className="w-full aspect-[2/3] rounded-lg object-cover border border-gray-700"
                            onError={() => setPosterImgError(true)} />
                    ) : (
                        <div className="w-full aspect-[2/3] rounded-lg bg-gray-800 flex items-center justify-center text-gray-600 border border-gray-700">No poster</div>
                    )}
                    <input value={posterUrl} onChange={(e) => setPosterUrl(e.target.value)}
                        placeholder="Poster URL..."
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200" />
                    <label className={`block w-full text-center text-xs px-2 py-1.5 rounded cursor-pointer transition-colors ${
                        uploading ? 'bg-gray-700 text-gray-500' : 'bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 border border-purple-800/50'
                    }`}>
                        {uploading ? 'Uploading...' : 'Upload Poster'}
                        <input type="file" accept="image/*" className="hidden" disabled={uploading}
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file || !movie) return;
                                setUploading(true);
                                setMessage(null);
                                try {
                                    const fd = new FormData();
                                    fd.append('file', file);
                                    fd.append('type', 'movie');
                                    fd.append('id', String(movie.id));
                                    fd.append('slug', movie.slug);
                                    const res = await fetch('/api/admin/upload', { method: 'POST', body: fd });
                                    const data = await res.json();
                                    if (res.ok) {
                                        setPosterUrl(data.url);
                                        setPosterImgError(false);
                                        setMessage({ type: 'success', text: `Poster uploaded: ${data.url}` });
                                    } else {
                                        setMessage({ type: 'error', text: data.error });
                                    }
                                } catch (err) {
                                    setMessage({ type: 'error', text: `Upload failed: ${err}` });
                                } finally {
                                    setUploading(false);
                                    e.target.value = '';
                                }
                            }} />
                    </label>
                </div>

                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 space-y-3">
                    <div>
                        <label className="text-xs text-gray-500 block mb-1">Title</label>
                        <input value={title} onChange={(e) => setTitle(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-gray-500 block mb-1">Year</label>
                            <input value={year} onChange={(e) => setYear(e.target.value)} type="number"
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500" />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 block mb-1">Studio</label>
                            <input value={studio} onChange={(e) => setStudio(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500" />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-gray-500 block mb-1">Director</label>
                        <input value={director} onChange={(e) => setDirector(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                        <div><span className="text-gray-500">TMDB ID</span><span className="block text-gray-300">{movie.tmdb_id || '—'}</span></div>
                        <div><span className="text-gray-500">IMDb ID</span><span className="block text-gray-300">{movie.imdb_id || '—'}</span></div>
                        <div><span className="text-gray-500">Scenes</span><span className="block text-gray-300">{movie.scenes_count}</span></div>
                        <div><span className="text-gray-500">Views</span><span className="block text-gray-300">{movie.total_views.toLocaleString()}</span></div>
                    </div>
                    {movie.genres && movie.genres.length > 0 && (
                        <div>
                            <span className="text-xs text-gray-500">Genres</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {movie.genres.map((g) => (
                                    <span key={g} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{g}</span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <LocalizedTabs label="Title Localized" value={titleLocalized} onChange={setTitleLocalized} />
            <LocalizedTabs label="Description" value={description} onChange={setDescription} multiline />

            {/* Scenes */}
            {scenes.length > 0 && (
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <h3 className="text-sm font-medium text-gray-300 mb-3">Scenes ({scenes.length})</h3>
                    <div className="space-y-2">
                        {scenes.map((s) => (
                            <a key={s.id} href={`/admin/videos/${s.id}`}
                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-800 transition-colors">
                                <span className="text-xs text-gray-500 w-6 text-center shrink-0">#{s.scene_number || '—'}</span>
                                <div className="w-16 aspect-video rounded overflow-hidden bg-gray-800 shrink-0">
                                    {s.thumbnail_url && !sceneThumbErrors.has(s.id) ? (
                                        <img src={s.thumbnail_url} alt="" className="w-full h-full object-cover"
                                            onError={() => setSceneThumbErrors(prev => new Set(prev).add(s.id))} />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">?</div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-200 truncate">{getLocalizedField(s.title, 'en') || 'Untitled'}</p>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                        s.status === 'published' ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'
                                    }`}>{s.status}</span>
                                </div>
                                <span className="text-xs text-gray-500 shrink-0">{s.views_count.toLocaleString()} views</span>
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* Cast */}
            {cast.length > 0 && (
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <h3 className="text-sm font-medium text-gray-300 mb-3">Cast ({cast.length})</h3>
                    <div className="flex flex-wrap gap-2">
                        {cast.map((c) => (
                            <a key={c.id} href={`/admin/celebrities/${c.id}`}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 hover:border-purple-600 transition-colors">
                                {c.photo_url && !castPhotoErrors.has(c.id) ? (
                                    <img src={c.photo_url} alt="" className="w-6 h-6 rounded-full object-cover"
                                        onError={() => setCastPhotoErrors(prev => new Set(prev).add(c.id))} />
                                ) : (
                                    <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-400">{c.name.charAt(0)}</div>
                                )}
                                <span className="text-xs text-gray-200">{c.name}</span>
                                {c.role && <span className="text-[10px] text-gray-500">as {c.role}</span>}
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* Save */}
            <div className="sticky bottom-4 flex justify-end">
                <button onClick={save} disabled={saving}
                    className="px-6 py-2.5 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-500 disabled:opacity-50 shadow-lg shadow-purple-900/50">
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
}
