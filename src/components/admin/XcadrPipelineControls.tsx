'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
    stats: Record<string, number>;
}

type Step = 'parse' | 'translate' | 'match' | 'map-tags' | 'download';
type RunState = Step | 'all' | 'run-all' | null;
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

interface StepProgress {
    step: string;
    status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
    current: number;
    total: number;
    item?: string;
    substep?: string;
    error?: string;
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

const STEP_LABELS: Record<string, string> = {
    'parse': 'Разбор',
    'translate': 'Перевод',
    'match': 'Сопоставление',
    'map-tags': 'Маппинг тегов',
    'import': 'Импорт',
    'download': 'Загрузка',
    'ai': 'AI Vision',
    'publish': 'Публикация',
};

const STEP_COLORS: Record<string, string> = {
    'parse': 'bg-blue-500',
    'translate': 'bg-yellow-500',
    'match': 'bg-green-500',
    'map-tags': 'bg-purple-500',
    'import': 'bg-cyan-500',
    'download': 'bg-red-500',
    'ai': 'bg-orange-500',
    'publish': 'bg-emerald-500',
};

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

// ── Progress Bar ─────────────────────────────────────────────────────────────
function ProgressBar({ progress }: { progress: StepProgress }) {
    const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    const color = STEP_COLORS[progress.step] || 'bg-gray-500';
    const label = STEP_LABELS[progress.step] || progress.step;

    const statusIcon = progress.status === 'running' ? '⟳' :
        progress.status === 'done' ? '✓' :
        progress.status === 'error' ? '✗' :
        progress.status === 'skipped' ? '—' : '○';

    const statusColor = progress.status === 'running' ? 'text-blue-400' :
        progress.status === 'done' ? 'text-green-400' :
        progress.status === 'error' ? 'text-red-400' :
        'text-gray-600';

    return (
        <div className="flex items-center gap-2 py-1">
            <span className={`w-4 text-center text-xs font-bold ${statusColor}`}>{statusIcon}</span>
            <span className="w-28 text-xs font-medium text-gray-300 shrink-0">{label}</span>
            <div className="flex-1 h-4 bg-gray-800 rounded-full overflow-hidden relative">
                <div
                    className={`h-full ${color} transition-all duration-300 ease-out rounded-full`}
                    style={{ width: `${progress.status === 'done' ? 100 : pct}%` }}
                />
                {progress.status === 'running' && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-white drop-shadow-sm">
                            {progress.total > 0 ? `${progress.current}/${progress.total}` : '...'}
                        </span>
                    </div>
                )}
                {progress.status === 'done' && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-white drop-shadow-sm">100%</span>
                    </div>
                )}
            </div>
            <span className="w-10 text-right text-[10px] text-gray-500">
                {progress.status === 'done' ? '100%' : progress.status === 'running' ? `${pct}%` : ''}
            </span>
            {progress.item && progress.status === 'running' && (
                <span className="text-[10px] text-gray-500 truncate max-w-[200px]" title={progress.item}>
                    {progress.item}
                </span>
            )}
            {progress.substep && progress.status === 'running' && (
                <span className="text-[10px] text-blue-400/60 shrink-0">
                    [{progress.substep}]
                </span>
            )}
            {progress.error && (
                <span className="text-[10px] text-red-400 truncate max-w-[200px]" title={progress.error}>
                    {progress.error}
                </span>
            )}
        </div>
    );
}

