'use client';

import { useState, useCallback } from 'react';

interface VideoData {
    id: string;
    title: Record<string, string>;
    slug: Record<string, string>;
    review: Record<string, string>;
    seo_title: Record<string, string>;
    seo_description: Record<string, string>;
    original_title: string;
    quality: string;
    duration_seconds: number;
    duration_formatted: string;
    video_url: string;
    video_url_watermarked: string;
    thumbnail_url: string;
    preview_gif_url: string;
    screenshots: string[] | null;
    sprite_url: string;
    ai_model: string;
    ai_confidence: number;
    ai_raw_response: unknown;
    enrichment_layers_used: string[];
    views_count: number;
    likes_count: number;
    dislikes_count: number;
    status: string;
    published_at: string | null;
    created_at: string;
    updated_at: string;
    raw_video_id: string;
}

interface Celebrity {
    id: number;
    name: string;
    photo_url?: string;
    slug?: string;
    role?: string;
}

interface Tag {
    id: number;
    name: string | Record<string, string>;
}

interface Category {
    id: number;
    name: string | Record<string, string>;
}

interface MovieScene {
    movie_id: number;
    movie_title: string;
    poster_url?: string;
    movie_tmdb_id?: number;
    scene_number?: number;
    scene_title?: string | Record<string, string>;
}

interface Props {
    video: VideoData;
    celebrities: Celebrity[];
    tags: Tag[];
    categories: Category[];
    movieScene: MovieScene | null;
    allTags: Tag[];
    allCategories: Category[];
}

const LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];
const LOCALE_NAMES: Record<string, string> = {
    en: 'English', ru: 'Русский', de: 'Deutsch', fr: 'Français',
    es: 'Español', pt: 'Português', it: 'Italiano', pl: 'Polski',
    nl: 'Nederlands', tr: 'Türkçe',
};

const STATUSES = ['new', 'processing', 'enriched', 'auto_recognized', 'watermarked', 'needs_review', 'published', 'rejected'];

function getName(name: string | Record<string, string>): string {
    if (typeof name === 'string') return name;
    return name?.en || Object.values(name)[0] || '—';
}

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

