'use client';

import { useState, useEffect, useCallback } from 'react';

interface RecognitionActor {
    name: string | null;
    description: string;
    confidence: number;
    tmdb_id?: number;
    profile_path?: string;
}

interface RecognitionData {
    success: boolean;
    confidence: number;
    movie: {
        tmdb_id: number;
        title: string;
        year: string;
        poster_path: string;
        confidence: number;
    } | null;
    actors: RecognitionActor[];
    suggested_cast: {
        tmdb_id: number;
        name: string;
        character: string;
        profile_path: string;
        gender: number;
    }[] | null;
    gemini_raw: {
        movie_title: string | null;
        movie_title_alternatives: string[];
        movie_year: number | null;
        movie_confidence: number;
        actors: { name: string | null; description: string; confidence: number }[];
        visible_text: string[];
        studio_logo: string | null;
        genre: string;
        era: string;
        reasoning: string;
    };
    visible_text: string[];
    genre: string | null;
    era: string | null;
    studio_logo: string | null;
}

interface Video {
    id: string;
    title: Record<string, string>;
    original_title: string;
    status: string;
    thumbnail_url: string | null;
    screenshots: string[] | null;
    ai_confidence: number | null;
    ai_model: string | null;
    duration_formatted: string | null;
    created_at: string;
    recognition_data: RecognitionData | null;
    recognition_method: string | null;
}

function getLocalizedField(obj: Record<string, string> | null, locale: string): string {
    if (!obj) return '';
    return obj[locale] || obj['en'] || Object.values(obj)[0] || '';
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
    const pct = Math.round(confidence * 100);
    const color = confidence > 0.8 ? 'text-green-400 bg-green-900/50 border-green-800'
        : confidence > 0.5 ? 'text-yellow-400 bg-yellow-900/50 border-yellow-800'
        : 'text-red-400 bg-red-900/50 border-red-800';
    return <span className={`px-2 py-0.5 text-xs rounded-full border ${color}`}>{pct}%</span>;
}

