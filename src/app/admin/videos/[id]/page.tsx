'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import LocalizedTabs from '@/components/admin/LocalizedTabs';
import JsonViewer from '@/components/admin/JsonViewer';
import VideoPlayer from '@/components/VideoPlayer';
import { getLocalizedField } from '@/lib/i18n';
import type { LocalizedField } from '@/lib/types';

interface VideoData {
    id: string;
    title: LocalizedField;
    slug: LocalizedField;
    review: LocalizedField;
    seo_title: LocalizedField;
    seo_description: LocalizedField;
    original_title: string | null;
    quality: string | null;
    duration_seconds: number | null;
    duration_formatted: string | null;
    video_url: string | null;
    video_url_watermarked: string | null;
    thumbnail_url: string | null;
    preview_gif_url: string | null;
    screenshots: string[];
    ai_model: string | null;
    ai_confidence: number | null;
    ai_raw_response: Record<string, unknown> | null;
    views_count: number;
    likes_count: number;
    dislikes_count: number;
    status: string;
    published_at: string | null;
    created_at: string;
    updated_at: string;
}

interface CelebrityRef {
    id: number;
    name: string;
    slug: string;
    photo_url: string | null;
}

interface TagRef {
    id: number;
    name: string;
    name_localized: LocalizedField;
    slug: string;
}

interface CollectionRef {
    id: number;
    title: LocalizedField;
    slug: string;
    videos_count: number;
}

interface MovieRef {
    id: number;
    title: string;
    title_localized: LocalizedField;
    slug: string;
    year: number | null;
    poster_url: string | null;
    scene_number: number | null;
}

interface RawVideoData {
    id: string;
    source_url: string;
    raw_title: string | null;
    thumbnail_url: string | null;
    embed_code: string | null;
    raw_categories: string[] | null;
    raw_tags: string[] | null;
    raw_celebrities: string[] | null;
}

const STATUS_OPTIONS = [
    'new', 'processing', 'watermarked', 'enriched',
    'auto_recognized', 'needs_review', 'published', 'rejected',
];