// ── Single log entry ──────────────────────────────────────────────────────────
function LogItem({ entry }: { entry: LogEntry }) {
    const isError = entry.status === 'error';
    const isRunning = entry.status === 'running';

    const statusColor = isRunning ? 'text-blue-400' : isError ? 'text-red-400' : 'text-green-400';
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
                            <div className="text-[10px] text-red-400 pl-1">Exit code: {entry.exitCode}</div>
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

const ALL_STEPS = ['parse', 'translate', 'match', 'map-tags', 'import', 'download', 'ai', 'publish'];

export default function XcadrPipelineControls({ stats }: Props) {
    const router = useRouter();

    const [running, setRunning]   = useState<RunState>(null);
    const [connectionStatus, setConnectionStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
    const [logs, setLogs]         = useState<LogEntry[]>([]);
    const logContainerRef         = useRef<HTMLDivElement>(null);

    // Progress bars state
    const [stepProgress, setStepProgress] = useState<Record<string, StepProgress>>({});
    const [showProgress, setShowProgress] = useState(false);
    const [streamOutput, setStreamOutput] = useState<string[]>([]);

    // Parse form state
    const [parsePages, setParsePages] = useState(3);
    const [parseUrl, setParseUrl]     = useState('');
    const [parseCeleb, setParseCeleb] = useState('');
    const [parseColl, setParseColl]   = useState('');
    const [showParseForm, setShowParseForm] = useState(false);

    // Categories
    const [categories, setCategories] = useState<Array<{ name: string; url: string; count: number | null }>>([]);
    const [loadingCategories, setLoadingCategories] = useState(false);

    // Limits
    const [translateLimit, setTranslateLimit] = useState(50);
    const [matchLimit, setMatchLimit]         = useState(50);
    const [downloadLimit, setDownloadLimit]   = useState(5);

    // Run-all options
    const [autoImport, setAutoImport] = useState(true);
    const [autoDownload, setAutoDownload] = useState(false);
    const [autoAi, setAutoAi] = useState(false);
    const [autoPublish, setAutoPublish] = useState(false);

    // Auto-scroll
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs, streamOutput]);

    const addLog = useCallback((step: string, label: string): number => {
        const id = ++logIdCounter;
        setLogs(prev => [...prev, {
            id, timestamp: nowTs(), step, label,
            status: 'running', output: null, stderr: null, exitCode: null, duration: null,
        }]);
        return id;
    }, []);

    const updateLog = useCallback((id: number, patch: Partial<LogEntry>) => {
        setLogs(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    }, []);

    // ── Stream-based execution (for run-all and individual steps) ──
    async function runStreaming(step: string, options: Record<string, unknown>, label: string) {
        setRunning(step as RunState);
        setShowProgress(true);
        setStreamOutput([]);

        // Initialize progress bars
        const initialProgress: Record<string, StepProgress> = {};
        if (step === 'run-all') {
            for (const s of ALL_STEPS) {
                initialProgress[s] = { step: s, status: 'pending', current: 0, total: 0 };
            }
        } else {
            initialProgress[step] = { step, status: 'running', current: 0, total: 0 };
        }
        setStepProgress(initialProgress);

        const logId = addLog(step, label);
        const startedAt = Date.now();

        try {
            const res = await fetch('/api/admin/xcadr/pipeline', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ step, stream: true, options }),
            });

            if (!res.ok || !res.body) {
                const data = await res.json().catch(() => ({ error: 'Unknown error' }));
                updateLog(logId, {
                    status: 'error',
                    output: data.output || data.error || 'Failed to start stream',
                    duration: Date.now() - startedAt,
                });
                setRunning(null);
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const outputLines: string[] = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.substring(6);
                    try {
                        const event = JSON.parse(jsonStr);

                        if (event.type === 'progress') {
                            setStepProgress(prev => ({
                                ...prev,
                                [event.step]: {
                                    step: event.step,
                                    status: event.status || 'running',
                                    current: event.current ?? prev[event.step]?.current ?? 0,
                                    total: event.total ?? prev[event.step]?.total ?? 0,
                                    item: event.item,
                                    substep: event.substep,
                                    error: event.error,
                                },
                            }));
                        } else if (event.type === 'log') {
                            outputLines.push(event.text);
                            setStreamOutput([...outputLines].slice(-100));
                        } else if (event.type === 'stderr') {
                            outputLines.push(`[stderr] ${event.text}`);
                            setStreamOutput([...outputLines].slice(-100));
                        } else if (event.type === 'done') {
                            const duration = Date.now() - startedAt;
                            const success = event.exitCode === 0;
                            updateLog(logId, {
                                status: success ? 'success' : 'error',
                                output: outputLines.slice(-50).join('\n'),
                                exitCode: event.exitCode,
                                duration,
                            });
                        } else if (event.type === 'error') {
                            updateLog(logId, {
                                status: 'error',
                                output: event.message,
                                duration: Date.now() - startedAt,
                            });
                        }
                    } catch {
                        // skip invalid JSON
                    }
                }
            }
        } catch (err) {
            updateLog(logId, {
                status: 'error',
                output: err instanceof Error ? err.message : String(err),
                duration: Date.now() - startedAt,
            });
        } finally {
            setRunning(null);
            router.refresh();
        }
    }

    // ── Non-streaming step execution (backwards compatible) ──
    async function runStep(step: Step, options?: Record<string, unknown>, labelOverride?: string) {
        const stepLabels: Record<Step, string> = {
            parse:     `Разбор (${options?.pages ?? parsePages} стр.)`,
            translate: `Перевод (лимит ${options?.limit ?? translateLimit})`,
            match:     `Сопоставление (лимит ${options?.limit ?? matchLimit})`,
            'map-tags': 'Маппинг тегов',
            download:  `Загрузка (лимит ${options?.limit ?? downloadLimit})`,
        };
        const label = labelOverride ?? stepLabels[step];

        // Use streaming for download (long-running)
        if (step === 'download') {
            return runStreaming(step, options || { limit: downloadLimit }, label);
        }

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
                updateLog(id, { status: 'success', output: data.output || null, duration: data.duration ?? null });
                router.refresh();
            } else {
                updateLog(id, {
                    status: 'error', output: data.output || data.error || null,
                    stderr: data.stderr || null, exitCode: data.exitCode ?? null, duration: data.duration ?? null,
                });
            }
        } catch (err) {
            updateLog(id, { status: 'error', output: err instanceof Error ? err.message : String(err) });
        } finally {
            setRunning(null);
        }
    }

    // ── Run All with streaming ──
    async function runAll() {
        const opts: Record<string, unknown> = {
            parsePages,
            translateLimit,
            matchLimit,
            downloadLimit,
            autoImport,
            autoDownload,
            autoAi,
            autoPublish,
        };

        const enabledSteps: string[] = ['parse', 'translate', 'match', 'map-tags'];
        if (autoImport) enabledSteps.push('import');
        if (autoDownload) enabledSteps.push('download');
        if (autoAi) enabledSteps.push('ai');
        if (autoPublish) enabledSteps.push('publish');

        const label = `Полный пайплайн (${enabledSteps.length} шагов)`;
        await runStreaming('run-all', opts, label);
    }

    const busy = running !== null;

    // Queue status hints
    const hints: Array<{ color: string; text: string }> = [];
    if (stats.parsed > 0)
        hints.push({ color: 'text-yellow-400', text: `${stats.parsed} ждут перевода` });
    if (stats.translated > 0)
        hints.push({ color: 'text-green-400', text: `${stats.translated} ждут сопоставления` });
    if (stats.matched > 0)
        hints.push({ color: 'text-red-400', text: `${stats.matched} совпавших ждут загрузки` });

    // Active progress steps
    const activeProgressSteps = Object.values(stepProgress).filter(p => p.status !== 'pending' || showProgress);

    return (
        <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-semibold text-white">Управление пайплайном</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Запуск шагов импорта xcadr</p>
                </div>
            </div>

            {/* ── Queue hints ── */}
            {hints.length > 0 && !busy && (
                <div className="mb-3 flex flex-wrap gap-3">
                    {hints.map((h, i) => (
                        <div key={i} className={`text-[11px] font-medium ${h.color} bg-gray-800/50 px-2 py-0.5 rounded`}>
                            {h.text}
                        </div>
                    ))}
                </div>
            )}

            {/* ── Progress Bars (shown during streaming execution) ── */}
            {showProgress && activeProgressSteps.length > 0 && (
                <div className="mb-4 rounded-lg border border-gray-800 bg-black/40 p-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-medium text-gray-400">Прогресс выполнения</span>
                        {!busy && (
                            <button
                                onClick={() => { setShowProgress(false); setStepProgress({}); setStreamOutput([]); }}
                                className="text-[10px] text-gray-700 hover:text-gray-400 transition-colors"
                            >
                                Скрыть
                            </button>
                        )}
                    </div>
                    <div className="space-y-0.5">
                        {ALL_STEPS.filter(s => stepProgress[s]).map(s => (
                            <ProgressBar key={s} progress={stepProgress[s]} />
                        ))}
                    </div>

                    {/* Live output */}
                    {streamOutput.length > 0 && (
                        <details className="mt-3">
                            <summary className="cursor-pointer text-[10px] text-gray-600 hover:text-gray-400 select-none">
                                Живой вывод ({streamOutput.length} строк)
                            </summary>
                            <pre className="mt-1 max-h-48 overflow-y-auto rounded bg-black/60 p-2 text-[10px] leading-relaxed text-gray-500 whitespace-pre-wrap break-all">
                                {streamOutput.slice(-50).join('\n')}
                            </pre>
                        </details>
                    )}
                </div>
            )}

            {/* ── Test connection + Step buttons ── */}
            <div className="flex flex-wrap gap-3">

                {/* 0. Test Connection */}
                <button
                    onClick={async () => {
                        setConnectionStatus('checking');
                        try {
                            const res = await fetch('/api/admin/xcadr/pipeline', {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ step: 'test-connection' }),
                            });
                            const data = await res.json();
                            setConnectionStatus(data.success ? 'ok' : 'fail');
                            const id = addLog('test', 'Тест соединения');
                            updateLog(id, {
                                status: data.success ? 'success' : 'error',
                                output: data.output || data.error || JSON.stringify(data.checks),
                                duration: data.duration,
                            });
                        } catch {
                            setConnectionStatus('fail');
                        }
                        setTimeout(() => setConnectionStatus('idle'), 5000);
                    }}
                    disabled={busy || connectionStatus === 'checking'}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        connectionStatus === 'ok' ? 'bg-green-700/40 text-green-200' :
                        connectionStatus === 'fail' ? 'bg-red-700/40 text-red-200' :
                        'bg-gray-700/40 text-gray-300 hover:bg-gray-600/50'
                    }`}
                >
                    {connectionStatus === 'checking' ? <Spinner /> : null}
                    {connectionStatus === 'ok' ? 'Contabo OK' :
                     connectionStatus === 'fail' ? 'Ошибка' :
                     connectionStatus === 'checking' ? 'Проверка...' : 'Тест соединения'}
                </button>

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
                        >
                            &#x2699;
                        </button>
                    </div>

                    {showParseForm && (
                        <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 space-y-2 min-w-[260px]">
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] text-gray-500 w-20 shrink-0">Страниц</label>
                                <input type="number" value={parsePages} min={1} max={20}
                                    onChange={(e) => setParsePages(Math.max(1, parseInt(e.target.value) || 1))}
                                    className="w-16 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200" />
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] text-gray-500 w-20 shrink-0">URL видео</label>
                                <input type="text" value={parseUrl} onChange={(e) => setParseUrl(e.target.value)}
                                    placeholder="https://xcadr.online/videos/..."
                                    className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 placeholder-gray-600" />
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] text-gray-500 w-20 shrink-0">URL актрисы</label>
                                <input type="text" value={parseCeleb} onChange={(e) => setParseCeleb(e.target.value)}
                                    placeholder="https://xcadr.online/celebs/..."
                                    className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 placeholder-gray-600" />
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] text-gray-500 w-20 shrink-0">Категория</label>
                                <div className="flex-1 flex gap-1.5">
                                    {categories.length > 0 ? (
                                        <select value={parseColl} onChange={(e) => setParseColl(e.target.value)}
                                            className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200">
                                            <option value="">— Не выбрана —</option>
                                            {categories.map((cat) => (
                                                <option key={cat.url} value={cat.url}>
                                                    {cat.name}{cat.count !== null ? ` (${cat.count})` : ''}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input type="text" value={parseColl} onChange={(e) => setParseColl(e.target.value)}
                                            placeholder="https://xcadr.online/podborki/..."
                                            className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 placeholder-gray-600" />
                                    )}
                                    <button
                                        onClick={async () => {
                                            setLoadingCategories(true);
                                            try {
                                                const res = await fetch('/api/admin/xcadr/pipeline', {
                                                    method: 'POST', credentials: 'include',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ step: 'list-categories' }),
                                                });
                                                const data = await res.json();
                                                if (data.success && Array.isArray(data.categories)) setCategories(data.categories);
                                            } catch { /* ignore */ }
                                            finally { setLoadingCategories(false); }
                                        }}
                                        disabled={loadingCategories || busy}
                                        className="shrink-0 rounded bg-gray-700 px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-600 disabled:opacity-50 transition-colors"
                                    >
                                        {loadingCategories ? '...' : '\u21BB'}
                                    </button>
                                </div>
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
                <div className="flex items-center gap-2">
                    <button onClick={() => runStep('translate', { limit: translateLimit })} disabled={busy}
                        className="flex items-center gap-1.5 rounded-lg bg-yellow-700/40 px-3 py-1.5 text-xs font-medium text-yellow-200 hover:bg-yellow-700/60 disabled:opacity-50 transition-colors">
                        {running === 'translate' ? <Spinner /> : null}
                        Перевести
                        {stats.parsed > 0 && <span className="rounded-full bg-yellow-600/50 px-1.5 text-[10px]">{stats.parsed}</span>}
                    </button>
                    <input type="number" value={translateLimit} min={1} max={500}
                        onChange={(e) => setTranslateLimit(Math.max(1, parseInt(e.target.value) || 50))}
                        disabled={busy} className="w-14 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-gray-300 disabled:opacity-50" />
                </div>

                {/* 3. Match */}
                <div className="flex items-center gap-2">
                    <button onClick={() => runStep('match', { limit: matchLimit })} disabled={busy}
                        className="flex items-center gap-1.5 rounded-lg bg-green-700/40 px-3 py-1.5 text-xs font-medium text-green-200 hover:bg-green-700/60 disabled:opacity-50 transition-colors">
                        {running === 'match' ? <Spinner /> : null}
                        Сопоставить
                        {stats.translated > 0 && <span className="rounded-full bg-green-600/50 px-1.5 text-[10px]">{stats.translated}</span>}
                    </button>
                    <input type="number" value={matchLimit} min={1} max={500}
                        onChange={(e) => setMatchLimit(Math.max(1, parseInt(e.target.value) || 50))}
                        disabled={busy} className="w-14 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-gray-300 disabled:opacity-50" />
                </div>

                {/* 4. Map Tags */}
                <button onClick={() => runStep('map-tags')} disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg bg-purple-700/40 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-700/60 disabled:opacity-50 transition-colors">
                    {running === 'map-tags' ? <Spinner /> : null}
                    Маппинг тегов
                </button>

                {/* 5. Download & Process */}
                <div className="flex items-center gap-2">
                    <button onClick={() => runStep('download', { limit: downloadLimit })} disabled={busy}
                        className="flex items-center gap-1.5 rounded-lg bg-red-700/50 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-700/70 disabled:opacity-50 transition-colors">
                        {running === 'download' ? <Spinner /> : null}
                        Скачать и обработать
                        {stats.matched > 0 && <span className="rounded-full bg-red-600/50 px-1.5 text-[10px]">{stats.matched}</span>}
                    </button>
                    <input type="number" value={downloadLimit} min={1} max={50}
                        onChange={(e) => setDownloadLimit(Math.max(1, parseInt(e.target.value) || 5))}
                        disabled={busy} className="w-14 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-gray-300 disabled:opacity-50" />
                </div>
            </div>

            {/* ── Run All with options ── */}
            <div className="mt-4 rounded-lg border border-gray-700/50 bg-gray-800/30 p-3">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-300">Полный пайплайн</span>
                    <button onClick={runAll} disabled={busy}
                        className="flex items-center gap-1.5 rounded-lg bg-brand-accent/20 px-4 py-1.5 text-xs font-semibold text-brand-accent hover:bg-brand-accent/30 disabled:opacity-50 transition-colors">
                        {running === 'run-all' ? <Spinner /> : null}
                        {running === 'run-all' ? 'Выполняется...' : 'Запустить'}
                    </button>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                        <input type="checkbox" checked={autoImport} onChange={(e) => setAutoImport(e.target.checked)}
                            disabled={busy} className="rounded border-gray-600 bg-gray-700 text-brand-accent" />
                        Авто-импорт
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                        <input type="checkbox" checked={autoDownload} onChange={(e) => setAutoDownload(e.target.checked)}
                            disabled={busy} className="rounded border-gray-600 bg-gray-700 text-brand-accent" />
                        Авто-загрузка ({downloadLimit})
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                        <input type="checkbox" checked={autoAi} onChange={(e) => setAutoAi(e.target.checked)}
                            disabled={busy} className="rounded border-gray-600 bg-gray-700 text-brand-accent" />
                        AI Vision
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                        <input type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)}
                            disabled={busy} className="rounded border-gray-600 bg-gray-700 text-brand-accent" />
                        Авто-публикация
                    </label>
                </div>
            </div>

            {/* ── Persistent log panel ── */}
            {logs.length > 0 && (
                <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-gray-500">Лог выполнения</span>
                        <button onClick={() => setLogs([])}
                            className="text-[10px] text-gray-700 hover:text-gray-400 transition-colors">
                            Очистить
                        </button>
                    </div>
                    <div ref={logContainerRef}
                        className="max-h-72 overflow-y-auto rounded-lg border border-gray-800 bg-black/50 p-3 space-y-2">
                        {logs.map(entry => <LogItem key={entry.id} entry={entry} />)}
                    </div>
                </div>
            )}
        </div>
    );
}
