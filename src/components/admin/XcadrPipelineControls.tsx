'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
    stats: Record<string, number>;
}

type Step = 'parse' | 'translate' | 'match' | 'map-tags' | 'download';
type RunState = Step | 'all' | null;
type LogStatus = 'running' | 'success' | 'error';

interface LogEntry {
    id: number;
    timestamp: string;
    step: string;
    label: string;
    status: LogStatus;
    output: string | null;
    stderr: string | null;
    exitCode: number | null;
    duration: number | null;
}

let logIdCounter = 0;

function nowTs() {
    return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(ms: number) {
    if (ms < 1000) return `${ms}мс`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}с`;
    return `${Math.floor(ms / 60000)}м ${Math.round((ms % 60000) / 1000)}с`;
}

// ── Spinner icon ─────────────────────────────────────────────────────────────
function Spinner() {
    return (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
    );
}

// ── Single log entry ──────────────────────────────────────────────────────────
function LogItem({ entry }: { entry: LogEntry }) {
    const isError = entry.status === 'error';
    const isRunning = entry.status === 'running';

    const statusColor = isRunning
        ? 'text-blue-400'
        : isError
            ? 'text-red-400'
            : 'text-green-400';

    const statusIcon = isRunning ? '⟳' : isError ? '✗' : '✓';
    const hasDetails = entry.output || entry.stderr || entry.exitCode != null;

    return (
        <div className={`border-l-2 pl-3 py-1 ${isError ? 'border-red-600' : isRunning ? 'border-blue-600' : 'border-green-700'}`}>
            <div className="flex items-center gap-2 text-[11px]">
                <span className="text-gray-600 shrink-0 w-16">{entry.timestamp}</span>
                <span className={`shrink-0 font-bold ${statusColor}`}>{statusIcon}</span>
                <span className="text-gray-300 font-medium">{entry.label}</span>
                {entry.duration != null && (
                    <span className="text-gray-600 ml-auto shrink-0">{fmtDuration(entry.duration)}</span>
                )}
                {isRunning && <span className="text-blue-400 ml-auto shrink-0 animate-pulse">выполняется...</span>}
            </div>

            {hasDetails && (
                <details open={isError} className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-gray-600 hover:text-gray-400 select-none pl-1">
                        {isError ? 'Подробности ошибки' : 'Вывод'}
                    </summary>
                    <div className="mt-1 space-y-1">
                        {entry.exitCode != null && (
                            <div className="text-[10px] text-red-400 pl-1">
                                Exit code: {entry.exitCode}
                            </div>
                        )}
                        {entry.output && (
                            <pre className="max-h-40 overflow-y-auto rounded bg-black/40 p-2 text-[10px] leading-relaxed text-gray-400 whitespace-pre-wrap break-all">
                                {entry.output}
                            </pre>
                        )}
                        {entry.stderr && entry.stderr !== entry.output && (
                            <div>
                                <div className="text-[10px] text-red-500 pl-1 mb-0.5">stderr:</div>
                                <pre className="max-h-32 overflow-y-auto rounded bg-black/40 p-2 text-[10px] leading-relaxed text-red-300/80 whitespace-pre-wrap break-all">
                                    {entry.stderr}
                                </pre>
                            </div>
                        )}
                    </div>
                </details>
            )}
        </div>
    );
}

export default function XcadrPipelineControls({ stats }: Props) {
    const router = useRouter();

    const [running, setRunning]   = useState<RunState>(null);
    const [logs, setLogs]         = useState<LogEntry[]>([]);
    const logContainerRef         = useRef<HTMLDivElement>(null);

    // Parse form state
    const [parsePages, setParsePages] = useState(3);
    const [parseUrl, setParseUrl]     = useState('');
    const [parseCeleb, setParseCeleb] = useState('');
    const [parseColl, setParseColl]   = useState('');
    const [showParseForm, setShowParseForm] = useState(false);

    // Limit inputs
    const [translateLimit, setTranslateLimit] = useState(50);
    const [matchLimit, setMatchLimit]         = useState(50);
    const [downloadLimit, setDownloadLimit]   = useState(5);

    // Auto-scroll log panel
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    const addLog = useCallback((step: string, label: string): number => {
        const id = ++logIdCounter;
        const entry: LogEntry = {
            id,
            timestamp: nowTs(),
            step,
            label,
            status: 'running',
            output: null,
            stderr: null,
            exitCode: null,
            duration: null,
        };
        setLogs(prev => [...prev, entry]);
        return id;
    }, []);

    const updateLog = useCallback((id: number, patch: Partial<LogEntry>) => {
        setLogs(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    }, []);

    async function runStep(step: Step, options?: Record<string, unknown>, labelOverride?: string) {
        const stepLabels: Record<Step, string> = {
            parse:     `Разбор (${options?.pages ?? parsePages} стр.)`,
            translate: `Перевод (лимит ${options?.limit ?? translateLimit})`,
            match:     `Сопоставление (лимит ${options?.limit ?? matchLimit})`,
            'map-tags': 'Маппинг тегов',
            download:  `Загрузка (лимит ${options?.limit ?? downloadLimit})`,
        };
        const label = labelOverride ?? stepLabels[step];

        setRunning(step);
        const id = addLog(step, label);

        try {
            const res = await fetch('/api/admin/xcadr/pipeline', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ step, options }),
            });
            const data = await res.json();

            if (data.success) {
                updateLog(id, {
                    status: 'success',
                    output: data.output || null,
                    duration: data.duration ?? null,
                });
                router.refresh();
            } else {
                updateLog(id, {
                    status: 'error',
                    output: data.output || data.error || null,
                    stderr: data.stderr || null,
                    exitCode: data.exitCode ?? null,
                    duration: data.duration ?? null,
                });
            }
        } catch (err) {
            updateLog(id, {
                status: 'error',
                output: err instanceof Error ? err.message : String(err),
            });
        } finally {
            setRunning(null);
        }
    }

    async function runAll() {
        const steps: Array<{ step: Step; options?: Record<string, unknown>; label: string }> = [
            { step: 'parse',     options: { pages: parsePages },       label: `Разбор (${parsePages} стр.)` },
            { step: 'translate', options: { limit: translateLimit },   label: `Перевод (лимит ${translateLimit})` },
            { step: 'match',     options: { limit: matchLimit },       label: `Сопоставление (лимит ${matchLimit})` },
            { step: 'map-tags',                                         label: 'Маппинг тегов' },
        ];

        setRunning('all');

        for (let i = 0; i < steps.length; i++) {
            const { step, options, label } = steps[i];
            const stepLabel = `[${i + 1}/${steps.length}] ${label}`;
            const id = addLog(step, stepLabel);

            try {
                const res = await fetch('/api/admin/xcadr/pipeline', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ step, options }),
                });
                const data = await res.json();

                if (data.success) {
                    updateLog(id, {
                        status: 'success',
                        output: data.output || null,
                        duration: data.duration ?? null,
                    });
                } else {
                    updateLog(id, {
                        status: 'error',
                        output: data.output || data.error || null,
                        stderr: data.stderr || null,
                        exitCode: data.exitCode ?? null,
                        duration: data.duration ?? null,
                    });
                    break;
                }
            } catch (err) {
                updateLog(id, {
                    status: 'error',
                    output: err instanceof Error ? err.message : String(err),
                });
                break;
            }
        }

        setRunning(null);
        router.refresh();
    }

    const busy = running !== null;

    // Queue status hints
    const hints: Array<{ color: string; text: string }> = [];
    if (stats.parsed > 0)
        hints.push({ color: 'text-yellow-400', text: `⏳ ${stats.parsed} ждут перевода → нажмите «Перевести»` });
    if (stats.translated > 0)
        hints.push({ color: 'text-green-400', text: `⏳ ${stats.translated} ждут сопоставления → нажмите «Сопоставить»` });
    if (stats.matched > 0)
        hints.push({ color: 'text-red-400', text: `⏳ ${stats.matched} совпавших ждут загрузки → нажмите «Скачать и обработать»` });

    return (
        <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-semibold text-white">Управление пайплайном</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Запуск шагов импорта xcadr</p>
                </div>
            </div>

            {/* ── Queue hints ── */}
            {hints.length > 0 && (
                <div className="mb-3 space-y-1">
                    {hints.map((h, i) => (
                        <div key={i} className={`text-[11px] font-medium ${h.color}`}>{h.text}</div>
                    ))}
                </div>
            )}

            {/* ── Step buttons ── */}
            <div className="flex flex-wrap gap-3">

                {/* 1. Parse */}
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => runStep('parse', { pages: parsePages })}
                            disabled={busy || showParseForm}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-700/40 px-3 py-1.5 text-xs font-medium text-blue-200 hover:bg-blue-700/60 disabled:opacity-50 transition-colors"
                        >
                            {running === 'parse' ? <Spinner /> : null}
                            Разобрать {parsePages} стр.
                        </button>
                        <button
                            onClick={() => setShowParseForm(!showParseForm)}
                            disabled={busy}
                            className="rounded-lg bg-gray-800 px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 disabled:opacity-50 transition-colors"
                            title="Advanced parse options"
                        >
                            ⚙
                        </button>
                    </div>

                    {showParseForm && (
                        <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 space-y-2 min-w-[260px]">
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] text-gray-500 w-20 shrink-0">Страниц</label>
                                <input
                                    type="number"
                                    value={parsePages}
                                    min={1}
                                    max={20}
                                    onChange={(e) => setParsePages(Math.max(1, parseInt(e.target.value) || 1))}
                                    className="w-16 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] text-gray-500 w-20 shrink-0">URL видео</label>
                                <input
                                    type="text"
                                    value={parseUrl}
                                    onChange={(e) => setParseUrl(e.target.value)}
                                    placeholder="https://xcadr.online/videos/..."
                                    className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 placeholder-gray-600"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] text-gray-500 w-20 shrink-0">URL актрисы</label>
                                <input
                                    type="text"
                                    value={parseCeleb}
                                    onChange={(e) => setParseCeleb(e.target.value)}
                                    placeholder="https://xcadr.online/celebs/..."
                                    className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 placeholder-gray-600"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] text-gray-500 w-20 shrink-0">Коллекция</label>
                                <input
                                    type="text"
                                    value={parseColl}
                                    onChange={(e) => setParseColl(e.target.value)}
                                    placeholder="https://xcadr.online/podborki/..."
                                    className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 placeholder-gray-600"
                                />
                            </div>
                            <button
                                onClick={() => {
                                    const opts: Record<string, unknown> = {};
                                    if (parseUrl)        opts.url = parseUrl;
                                    else if (parseCeleb) opts.celebUrl = parseCeleb;
                                    else if (parseColl)  opts.collectionUrl = parseColl;
                                    else                 opts.pages = parsePages;
                                    setShowParseForm(false);
                                    runStep('parse', opts);
                                }}
                                disabled={busy}
                                className="w-full rounded bg-blue-700/50 py-1.5 text-xs font-medium text-blue-200 hover:bg-blue-700/70 disabled:opacity-50 transition-colors"
                            >
                                Запустить разбор
                            </button>
                        </div>
                    )}
                </div>

                {/* 2. Translate */}
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => runStep('translate', { limit: translateLimit })}
                            disabled={busy}
                            className="flex items-center gap-1.5 rounded-lg bg-yellow-700/40 px-3 py-1.5 text-xs font-medium text-yellow-200 hover:bg-yellow-700/60 disabled:opacity-50 transition-colors"
                        >
                            {running === 'translate' ? <Spinner /> : null}
                            Перевести
                            {stats.parsed > 0 && (
                                <span className="rounded-full bg-yellow-600/50 px-1.5 text-[10px]">{stats.parsed}</span>
                            )}
                        </button>
                        <input
                            type="number"
                            value={translateLimit}
                            min={1}
                            max={500}
                            onChange={(e) => setTranslateLimit(Math.max(1, parseInt(e.target.value) || 50))}
                            disabled={busy}
                            title="Limit"
                            className="w-14 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-gray-300 disabled:opacity-50"
                        />
                    </div>
                </div>

                {/* 3. Match */}
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => runStep('match', { limit: matchLimit })}
                            disabled={busy}
                            className="flex items-center gap-1.5 rounded-lg bg-green-700/40 px-3 py-1.5 text-xs font-medium text-green-200 hover:bg-green-700/60 disabled:opacity-50 transition-colors"
                        >
                            {running === 'match' ? <Spinner /> : null}
                            Сопоставить
                            {stats.translated > 0 && (
                                <span className="rounded-full bg-green-600/50 px-1.5 text-[10px]">{stats.translated}</span>
                            )}
                        </button>
                        <input
                            type="number"
                            value={matchLimit}
                            min={1}
                            max={500}
                            onChange={(e) => setMatchLimit(Math.max(1, parseInt(e.target.value) || 50))}
                            disabled={busy}
                            title="Limit"
                            className="w-14 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-gray-300 disabled:opacity-50"
                        />
                    </div>
                </div>

                {/* 4. Map Tags */}
                <button
                    onClick={() => runStep('map-tags')}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg bg-purple-700/40 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-700/60 disabled:opacity-50 transition-colors"
                >
                    {running === 'map-tags' ? <Spinner /> : null}
                    Маппинг тегов
                </button>

                {/* 5. Download & Process */}
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => runStep('download', { limit: downloadLimit })}
                            disabled={busy}
                            className="flex items-center gap-1.5 rounded-lg bg-red-700/50 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-700/70 disabled:opacity-50 transition-colors"
                        >
                            {running === 'download' ? <Spinner /> : null}
                            Скачать и обработать
                            {stats.matched > 0 && (
                                <span className="rounded-full bg-red-600/50 px-1.5 text-[10px]">{stats.matched}</span>
                            )}
                        </button>
                        <input
                            type="number"
                            value={downloadLimit}
                            min={1}
                            max={50}
                            onChange={(e) => setDownloadLimit(Math.max(1, parseInt(e.target.value) || 5))}
                            disabled={busy}
                            title="Videos to download"
                            className="w-14 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-gray-300 disabled:opacity-50"
                        />
                    </div>
                </div>

                {/* Run All */}
                <button
                    onClick={runAll}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg bg-gray-700/70 px-4 py-1.5 text-xs font-semibold text-white hover:bg-gray-600/70 disabled:opacity-50 transition-colors ml-auto"
                >
                    {running === 'all' ? <Spinner /> : null}
                    {running === 'all' ? 'Выполняется...' : 'Запустить всё'}
                </button>
            </div>

            {/* ── Persistent log panel ── */}
            {logs.length > 0 && (
                <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-gray-500">Лог выполнения</span>
                        <button
                            onClick={() => setLogs([])}
                            className="text-[10px] text-gray-700 hover:text-gray-400 transition-colors"
                        >
                            Очистить
                        </button>
                    </div>
                    <div
                        ref={logContainerRef}
                        className="max-h-72 overflow-y-auto rounded-lg border border-gray-800 bg-black/50 p-3 space-y-2"
                    >
                        {logs.map(entry => (
                            <LogItem key={entry.id} entry={entry} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