function VideoModerationCard({
    video,
    onApprove,
    onReject,
    onReanalyze,
}: {
    video: Video;
    onApprove: (videoId: string, movieTitle?: string, actorName?: string) => void;
    onReject: (videoId: string) => void;
    onReanalyze: (videoId: string) => void;
}) {
    const [manualMode, setManualMode] = useState(false);
    const [manualMovie, setManualMovie] = useState('');
    const [manualActor, setManualActor] = useState('');
    const rd = video.recognition_data;
    const gemini = rd?.gemini_raw;

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            {/* Header */}
            <div className="flex items-start gap-4 mb-3">
                {/* Thumbnail */}
                <div className="w-40 aspect-video rounded-lg overflow-hidden bg-gray-800 shrink-0">
                    {video.thumbnail_url ? (
                        <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            </svg>
                        </div>
                    )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-white truncate">
                        {getLocalizedField(video.title, 'en') || video.original_title || 'Без названия'}
                    </h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span className={`px-2 py-0.5 rounded-full ${
                            video.status === 'needs_review' ? 'bg-yellow-900/50 text-yellow-400' :
                            video.status === 'unknown_with_suggestions' ? 'bg-orange-900/50 text-orange-400' :
                            video.status === 'enriched' ? 'bg-blue-900/50 text-blue-400' :
                            'bg-gray-800 text-gray-400'
                        }`}>
                            {video.status}
                        </span>
                        {video.recognition_method && (
                            <span className="px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-400">
                                {video.recognition_method}
                            </span>
                        )}
                        {video.duration_formatted && <span>{video.duration_formatted}</span>}
                        <span>{new Date(video.created_at).toLocaleDateString()}</span>
                    </div>
                    {video.ai_confidence !== null && (
                        <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs text-gray-500">Точность AI:</span>
                            <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full ${
                                        video.ai_confidence > 0.8 ? 'bg-green-500' :
                                        video.ai_confidence > 0.5 ? 'bg-yellow-500' : 'bg-red-500'
                                    }`}
                                    style={{ width: `${(video.ai_confidence * 100).toFixed(0)}%` }}
                                />
                            </div>
                            <span className="text-xs text-gray-400">{(video.ai_confidence * 100).toFixed(0)}%</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Screenshots row */}
            {video.screenshots && video.screenshots.length > 0 && (
                <div className="flex gap-1 mb-3 overflow-x-auto">
                    {(video.screenshots as string[]).slice(0, 6).map((url, i) => (
                        <img key={i} src={url} alt={`Frame ${i + 1}`}
                             className="h-16 rounded border border-gray-700 object-cover shrink-0" />
                    ))}
                </div>
            )}

            {/* Gemini Vision Suggestions */}
            {rd && gemini && (
                <div className="border-t border-gray-800 pt-3 mt-3 space-y-3">
                    {/* Movie suggestions */}
                    {gemini.movie_title && (
                        <div>
                            <h4 className="text-xs font-medium text-gray-400 mb-1.5">Предложения фильмов/шоу:</h4>
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 text-sm">
                                    <ConfidenceBadge confidence={gemini.movie_confidence} />
                                    <span className="text-white">{gemini.movie_title}</span>
                                    {gemini.movie_year && <span className="text-gray-500">({gemini.movie_year})</span>}
                                    {rd.movie?.tmdb_id && <span className="text-xs text-green-500">Подтверждено TMDB</span>}
                                    <button
                                        onClick={() => onApprove(video.id, gemini.movie_title!, rd.actors?.[0]?.name || undefined)}
                                        className="ml-auto px-2 py-0.5 text-xs rounded bg-green-900/50 text-green-400 border border-green-800 hover:bg-green-900"
                                    >
                                        Одобрить
                                    </button>
                                </div>
                                {gemini.movie_title_alternatives?.map((alt, i) => (
                                    <div key={i} className="flex items-center gap-2 text-sm pl-4">
                                        <span className="text-gray-400">{alt}</span>
                                        <button
                                            onClick={() => onApprove(video.id, alt, rd.actors?.[0]?.name || undefined)}
                                            className="ml-auto px-2 py-0.5 text-xs rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
                                        >
                                            Выбрать
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Actor suggestions */}
                    {gemini.actors && gemini.actors.length > 0 && (
                        <div>
                            <h4 className="text-xs font-medium text-gray-400 mb-1.5">Возможные актрисы:</h4>
                            <div className="space-y-1">
                                {gemini.actors.map((actor, i) => (
                                    <div key={i} className="flex items-center gap-2 text-sm">
                                        <ConfidenceBadge confidence={actor.confidence} />
                                        {actor.name ? (
                                            <span className="text-white">{actor.name}</span>
                                        ) : (
                                            <span className="text-gray-400 italic">{actor.description}</span>
                                        )}
                                        {rd.actors?.[i]?.tmdb_id && (
                                            <span className="text-xs text-green-500">Подтверждено TMDB</span>
                                        )}
                                        {actor.name && (
                                            <button
                                                onClick={() => onApprove(video.id, gemini.movie_title || undefined, actor.name!)}
                                                className="ml-auto px-2 py-0.5 text-xs rounded bg-green-900/50 text-green-400 border border-green-800 hover:bg-green-900"
                                            >
                                                Одобрить
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Suggested cast from TMDB */}
                    {rd.suggested_cast && rd.suggested_cast.length > 0 && (
                        <div>
                            <h4 className="text-xs font-medium text-gray-400 mb-1.5">Актёрский состав TMDB (выберите):</h4>
                            <div className="flex gap-2 flex-wrap">
                                {rd.suggested_cast.map((cast, i) => (
                                    <button
                                        key={i}
                                        onClick={() => onApprove(video.id, gemini.movie_title || undefined, cast.name)}
                                        className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
                                    >
                                        {cast.profile_path && (
                                            <img
                                                src={`https://image.tmdb.org/t/p/w45${cast.profile_path}`}
                                                alt="" className="w-5 h-5 rounded-full object-cover"
                                            />
                                        )}
                                        <span>{cast.name}</span>
                                        <span className="text-gray-500">в роли {cast.character}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Visible text (OCR) */}
                    {gemini.visible_text && gemini.visible_text.length > 0 && (
                        <div className="text-xs text-gray-500">
                            Видимый текст: {gemini.visible_text.map((t, i) => (
                                <span key={i} className="bg-gray-800 px-1.5 py-0.5 rounded mr-1">{t}</span>
                            ))}
                        </div>
                    )}

                    {/* Reasoning */}
                    {gemini.reasoning && (
                        <p className="text-xs text-gray-600 italic">{gemini.reasoning}</p>
                    )}
                </div>
            )}

            {/* Manual entry */}
            {manualMode && (
                <div className="border-t border-gray-800 pt-3 mt-3 space-y-2">
                    <input
                        value={manualMovie}
                        onChange={(e) => setManualMovie(e.target.value)}
                        placeholder="Название фильма..."
                        className="w-full px-3 py-1.5 text-sm rounded bg-gray-800 text-white border border-gray-700 focus:border-blue-600 outline-none"
                    />
                    <input
                        value={manualActor}
                        onChange={(e) => setManualActor(e.target.value)}
                        placeholder="Имя актрисы..."
                        className="w-full px-3 py-1.5 text-sm rounded bg-gray-800 text-white border border-gray-700 focus:border-blue-600 outline-none"
                    />
                    <div className="flex gap-2">
                        <button
                            onClick={() => { onApprove(video.id, manualMovie || undefined, manualActor || undefined); setManualMode(false); }}
                            className="px-3 py-1.5 text-xs rounded bg-green-900/50 text-green-400 border border-green-800 hover:bg-green-900"
                        >
                            Сохранить
                        </button>
                        <button
                            onClick={() => setManualMode(false)}
                            className="px-3 py-1.5 text-xs rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
                        >
                            Отмена
                        </button>
                    </div>
                </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 mt-3 pt-3 border-t border-gray-800">
                {!manualMode && (
                    <button
                        onClick={() => setManualMode(true)}
                        className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700"
                    >
                        Ручной ввод
                    </button>
                )}
                <button
                    onClick={() => onReanalyze(video.id)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-blue-900/50 text-blue-400 border border-blue-800 hover:bg-blue-900"
                >
                    Переанализировать
                </button>
                <button
                    onClick={() => onApprove(video.id)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-green-900/50 text-green-400 border border-green-800 hover:bg-green-900"
                >
                    Одобрить как есть
                </button>
                <button
                    onClick={() => onReject(video.id)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-red-900/50 text-red-400 border border-red-800 hover:bg-red-900"
                >
                    Отклонить
                </button>
            </div>
        </div>
    );
}

export default function AdminModerationPage() {
    const [videos, setVideos] = useState<Video[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const limit = 20;

    const fetchVideos = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/moderation?page=${page}&limit=${limit}`);
            const data = await res.json();
            setVideos(data.videos || []);
            setTotal(data.total || 0);
        } catch (err) {
            console.error('Failed to load videos:', err);
        } finally {
            setLoading(false);
        }
    }, [page]);

    useEffect(() => { fetchVideos(); }, [fetchVideos]);

    const totalPages = Math.ceil(total / limit);

    async function handleApprove(videoId: string, movieTitle?: string, actorName?: string) {
        try {
            await fetch('/api/admin/moderation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId, action: 'approve', movieTitle, actorName }),
            });
            setVideos(prev => prev.filter(v => v.id !== videoId));
            setTotal(prev => prev - 1);
        } catch (err) {
            console.error('Approve failed:', err);
        }
    }

    async function handleReject(videoId: string) {
        try {
            await fetch('/api/admin/moderation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId, action: 'reject' }),
            });
            setVideos(prev => prev.filter(v => v.id !== videoId));
            setTotal(prev => prev - 1);
        } catch (err) {
            console.error('Reject failed:', err);
        }
    }

    async function handleReanalyze(videoId: string) {
        try {
            await fetch('/api/admin/moderation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId, action: 'reanalyze' }),
            });
            // Mark as processing in local state
            setVideos(prev => prev.map(v =>
                v.id === videoId ? { ...v, status: 'processing' } : v
            ));
        } catch (err) {
            console.error('Reanalyze failed:', err);
        }
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-white">Очередь модерации ({total})</h1>
                <button
                    onClick={fetchVideos}
                    className="px-3 py-1.5 text-sm rounded-lg bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700"
                >
                    Обновить                </button>
            </div>

            {loading ? (
                <div className="text-center py-12 text-gray-500">Загрузка...</div>
            ) : total === 0 ? (
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-12 text-center">
                    <svg className="w-12 h-12 text-green-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-gray-400">Всё проверено! Нет видео на модерации.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {videos.map((video) => (
                        <VideoModerationCard
                            key={video.id}
                            video={video}
                            onApprove={handleApprove}
                            onReject={handleReject}
                            onReanalyze={handleReanalyze}
                        />
                    ))}
                </div>
            )}

            {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-3">
                    {page > 1 && (
                        <button onClick={() => setPage(page - 1)}
                                className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            Назад
                        </button>
                    )}
                    <span className="text-sm text-gray-500">Стр. {page} / {totalPages}</span>
                    {page < totalPages && (
                        <button onClick={() => setPage(page + 1)}
                                className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                            Далее
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
