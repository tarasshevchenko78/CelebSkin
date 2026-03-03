'use client';

import { useState, useEffect, useCallback } from 'react';
import LocalizedTabs from '@/components/admin/LocalizedTabs';
import { getLocalizedField } from '@/lib/i18n';
import type { LocalizedField } from '@/lib/types';

interface CelebrityData {
    id: number;
    name: string;
    slug: string;
    name_localized: LocalizedField;
    bio: LocalizedField;
    photo_url: string | null;
    birth_date: string | null;
    nationality: string | null;
    tmdb_id: number | null;
    imdb_id: string | null;
    videos_count: number;
    movies_count: number;
    total_views: number;
    is_featured: boolean;
    ai_matched: boolean;
    created_at: string;
}

interface VideoRef {
    id: string;
    title: LocalizedField;
    status: string;
    thumbnail_url: string | null;
    ai_confidence: number | null;
    views_count: number;
    duration_formatted: string | null;
}

interface MovieRef {
    id: number;
    title: string;
    title_localized: LocalizedField;
    slug: string;
    year: number | null;
    poster_url: string | null;
}

export default function AdminCelebrityDetailPage({ params }: { params: { id: string } }) {
    const [celebrity, setCelebrity] = useState<CelebrityData | null>(null);
    const [videos, setVideos] = useState<VideoRef[]>([]);
    const [movies, setMovies] = useState<MovieRef[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const [name, setName] = useState('');
    const [nameLocalized, setNameLocalized] = useState<LocalizedField>({});
    const [bio, setBio] = useState<LocalizedField>({});
    const [photoUrl, setPhotoUrl] = useState('');
    const [isFeatured, setIsFeatured] = useState(false);
    const [photoImgError, setPhotoImgError] = useState(false);
    const [vidThumbErrors, setVidThumbErrors] = useState<Set<string>>(new Set());
    const [moviePosterErrors, setMoviePosterErrors] = useState<Set<number>>(new Set());

    const fetchData = useCallback(async () => {
        try {
            const res = await fetch(`/api/admin/celebrities/${params.id}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            setCelebrity(data.celebrity);
            setVideos(data.videos);
            setMovies(data.movies);
            setName(data.celebrity.name);
            setNameLocalized(data.celebrity.name_localized || {});
            setBio(data.celebrity.bio || {});
            setPhotoUrl(data.celebrity.photo_url || '');
            setPhotoImgError(false);
            setIsFeatured(data.celebrity.is_featured);
        } catch {
            setMessage({ type: 'error', text: 'Failed to load celebrity' });
        } finally {
            setLoading(false);
        }
    }, [params.id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const save = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch(`/api/admin/celebrities/${params.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, name_localized: nameLocalized, bio, photo_url: photoUrl || null, is_featured: isFeatured }),
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

    if (!celebrity) {
        return <div className="py-20 text-center"><p className="text-gray-400">Celebrity not found</p><a href="/admin/celebrities" className="text-purple-400 hover:underline text-sm">Back</a></div>;
    }

    return (
        <div className="max-w-5xl space-y-6">
            <div className="flex items-center gap-3">
                <a href="/admin/celebrities" className="text-gray-400 hover:text-white text-sm">← Celebrities</a>
                <h1 className="text-xl font-bold text-white">{celebrity.name}</h1>
            </div>

            {message && (
                <div className={`rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-red-900/30 text-red-400 border border-red-800'}`}>
                    {message.text}
                </div>
            )}

            {/* Photo + Metadata */}
            <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
                <div className="space-y-3">
                    {photoUrl && !photoImgError ? (
                        <img src={photoUrl} alt={celebrity.name} className="w-40 h-40 rounded-full object-cover mx-auto border-2 border-gray-700"
                            onError={() => setPhotoImgError(true)} />
                    ) : (
                        <div className="w-40 h-40 rounded-full bg-gray-800 mx-auto flex items-center justify-center text-3xl text-gray-500 border-2 border-gray-700">
                            {celebrity.name.charAt(0)}
                        </div>
                    )}
                    <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)}
                        placeholder="Photo URL..."
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200" />
                </div>

                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 space-y-3">
                    <div>
                        <label className="text-xs text-gray-500 block mb-1">Name</label>
                        <input value={name} onChange={(e) => setName(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                            <span className="text-gray-500">TMDB ID</span>
                            <span className="block text-gray-300">{celebrity.tmdb_id || '—'}</span>
                        </div>
                        <div>
                            <span className="text-gray-500">IMDb ID</span>
                            <span className="block text-gray-300">{celebrity.imdb_id || '—'}</span>
                        </div>
                        <div>
                            <span className="text-gray-500">Nationality</span>
                            <span className="block text-gray-300">{celebrity.nationality || '—'}</span>
                        </div>
                        <div>
                            <span className="text-gray-500">Birth Date</span>
                            <span className="block text-gray-300">{celebrity.birth_date || '—'}</span>
                        </div>
                        <div>
                            <span className="text-gray-500">Videos</span>
                            <span className="block text-gray-300">{celebrity.videos_count}</span>
                        </div>
                        <div>
                            <span className="text-gray-500">Total Views</span>
                            <span className="block text-gray-300">{celebrity.total_views.toLocaleString()}</span>
                        </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)}
                            className="rounded border-gray-600 bg-gray-800 text-purple-500" />
                        <span className="text-sm text-gray-300">Featured</span>
                    </label>
                </div>
            </div>

            <LocalizedTabs label="Bio" value={bio} onChange={setBio} multiline />
            <LocalizedTabs label="Name Localized" value={nameLocalized} onChange={setNameLocalized} />

            {/* Videos */}
            {videos.length > 0 && (
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <h3 className="text-sm font-medium text-gray-300 mb-3">Videos ({videos.length})</h3>
                    <div className="space-y-2">
                        {videos.map((v) => (
                            <a key={v.id} href={`/admin/videos/${v.id}`}
                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-800 transition-colors">
                                <div className="w-16 aspect-video rounded overflow-hidden bg-gray-800 shrink-0">
                                    {v.thumbnail_url && !vidThumbErrors.has(v.id) ? (
                                        <img src={v.thumbnail_url} alt="" className="w-full h-full object-cover"
                                            onError={() => setVidThumbErrors(prev => new Set(prev).add(v.id))} />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">?</div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-200 truncate">{getLocalizedField(v.title, 'en') || 'Untitled'}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                            v.status === 'published' ? 'bg-green-900/50 text-green-400' :
                                            v.status === 'needs_review' ? 'bg-yellow-900/50 text-yellow-400' :
                                            'bg-gray-800 text-gray-500'
                                        }`}>{v.status}</span>
                                        {v.ai_confidence !== null && (
                                            <span className="text-[10px] text-gray-500">{Math.round(v.ai_confidence * 100)}%</span>
                                        )}
                                    </div>
                                </div>
                                <span className="text-xs text-gray-500 shrink-0">{v.views_count.toLocaleString()} views</span>
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* Movies */}
            {movies.length > 0 && (
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <h3 className="text-sm font-medium text-gray-300 mb-3">Movies ({movies.length})</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {movies.map((m) => (
                            <a key={m.id} href={`/admin/movies/${m.id}`}
                                className="rounded-lg border border-gray-700 overflow-hidden hover:border-purple-600 transition-colors">
                                {m.poster_url && !moviePosterErrors.has(m.id) ? (
                                    <img src={m.poster_url} alt="" className="w-full aspect-[2/3] object-cover"
                                        onError={() => setMoviePosterErrors(prev => new Set(prev).add(m.id))} />
                                ) : (
                                    <div className="w-full aspect-[2/3] bg-gray-800 flex items-center justify-center text-gray-600 text-xs">No poster</div>
                                )}
                                <div className="p-2">
                                    <p className="text-xs text-gray-200 truncate">{m.title}</p>
                                    {m.year && <p className="text-[10px] text-gray-500">{m.year}</p>}
                                </div>
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
