'use client';

import { useState, useRef, useEffect } from 'react';

interface Props {
    type: 'video' | 'celebrity' | 'movie';
    id: string | number;
}

type State = 'idle' | 'loading' | 'success' | 'error';

interface DescriptionPreview {
    short:      string;
    detailed:   string;
    scene_type?: string;
    setting?:    string;
    mood?:       string;
}

const ACTIONS = [
    { key: 're-enrich',              label: '🔄 Обновить из TMDB' },
    { key: 're-translate',           label: '🌐 Перевести (10 яз.)' },
    { key: 'regenerate-description', label: '✨ AI Описание' },
] as const;

export default function ReEnrichButton({ type, id }: Props) {
    const [open, setOpen]           = useState(false);
    const [state, setState]         = useState<State>('idle');
    const [message, setMessage]     = useState('');
    const [preview, setPreview]     = useState<DescriptionPreview | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        function handler(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    async function run(action: string) {
        setOpen(false);
        setState('loading');
        setMessage('');
        setPreview(null);

        try {
            const res = await fetch('/api/admin/re-enrich', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, id, action }),
            });
            const data = await res.json();

            if (!res.ok || data.error) {
                setState('error');
                setMessage(data.error || 'Запрос не удался');
                // Don't auto-hide errors — let user read them
                return;
            }

            if (data.success === false) {
                setState('error');
                setMessage(data.message || 'Недоступно');
                return;
            }

            setState('success');

            // For regenerate-description: show preview, don't auto-reload
            if (action === 'regenerate-description' && data.description) {
                setMessage(`AI description generated (${data.languages_translated ?? 10} languages)`);
                setPreview(data.description as DescriptionPreview);
                return; // Don't auto-reload — user reviews first
            }

            setMessage(
                action === 're-translate'
                    ? `Updated ${data.languages_updated ?? '?'} languages`
                    : action === 're-enrich'
                    ? `Done${data.tmdb_id ? ` (TMDB #${data.tmdb_id})` : ''}`
                    : data.message || 'Done'
            );
            setTimeout(() => {
                setState('idle');
                window.location.reload();
            }, 1500);
        } catch {
            setState('error');
            setMessage('Ошибка сети (таймаут?)');
        }
    }

    function closePreview() {
        setPreview(null);
        setState('idle');
        window.location.reload();
    }

    function retryDescription() {
        setPreview(null);
        setState('idle');
        run('regenerate-description');
    }

    return (
        <div ref={ref} className="relative inline-block">
            {/* Main button */}
            <button
                onClick={() => {
                    if (state === 'idle') setOpen((o) => !o);
                    if (state === 'error') { setState('idle'); setMessage(''); }
                }}
                disabled={state === 'loading'}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    state === 'loading'
                        ? 'border-gray-700 bg-gray-800 text-gray-500 cursor-wait'
                        : state === 'success'
                        ? 'border-green-700 bg-green-900/30 text-green-400'
                        : state === 'error'
                        ? 'border-red-700 bg-red-900/30 text-red-400'
                        : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
            >
                {state === 'loading' && (
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                )}
                {state === 'success' && !preview && '✓'}
                {state === 'error'   && '✕'}
                <span>
                    {state === 'loading' ? 'Обработка…'
                     : state === 'success' && preview ? '✨ Предпросмотр'
                     : state === 'success' ? message
                     : state === 'error'   ? message
                     : 'Обогатить / Перевести'}
                </span>
                {state === 'idle' && (
                    <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                )}
            </button>

            {/* Dropdown */}
            {open && state === 'idle' && (
                <div className="absolute right-0 top-full z-20 mt-1 min-w-[220px] overflow-hidden rounded-lg border border-gray-700 bg-gray-800 shadow-xl">
                    {ACTIONS.map((a) => (
                        <button
                            key={a.key}
                            onClick={() => run(a.key)}
                            className="block w-full px-4 py-2.5 text-left text-sm text-gray-200 hover:bg-gray-700 transition-colors"
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Description Preview Card */}
            {preview && (
                <div className="absolute right-0 top-full z-30 mt-1 w-96 rounded-xl border border-purple-800/60 bg-gray-900 shadow-2xl">
                    <div className="border-b border-gray-800 px-4 py-3 flex items-center justify-between">
                        <span className="text-sm font-semibold text-purple-300">✨ AI Описание создано</span>
                        <span className="text-[10px] text-gray-600">Сохранено в БД · 10 языков</span>
                    </div>

                    <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
                        {/* Meta tags */}
                        {(preview.scene_type || preview.setting || preview.mood) && (
                            <div className="flex flex-wrap gap-1.5">
                                {preview.scene_type && (
                                    <span className="rounded-full bg-blue-900/40 px-2 py-0.5 text-[10px] text-blue-300">
                                        {preview.scene_type}
                                    </span>
                                )}
                                {preview.setting && (
                                    <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">
                                        {preview.setting}
                                    </span>
                                )}
                                {preview.mood && (
                                    <span className="rounded-full bg-purple-900/40 px-2 py-0.5 text-[10px] text-purple-300">
                                        {preview.mood}
                                    </span>
                                )}
                            </div>
                        )}

                        {/* Short description */}
                        {preview.short && (
                            <div>
                                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-600">Краткое</p>
                                <p className="text-xs text-gray-300 leading-relaxed">{preview.short}</p>
                            </div>
                        )}

                        {/* Detailed description */}
                        {preview.detailed && (
                            <div>
                                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-600">Подробное</p>
                                <p className="text-xs text-gray-400 leading-relaxed">{preview.detailed}</p>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-gray-800 px-4 py-3 flex gap-2">
                        <button
                            onClick={closePreview}
                            className="flex-1 rounded-lg bg-green-700/30 py-1.5 text-xs font-medium text-green-300 hover:bg-green-700/50 transition-colors"
                        >
                            Принять и обновить
                        </button>
                        <button
                            onClick={retryDescription}
                            className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
                        >
                            Повторить
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