export default function AdminVideoDetailPage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const [video, setVideo] = useState<VideoData | null>(null);
    const [celebrities, setCelebrities] = useState<CelebrityRef[]>([]);
    const [movie, setMovie] = useState<MovieRef | null>(null);
    const [rawVideo, setRawVideo] = useState<RawVideoData | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [editedTags, setEditedTags] = useState<TagRef[]>([]);
    const [allTags, setAllTags] = useState<TagRef[]>([]);
    const [showTagDropdown, setShowTagDropdown] = useState(false);

    // Add collections state
    const [editedCollections, setEditedCollections] = useState<CollectionRef[]>([]);
    const [allCollections, setAllCollections] = useState<CollectionRef[]>([]);
    const [showCollectionDropdown, setShowCollectionDropdown] = useState(false);

    const [celebImgErrors, setCelebImgErrors] = useState<Set<number>>(new Set());
    const [movieImgError, setMovieImgError] = useState(false);

    // Editable fields
    const [title, setTitle] = useState<LocalizedField>({});
    const [review, setReview] = useState<LocalizedField>({});
    const [seoTitle, setSeoTitle] = useState<LocalizedField>({});
    const [seoDesc, setSeoDesc] = useState<LocalizedField>({});
    const [status, setStatus] = useState('');

    const fetchData = useCallback(async () => {
        try {
            const res = await fetch(`/api/admin/videos/${params.id}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            setVideo(data.video);
            setCelebrities(data.celebrities);
            setEditedTags(data.tags);
            setEditedCollections(data.collections || []);
            setMovie(data.movie);
            setRawVideo(data.rawVideo);
            setTitle(data.video.title || {});
            setReview(data.video.review || {});
            setSeoTitle(data.video.seo_title || {});
            setSeoDesc(data.video.seo_description || {});
            setStatus(data.video.status);
        } catch (error) {
            console.error('Fetch error:', error);
            setMessage({ type: 'error', text: 'Failed to load video' });
        } finally {
            setLoading(false);
        }
    }, [params.id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    useEffect(() => {
        fetch('/api/admin/tags')
            .then(r => r.ok ? r.json() : [])
            .then(setAllTags)
            .catch(() => { });

        fetch('/api/admin/collections')
            .then(r => r.ok ? r.json() : [])
            .then(setAllCollections)
            .catch(() => { });
    }, []);

    const save = async (overrides?: Record<string, unknown>) => {
        setSaving(true);
        setMessage(null);
        try {
            const body = { title, review, seo_title: seoTitle, seo_description: seoDesc, status, tags: editedTags.map(t => t.id), collections: editedCollections.map(c => c.id), ...overrides };
            const res = await fetch(`/api/admin/videos/${params.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error('Save failed');
            const updated = await res.json();
            setVideo(updated);
            setStatus(updated.status);
            setMessage({ type: 'success', text: 'Saved!' });
        } catch {
            setMessage({ type: 'error', text: 'Save failed' });
        } finally {
            setSaving(false);
        }
    };

    const deleteVideo = async () => {
        if (!confirm('Delete this video permanently?')) return;
        try {
            await fetch(`/api/admin/videos/${params.id}`, { method: 'DELETE' });
            router.push('/admin/videos');
        } catch {
            setMessage({ type: 'error', text: 'Delete failed' });
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400" />
            </div>
        );
    }

    if (!video) {
        return (
            <div className="py-20 text-center">
                <p className="text-gray-400">Video not found</p>
                <a href="/admin/videos" className="text-purple-400 hover:underline text-sm mt-2 inline-block">Back to Videos</a>
            </div>
        );
    }

    const videoSrc = video.video_url_watermarked || video.video_url;
    const thumbSrc = video.thumbnail_url || rawVideo?.thumbnail_url;
    const confidence = video.ai_confidence ? Math.round(video.ai_confidence * 100) : null;

    return (
        <div className="max-w-5xl space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <a href="/admin/videos" className="text-gray-400 hover:text-white text-sm">← Videos</a>
                    <h1 className="text-xl font-bold text-white truncate max-w-md">
                        {getLocalizedField(video.title, 'en') || video.original_title || 'Untitled'}
                    </h1>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => save({ status: 'published' })} disabled={saving}
                        className="px-3 py-1.5 text-xs rounded-lg bg-green-700 text-white hover:bg-green-600 disabled:opacity-50">
                        Publish
                    </button>
                    <button onClick={() => save({ status: 'rejected' })} disabled={saving}
                        className="px-3 py-1.5 text-xs rounded-lg bg-yellow-700 text-white hover:bg-yellow-600 disabled:opacity-50">
                        Reject
                    </button>
                    <button onClick={deleteVideo}
                        className="px-3 py-1.5 text-xs rounded-lg bg-red-700 text-white hover:bg-red-600">
                        Delete
                    </button>
                </div>
            </div>

            {/* Status message */}
            {message && (
                <div className={`rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-red-900/30 text-red-400 border border-red-800'
                    }`}>
                    {message.text}
                </div>
            )}

            {/* Video Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                    {videoSrc ? (
                        <VideoPlayer src={videoSrc} poster={thumbSrc} title={getLocalizedField(video.title, 'en')} />
                    ) : thumbSrc ? (
                        <div className="aspect-video rounded-xl overflow-hidden bg-gray-900">
                            <img src={thumbSrc} alt="" className="w-full h-full object-cover" />
                        </div>
                    ) : (
                        <div className="aspect-video rounded-xl bg-gray-900 flex items-center justify-center text-gray-500">
                            No preview available
                        </div>
                    )}
                    {/* Embed from source */}
                    {rawVideo?.embed_code && !videoSrc && (
                        <div className="mt-3">
                            <p className="text-xs text-gray-500 mb-1">Source embed:</p>
                            <div
                                className="aspect-video rounded-lg overflow-hidden bg-black"
                                dangerouslySetInnerHTML={{ __html: rawVideo.embed_code }}
                            />
                        </div>
                    )}
                </div>

                {/* Status & Metadata */}
                <div className="space-y-3">
                    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500">Status</span>
                            <select value={status} onChange={(e) => setStatus(e.target.value)}
                                className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200">
                                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        {confidence !== null && (
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs text-gray-500">AI Confidence</span>
                                    <span className={`text-xs font-medium ${confidence > 80 ? 'text-green-400' : confidence > 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                                        {confidence}%
                                    </span>
                                </div>
                                <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${confidence > 80 ? 'bg-green-500' : confidence > 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                        style={{ width: `${confidence}%` }} />
                                </div>
                            </div>
                        )}
                        {video.ai_model && (
                            <div className="flex justify-between">
                                <span className="text-xs text-gray-500">AI Model</span>
                                <span className="text-xs text-gray-300">{video.ai_model}</span>
                            </div>
                        )}
                        <div className="flex justify-between">
                            <span className="text-xs text-gray-500">Quality</span>
                            <span className="text-xs text-gray-300">{video.quality || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-xs text-gray-500">Duration</span>
                            <span className="text-xs text-gray-300">{video.duration_formatted || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-xs text-gray-500">Views</span>
                            <span className="text-xs text-gray-300">{video.views_count.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-xs text-gray-500">Created</span>
                            <span className="text-xs text-gray-300">{new Date(video.created_at).toLocaleDateString()}</span>
                        </div>
                        {video.published_at && (
                            <div className="flex justify-between">
                                <span className="text-xs text-gray-500">Published</span>
                                <span className="text-xs text-gray-300">{new Date(video.published_at).toLocaleDateString()}</span>
                            </div>
                        )}
                        {rawVideo?.source_url && (
                            <div>
                                <span className="text-xs text-gray-500 block mb-1">Source URL</span>
                                <a href={rawVideo.source_url} target="_blank" rel="noopener noreferrer"
                                    className="text-xs text-purple-400 hover:underline break-all">{rawVideo.source_url}</a>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* AI Raw Response */}
            <JsonViewer data={video.ai_raw_response} />

            {/* Editable Content */}
            <LocalizedTabs label="Title" value={title} onChange={setTitle} />
            <LocalizedTabs label="Review" value={review} onChange={setReview} multiline />
            <LocalizedTabs label="SEO Title" value={seoTitle} onChange={setSeoTitle} />
            <LocalizedTabs label="SEO Description" value={seoDesc} onChange={setSeoDesc} multiline />
            <LocalizedTabs label="Slug (read-only)" value={video.slug || {}} onChange={() => { }} readOnly />

            {/* Relations */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Коллекции</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                    {editedCollections.map((c) => (
                        <span key={c.id} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-red-900/20 text-red-300 border border-red-800/40">
                            {getLocalizedField(c.title, 'ru') || c.slug}
                            <button onClick={() => setEditedCollections(editedCollections.filter(x => x.id !== c.id))}
                                className="ml-1 text-red-500 hover:text-red-300">&times;</button>
                        </span>
                    ))}
                    {editedCollections.length === 0 && <span className="text-xs text-gray-600">Коллекции отсутствуют</span>}
                </div>
                <div className="relative">
                    <button
                        onClick={() => setShowCollectionDropdown(!showCollectionDropdown)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700 border border-gray-700"
                    >
                        + Добавить коллекцию
                    </button>
                    {showCollectionDropdown && (
                        <div className="absolute z-10 bottom-full mb-1 left-0 bg-gray-800 border border-gray-700 rounded-lg max-h-48 overflow-y-auto min-w-[200px] shadow-xl">
                            {allCollections
                                .filter(c => !editedCollections.find(ec => ec.id === c.id))
                                .map(c => (
                                    <button key={c.id}
                                        onClick={() => {
                                            setEditedCollections([...editedCollections, c]);
                                            setShowCollectionDropdown(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-gray-700"
                                    >
                                        {getLocalizedField(c.title, 'ru') || c.slug}
                                    </button>
                                ))}
                            {allCollections.filter(c => !editedCollections.find(ec => ec.id === c.id)).length === 0 && (
                                <div className="px-3 py-2 text-xs text-gray-500">Больше коллекций нет</div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {celebrities.length > 0 && (
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <h3 className="text-sm font-medium text-gray-300 mb-3">Celebrities</h3>
                    <div className="flex flex-wrap gap-2">
                        {celebrities.map((c) => (
                            <a key={c.id} href={`/admin/celebrities/${c.id}`}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 hover:border-purple-600 transition-colors">
                                {c.photo_url && !celebImgErrors.has(c.id) ? (
                                    <img src={c.photo_url} alt="" className="w-6 h-6 rounded-full object-cover"
                                        onError={() => setCelebImgErrors(prev => new Set(prev).add(c.id))} />
                                ) : (
                                    <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-400">
                                        {c.name.charAt(0)}
                                    </div>
                                )}
                                <span className="text-xs text-gray-200">{c.name}</span>
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {movie && (
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                    <h3 className="text-sm font-medium text-gray-300 mb-3">Movie</h3>
                    <a href={`/admin/movies/${movie.id}`}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 hover:border-purple-600 transition-colors w-fit">
                        {movie.poster_url && !movieImgError ? (
                            <img src={movie.poster_url} alt="" className="w-8 h-12 rounded object-cover"
                                onError={() => setMovieImgError(true)} />
                        ) : (
                            <div className="w-8 h-12 rounded bg-gray-700 flex items-center justify-center text-xs text-gray-500">?</div>
                        )}
                        <div>
                            <span className="text-sm text-gray-200">{movie.title}</span>
                            {movie.year && <span className="text-xs text-gray-500 ml-2">({movie.year})</span>}
                        </div>
                    </a>
                </div>
            )}

            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Tags</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                    {editedTags.map((t) => (
                        <span key={t.id} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-blue-900/30 text-blue-300 border border-blue-800/50">
                            {typeof t.name === 'string' ? t.name : getLocalizedField(t.name_localized, 'en')}
                            <button onClick={() => setEditedTags(editedTags.filter(x => x.id !== t.id))}
                                className="ml-1 text-blue-500 hover:text-blue-300">&times;</button>
                        </span>
                    ))}
                    {editedTags.length === 0 && <span className="text-xs text-gray-600">No tags</span>}
                </div>
                <div className="relative">
                    <button
                        onClick={() => setShowTagDropdown(!showTagDropdown)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700 border border-gray-700"
                    >
                        + Add tag
                    </button>
                    {showTagDropdown && (
                        <div className="absolute z-10 top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg max-h-48 overflow-y-auto min-w-[200px] shadow-xl">
                            {allTags
                                .filter(t => !editedTags.find(et => et.id === t.id))
                                .map(t => (
                                    <button key={t.id}
                                        onClick={() => {
                                            setEditedTags([...editedTags, t]);
                                            setShowTagDropdown(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-gray-700"
                                    >
                                        {typeof t.name === 'string' ? t.name : getLocalizedField(t.name_localized, 'en')}
                                    </button>
                                ))}
                            {allTags.filter(t => !editedTags.find(et => et.id === t.id)).length === 0 && (
                                <div className="px-3 py-2 text-xs text-gray-500">No more tags available</div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Raw video data */}
            {rawVideo && (
                <JsonViewer
                    data={{
                        raw_title: rawVideo.raw_title,
                        raw_categories: rawVideo.raw_categories,
                        raw_tags: rawVideo.raw_tags,
                        raw_celebrities: rawVideo.raw_celebrities,
                        source_url: rawVideo.source_url,
                    } as Record<string, unknown>}
                    label="Raw Scraped Data"
                />
            )}

            {/* Save button */}
            <div className="sticky bottom-4 flex justify-end">
                <button onClick={() => save()} disabled={saving}
                    className="px-6 py-2.5 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-500 disabled:opacity-50 shadow-lg shadow-purple-900/50 transition-all">
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
}