export default function VideoEditor({ video, celebrities, tags, categories, movieScene, allTags, allCategories }: Props) {
    // Editable state
    const [editStatus, setEditStatus] = useState(video.status);
    const [editTitle, setEditTitle] = useState<Record<string, string>>(video.title || {});
    const [editSeoTitle, setEditSeoTitle] = useState<Record<string, string>>(video.seo_title || {});
    const [editSeoDesc, setEditSeoDesc] = useState<Record<string, string>>(video.seo_description || {});
    const [editReview, setEditReview] = useState<Record<string, string>>(video.review || {});
    const [editQuality, setEditQuality] = useState(video.quality || '');
    const [editCelebs, setEditCelebs] = useState<Celebrity[]>(celebrities);
    const [editTags, setEditTags] = useState<Tag[]>(tags);
    const [editCats, setEditCats] = useState<Category[]>(categories);

    // UI state
    const [activeLocale, setActiveLocale] = useState('en');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [showAiResponse, setShowAiResponse] = useState(false);
    const [celebSearch, setCelebSearch] = useState('');
    const [celebResults, setCelebResults] = useState<Celebrity[]>([]);
    const [showCelebSearch, setShowCelebSearch] = useState(false);

    const handleSave = useCallback(async () => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch(`/api/admin/videos/${video.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: editStatus,
                    title: editTitle,
                    seo_title: editSeoTitle,
                    seo_description: editSeoDesc,
                    review: editReview,
                    quality: editQuality,
                    celebrity_ids: editCelebs.map(c => c.id),
                    tag_ids: editTags.map(t => t.id),
                    category_ids: editCats.map(c => c.id),
                }),
            });
            if (res.ok) {
                setMessage({ type: 'success', text: 'Video saved successfully' });
            } else {
                const data = await res.json();
                setMessage({ type: 'error', text: data.error || 'Failed to save' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: `Error: ${err}` });
        } finally {
            setSaving(false);
        }
    }, [video.id, editStatus, editTitle, editSeoTitle, editSeoDesc, editReview, editQuality, editCelebs, editTags, editCats]);

    const handleStatusChange = async (newStatus: string) => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch(`/api/admin/videos/${video.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            if (res.ok) {
                setEditStatus(newStatus);
                setMessage({ type: 'success', text: `Status changed to ${newStatus}` });
            } else {
                const data = await res.json();
                setMessage({ type: 'error', text: data.error || 'Failed' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: `Error: ${err}` });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Delete this video permanently? This cannot be undone.')) return;
        try {
            const res = await fetch(`/api/admin/videos/${video.id}`, { method: 'DELETE' });
            if (res.ok) {
                window.location.href = '/admin/videos';
            } else {
                setMessage({ type: 'error', text: 'Failed to delete' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: `Error: ${err}` });
        }
    };

    const searchCelebrities = async (query: string) => {
        setCelebSearch(query);
        if (query.length < 2) { setCelebResults([]); return; }
        try {
            const res = await fetch(`/api/admin/celebrities?q=${encodeURIComponent(query)}&limit=10`);
            if (res.ok) {
                const data = await res.json();
                const existing = new Set(editCelebs.map(c => c.id));
                setCelebResults((data.data || []).filter((c: Celebrity) => !existing.has(c.id)));
            }
        } catch { /* ignore */ }
    };

    const videoSrc = video.video_url_watermarked || video.video_url;
    const confidence = video.ai_confidence ? (video.ai_confidence * 100).toFixed(0) : '0';
    const confidenceColor = Number(confidence) >= 80 ? 'text-green-400' : Number(confidence) >= 50 ? 'text-yellow-400' : 'text-red-400';

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center gap-3">
                <a href="/admin/videos" className="text-sm text-gray-400 hover:text-white">&larr; Videos</a>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[editStatus] || 'bg-gray-700 text-gray-300'}`}>
                    {editStatus}
                </span>
                <span className={`text-sm font-semibold ${confidenceColor}`}>AI: {confidence}%</span>
                <span className="text-xs text-gray-600 ml-auto">{video.id}</span>
            </div>

            {/* Message */}
            {message && (
                <div className={`rounded-lg p-3 text-sm ${
                    message.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-800'
                        : 'bg-red-900/30 text-red-400 border border-red-800'
                }`}>
                    {message.text}
                </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
                {editStatus !== 'published' && (
                    <button onClick={() => handleStatusChange('published')} disabled={saving}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-500 text-white disabled:opacity-50">
                        Publish
                    </button>
                )}
                {editStatus === 'published' && (
                    <button onClick={() => handleStatusChange('enriched')} disabled={saving}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white disabled:opacity-50">
                        Unpublish
                    </button>
                )}
                {editStatus !== 'rejected' && (
                    <button onClick={() => handleStatusChange('rejected')} disabled={saving}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50">
                        Reject
                    </button>
                )}
                <button onClick={handleDelete}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-red-700 text-red-400 hover:bg-red-900/30">
                    Delete
                </button>
                <button onClick={handleSave} disabled={saving}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 ml-auto">
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>

            {/* Video Preview + Info */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Video Player */}
                <div className="lg:col-span-2">
                    {videoSrc ? (
                        <video
                            controls
                            preload="metadata"
                            poster={video.thumbnail_url || undefined}
                            className="w-full rounded-xl border border-gray-800 bg-black aspect-video"
                        >
                            <source src={videoSrc} type="video/mp4" />
                        </video>
                    ) : (
                        <div className="w-full rounded-xl border border-gray-800 bg-gray-900 aspect-video flex items-center justify-center">
                            {video.thumbnail_url ? (
                                <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover rounded-xl" />
                            ) : (
                                <span className="text-gray-600 text-lg">No video file</span>
                            )}
                        </div>
                    )}
                    {/* Screenshots */}
                    {video.screenshots && video.screenshots.length > 0 && (
                        <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
                            {video.screenshots.map((url, i) => (
                                <img key={i} src={url} alt={`Screenshot ${i + 1}`}
                                    className="h-16 rounded border border-gray-700 flex-shrink-0" />
                            ))}
                        </div>
                    )}
                </div>

                {/* Side Info */}
                <div className="space-y-4">
                    <InfoCard label="Original Title" value={video.original_title || '—'} />
                    <InfoCard label="Duration" value={video.duration_formatted || `${video.duration_seconds || 0}s`} />
                    <InfoCard label="Views" value={String(video.views_count || 0)} />
                    <InfoCard label="AI Model" value={video.ai_model || '—'} />
                    <InfoCard label="Created" value={new Date(video.created_at).toLocaleString()} />
                    {video.published_at && (
                        <InfoCard label="Published" value={new Date(video.published_at).toLocaleString()} />
                    )}

                    {/* Status dropdown */}
                    <div>
                        <label className="text-xs text-gray-500 block mb-1">Status</label>
                        <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200">
                            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>

                    {/* Quality */}
                    <div>
                        <label className="text-xs text-gray-500 block mb-1">Quality</label>
                        <input value={editQuality} onChange={e => setEditQuality(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                            placeholder="e.g. 720p, 1080p" />
                    </div>

                    {/* Movie Scene */}
                    {movieScene && (
                        <div className="rounded-lg border border-gray-700 p-3">
                            <p className="text-xs text-gray-500 mb-1">Movie</p>
                            <div className="flex items-center gap-2">
                                {movieScene.poster_url && (
                                    <img src={movieScene.poster_url} alt="" className="w-8 h-12 rounded object-cover" />
                                )}
                                <div>
                                    <p className="text-sm text-gray-200">{movieScene.movie_title}</p>
                                    {movieScene.scene_title && (
                                        <p className="text-xs text-gray-500">
                                            {typeof movieScene.scene_title === 'object' ? getName(movieScene.scene_title) : movieScene.scene_title}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Celebrities */}
            <Section title="Celebrities">
                <div className="flex flex-wrap gap-2 mb-3">
                    {editCelebs.map(c => (
                        <span key={c.id} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-pink-900/30 text-pink-300 border border-pink-800/50">
                            {c.photo_url && <img src={c.photo_url} alt="" className="w-5 h-5 rounded-full object-cover" />}
                            {c.name}
                            <button onClick={() => setEditCelebs(editCelebs.filter(x => x.id !== c.id))}
                                className="ml-1 text-pink-500 hover:text-pink-300">&times;</button>
                        </span>
                    ))}
                    {editCelebs.length === 0 && <span className="text-sm text-gray-600">No celebrities linked</span>}
                </div>
                <div className="relative">
                    <input
                        value={celebSearch}
                        onChange={e => { searchCelebrities(e.target.value); setShowCelebSearch(true); }}
                        onFocus={() => setShowCelebSearch(true)}
                        placeholder="Search celebrities..."
                        className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                    />
                    {showCelebSearch && celebResults.length > 0 && (
                        <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg max-h-48 overflow-y-auto">
                            {celebResults.map(c => (
                                <button key={c.id}
                                    onClick={() => {
                                        setEditCelebs([...editCelebs, c]);
                                        setCelebSearch('');
                                        setCelebResults([]);
                                        setShowCelebSearch(false);
                                    }}
                                    className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2">
                                    {c.photo_url && <img src={c.photo_url} alt="" className="w-5 h-5 rounded-full object-cover" />}
                                    {c.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </Section>

            {/* Tags */}
            <Section title="Tags">
                <div className="flex flex-wrap gap-2 mb-3">
                    {editTags.map(t => (
                        <span key={t.id} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-blue-900/30 text-blue-300 border border-blue-800/50">
                            {getName(t.name)}
                            <button onClick={() => setEditTags(editTags.filter(x => x.id !== t.id))}
                                className="ml-1 text-blue-500 hover:text-blue-300">&times;</button>
                        </span>
                    ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {allTags.filter(t => !editTags.find(et => et.id === t.id)).map(t => (
                        <button key={t.id} onClick={() => setEditTags([...editTags, t])}
                            className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-700 border border-gray-700">
                            + {getName(t.name)}
                        </button>
                    ))}
                </div>
            </Section>

            {/* Categories */}
            <Section title="Categories">
                <div className="flex flex-wrap gap-2 mb-3">
                    {editCats.map(c => (
                        <span key={c.id} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-cyan-900/30 text-cyan-300 border border-cyan-800/50">
                            {getName(c.name)}
                            <button onClick={() => setEditCats(editCats.filter(x => x.id !== c.id))}
                                className="ml-1 text-cyan-500 hover:text-cyan-300">&times;</button>
                        </span>
                    ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {allCategories.filter(c => !editCats.find(ec => ec.id === c.id)).map(c => (
                        <button key={c.id} onClick={() => setEditCats([...editCats, c])}
                            className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-700 border border-gray-700">
                            + {getName(c.name)}
                        </button>
                    ))}
                </div>
            </Section>

            {/* Multilingual Content */}
            <Section title="Multilingual Content">
                <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
                    {LOCALES.map(loc => (
                        <button key={loc} onClick={() => setActiveLocale(loc)}
                            className={`text-xs px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                                activeLocale === loc
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}>
                            {LOCALE_NAMES[loc]}
                        </button>
                    ))}
                </div>

                <div className="space-y-4">
                    <LangField label="Title" value={editTitle[activeLocale] || ''}
                        onChange={v => setEditTitle({ ...editTitle, [activeLocale]: v })} />
                    <LangField label="SEO Title" value={editSeoTitle[activeLocale] || ''}
                        onChange={v => setEditSeoTitle({ ...editSeoTitle, [activeLocale]: v })} />
                    <LangField label="SEO Description" value={editSeoDesc[activeLocale] || ''}
                        onChange={v => setEditSeoDesc({ ...editSeoDesc, [activeLocale]: v })} multiline />
                    <LangField label="Review" value={editReview[activeLocale] || ''}
                        onChange={v => setEditReview({ ...editReview, [activeLocale]: v })} multiline />
                </div>
            </Section>

            {/* AI Info */}
            <Section title="AI Processing">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    <InfoCard label="Model" value={video.ai_model || '—'} />
                    <InfoCard label="Confidence" value={`${confidence}%`} />
                    <InfoCard label="Layers" value={(video.enrichment_layers_used || []).join(', ') || '—'} />
                    <InfoCard label="Raw Video ID" value={video.raw_video_id || '—'} small />
                </div>
                <button onClick={() => setShowAiResponse(!showAiResponse)}
                    className="text-xs text-gray-500 hover:text-gray-300">
                    {showAiResponse ? 'Hide' : 'Show'} AI Raw Response
                </button>
                {showAiResponse && (
                    <pre className="mt-2 p-3 text-xs text-gray-400 bg-gray-900 rounded-lg border border-gray-800 max-h-80 overflow-auto font-mono">
                        {JSON.stringify(video.ai_raw_response, null, 2)}
                    </pre>
                )}
            </Section>

            {/* URLs */}
            <Section title="Media URLs">
                <div className="space-y-2 text-xs">
                    <UrlRow label="Video (original)" url={video.video_url} />
                    <UrlRow label="Video (watermarked)" url={video.video_url_watermarked} />
                    <UrlRow label="Thumbnail" url={video.thumbnail_url} />
                    <UrlRow label="Preview GIF" url={video.preview_gif_url} />
                    <UrlRow label="Sprite" url={video.sprite_url} />
                </div>
            </Section>
        </div>
    );
}

// Helper components
function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3">{title}</h3>
            {children}
        </div>
    );
}

function InfoCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
    return (
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-2.5">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`mt-0.5 ${small ? 'text-xs text-gray-400 truncate' : 'text-sm text-gray-200'}`}>{value}</p>
        </div>
    );
}

function LangField({ label, value, onChange, multiline }: {
    label: string; value: string; onChange: (v: string) => void; multiline?: boolean;
}) {
    const cls = "w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:ring-1 focus:ring-purple-500 focus:border-purple-500";
    return (
        <div>
            <label className="text-xs text-gray-500 block mb-1">{label}</label>
            {multiline ? (
                <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} className={cls} />
            ) : (
                <input value={value} onChange={e => onChange(e.target.value)} className={cls} />
            )}
        </div>
    );
}

function UrlRow({ label, url }: { label: string; url?: string }) {
    if (!url) return (
        <div className="flex gap-2">
            <span className="text-gray-600 w-32 flex-shrink-0">{label}:</span>
            <span className="text-gray-700">—</span>
        </div>
    );
    return (
        <div className="flex gap-2">
            <span className="text-gray-500 w-32 flex-shrink-0">{label}:</span>
            <a href={url} target="_blank" rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 truncate">{url}</a>
        </div>
    );
}
