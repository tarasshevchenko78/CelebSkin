'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ============================================================
// Types
// ============================================================

interface QueueInfo {
  waiting: number;
  active: number;
  done: number;
  failed: number;
  status: string;
}

interface PipelineStatus {
  running: boolean;
  pid: number | null;
  uptime_sec: number | null;
  started_at: string | null;
  pipeline_status: string;
  queues: Record<string, QueueInfo>;
  totals: {
    total: number;
    published: number;
    failed: number;
    needs_review: number;
    in_progress: number;
  };
  stats: {
    totalCompleted: number;
    totalFailed: number;
    elapsedMs: number;
  };
  scraping?: {
    total_in_db: number;
    raw_pending: number;
    last_scrape_at: string | null;
  };
  dead_letter: Array<{
    id: number;
    videoId: string;
    step: string;
    error: string;
    attempts: number;
    failed_at: string;
  }>;
}

interface StepProgress {
  step: string | null;
  status: string;
  percent: number;
  detail: string | null;
  started_at: string | null;
  elapsed_sec: number | null;
  // Download-specific
  downloaded_mb?: number;
  total_mb?: number | null;
  speed_mbps?: number;
  eta_sec?: number | null;
}

interface PipelineVideo {
  id: string;
  title: string;
  celebrity: string | null;
  movie: string | null;
  pipeline_step: string | null;
  pipeline_error: string | null;
  ai_vision_status: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  step_progress: StepProgress | null;
}

interface CategoryItem {
  name: string;
  slug: string;
  url: string;
  count: number;
}

interface AiErrorVideo {
  id: string;
  title: string | null;
  status: string;
  ai_vision_status: string | null;
  ai_vision_model: string | null;
  ai_vision_error: string;
  original_title: string | null;
  updated_at: string;
  celebrity: string | null;
}

// ============================================================
// Constants
// ============================================================

const STEP_ORDER = ['download', 'tmdb_enrich', 'ai_vision', 'watermark', 'media', 'cdn_upload', 'publish', 'cleanup'];

const STEP_LABELS: Record<string, string> = {
  download: 'Download',
  tmdb_enrich: 'TMDB',
  ai_vision: 'AI Vision',
  watermark: 'Watermark',
  media: 'Media',
  cdn_upload: 'CDN',
  publish: 'Publish',
  cleanup: 'Cleanup',
};

const STEP_ICONS: Record<string, string> = {
  download: '\u2B07',
  downloading: '\u2B07',
  downloaded: '\u2B07',
  tmdb_enrich: '\uD83D\uDD0D',
  tmdb_enriching: '\uD83D\uDD0D',
  tmdb_enriched: '\uD83D\uDD0D',
  ai_vision: '\uD83E\uDD16',
  ai_analyzing: '\uD83E\uDD16',
  ai_analyzed: '\uD83E\uDD16',
  watermark: '\uD83C\uDFAC',
  watermarking: '\uD83C\uDFAC',
  watermarked: '\uD83C\uDFAC',
  media: '\uD83D\uDDBC',
  media_generating: '\uD83D\uDDBC',
  media_generated: '\uD83D\uDDBC',
  cdn_upload: '\u2601',
  cdn_uploading: '\u2601',
  cdn_uploaded: '\u2601',
  publish: '\u2705',
  publishing: '\u2705',
  published: '\u2705',
  cleanup: '\uD83E\uDDF9',
  failed: '\u274C',
  needs_review: '\u26A0\uFE0F',
  new: '\u23F3',
  draft: '\uD83D\uDCDD',
};

const STEP_COLORS: Record<string, string> = {
  download: 'text-blue-400',
  downloading: 'text-blue-400',
  downloaded: 'text-blue-400',
  tmdb_enrich: 'text-purple-400',
  tmdb_enriching: 'text-purple-400',
  tmdb_enriched: 'text-purple-400',
  ai_vision: 'text-orange-400',
  ai_analyzing: 'text-orange-400',
  ai_analyzed: 'text-orange-400',
  watermark: 'text-yellow-400',
  watermarking: 'text-yellow-400',
  watermarked: 'text-yellow-400',
  media: 'text-cyan-400',
  media_generating: 'text-cyan-400',
  media_generated: 'text-cyan-400',
  cdn_upload: 'text-green-400',
  cdn_uploading: 'text-green-400',
  cdn_uploaded: 'text-green-400',
  publish: 'text-emerald-400',
  publishing: 'text-emerald-400',
  published: 'text-emerald-400',
  cleanup: 'text-gray-400',
  failed: 'text-red-400',
  needs_review: 'text-amber-400',
  new: 'text-gray-500',
  draft: 'text-gray-500',
};

// ============================================================
// Helpers
// ============================================================

function formatUptime(sec: number | null): string {
  if (!sec) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  return `${Math.floor(hr / 24)}d`;
}

function getVideoStep(v: PipelineVideo): string {
  return v.pipeline_step || v.status || 'unknown';
}

function formatEta(sec: number | null): string {
  if (sec === null || sec <= 0) return '';
  if (sec < 60) return `~${sec}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
}


const STEP_BAR_COLORS: Record<string, string> = {
  download: 'bg-blue-500',
  tmdb_enrich: 'bg-purple-500',
  ai_vision: 'bg-orange-500',
  watermark: 'bg-yellow-500',
  media: 'bg-cyan-500',
  cdn_upload: 'bg-teal-500',
  publish: 'bg-green-500',
  cleanup: 'bg-gray-500',
};

function StepProgressBar({ progress, step }: { progress: StepProgress | null; step: string }) {
  const icon = STEP_ICONS[step] || '\u2753';
  const color = STEP_COLORS[step] || 'text-gray-400';
  const barColor = STEP_BAR_COLORS[step] || STEP_BAR_COLORS[progress?.step || ''] || 'bg-blue-500';
  const label = STEP_LABELS[step] || step;

  // No progress data — show spinner with step name
  if (!progress) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="animate-spin h-3 w-3 border border-gray-700 border-t-current rounded-full" style={{ borderTopColor: 'currentColor' }} />
        <span className={`text-xs ${color}`}>{icon} {label}</span>
      </div>
    );
  }

  const pct = Math.min(progress.percent, 100);
  const isDownload = progress.step === 'download';

  return (
    <div className="min-w-[220px]">
      <div className="flex items-center gap-1.5 text-xs mb-0.5 flex-wrap">
        <span className={`${color} font-medium`}>{icon} {label}</span>
        <span className="text-white font-semibold">{pct}%</span>
        {progress.detail && (
          <span className="text-gray-500 truncate max-w-[180px]" title={progress.detail}>
            {progress.detail}
          </span>
        )}
        {/* Download-specific: speed + ETA */}
        {isDownload && progress.speed_mbps && progress.speed_mbps > 0 && (
          <span className="text-cyan-400">{progress.speed_mbps} MB/s</span>
        )}
        {isDownload && progress.eta_sec && progress.eta_sec > 0 && (
          <span className="text-gray-500">{formatEta(progress.eta_sec)}</span>
        )}
        {/* Elapsed time for non-download */}
        {!isDownload && progress.elapsed_sec && progress.elapsed_sec > 0 && (
          <span className="text-gray-600">{formatUptime(progress.elapsed_sec)}</span>
        )}
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-1000`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================
// Components
// ============================================================

function QueueCard({ name, q }: { name: string; q: QueueInfo }) {
  const total = q.done + q.active + q.waiting + q.failed;
  const pct = total > 0 ? Math.round((q.done / total) * 100) : 0;
  const isActive = q.active > 0;
  const hasWaiting = q.waiting > 0;

  return (
    <div className={`rounded-lg border p-3 text-center transition-all ${
      isActive ? 'border-blue-500/50 bg-blue-950/30' :
      hasWaiting ? 'border-yellow-500/30 bg-yellow-950/20' :
      'border-gray-800 bg-gray-900/50'
    }`}>
      <div className="text-xs font-semibold text-gray-400 mb-2">{STEP_LABELS[name] || name}</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs mb-2">
        <span title="Active workers">
          <span className="text-blue-400">{'\u25C9'}</span> {q.active}
        </span>
        <span title="Waiting">
          <span className="text-yellow-400">{'\u23F3'}</span> {q.waiting}
        </span>
        <span title="Done">
          <span className="text-green-400">{'\u2705'}</span> {q.done}
        </span>
        <span title="Failed">
          <span className={q.failed > 0 ? 'text-red-400' : 'text-gray-600'}>{'\u274C'}</span> {q.failed}
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            q.failed > 0 ? 'bg-red-500' : isActive ? 'bg-blue-500' : 'bg-green-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[10px] text-gray-500 mt-1">{pct}%</div>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl max-w-sm w-full mx-4">
        <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
        <p className="text-sm text-gray-400 mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
          >
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}

function VideoDropdown({
  videoId,
  isFailed,
  onRetry,
  onDelete,
  onView,
}: {
  videoId: string;
  isFailed: boolean;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  onView: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-gray-500 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-700 transition-colors text-sm"
        title="Действия"
      >
        {'\u22EE'}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[140px]">
          {isFailed && (
            <button
              onClick={() => { setOpen(false); onRetry(videoId); }}
              className="w-full text-left px-3 py-1.5 text-xs text-amber-400 hover:bg-gray-700 transition-colors"
            >
              {'\uD83D\uDD04'} Retry
            </button>
          )}
          <button
            onClick={() => { setOpen(false); onView(videoId); }}
            className="w-full text-left px-3 py-1.5 text-xs text-blue-400 hover:bg-gray-700 transition-colors"
          >
            {'\uD83D\uDD0D'} Просмотр
          </button>
          <button
            onClick={() => { setOpen(false); onDelete(videoId); }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-700 transition-colors"
          >
            {'\uD83D\uDDD1'} Удалить
          </button>
        </div>
      )}
    </div>
  );
}

function VideoRow({
  v,
  idx,
  selected,
  onToggleSelect,
  onRetry,
  onDelete,
  onView,
}: {
  v: PipelineVideo;
  idx: number;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  onView: (id: string) => void;
}) {
  const step = getVideoStep(v);
  const icon = STEP_ICONS[step] || '\u2753';
  const color = STEP_COLORS[step] || 'text-gray-400';
  const isFailed = v.status === 'failed' || v.status === 'needs_review';
  const shortTitle = v.title?.length > 45 ? v.title.substring(0, 42) + '...' : v.title;
  const shortCeleb = v.celebrity && v.celebrity.length > 16 ? v.celebrity.substring(0, 14) + '..' : v.celebrity;
  const shortMovie = v.movie && v.movie.length > 18 ? v.movie.substring(0, 16) + '..' : v.movie;

  return (
    <tr className={`border-t border-gray-800/50 hover:bg-gray-800/30 transition-colors ${selected ? 'bg-blue-950/20' : ''}`}>
      <td className="px-2 py-2 w-8">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(v.id)}
          className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 h-3.5 w-3.5"
        />
      </td>
      <td className="px-2 py-2 text-xs text-gray-500 w-8">{idx}</td>
      <td className="px-3 py-2 text-sm text-gray-200 max-w-[300px] truncate" title={v.title}>
        {shortTitle || v.id.substring(0, 8)}
      </td>
      <td className="px-3 py-2 text-xs text-gray-400 max-w-[130px] truncate" title={v.celebrity || ''}>
        {shortCeleb || '-'}
      </td>
      <td className="px-3 py-2 text-xs text-gray-400 max-w-[150px] truncate" title={v.movie || ''}>
        {shortMovie || '-'}
      </td>
      <td className="px-3 py-2">
        {v.step_progress && !v.pipeline_error ? (
          <StepProgressBar progress={v.step_progress} step={step} />
        ) : v.pipeline_step && !v.pipeline_error && !['failed', 'needs_review', 'published'].includes(v.status) ? (
          <StepProgressBar progress={null} step={step} />
        ) : (
          <>
            <span className={`text-sm ${color}`} title={v.pipeline_error || step}>
              {icon} <span className="text-xs">{step}</span>
            </span>
            {v.pipeline_error && (
              <div className="text-[10px] text-red-400/70 mt-0.5 truncate max-w-[200px]" title={v.pipeline_error}>
                {v.pipeline_error}
              </div>
            )}
          </>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">{v.step_progress?.started_at ? timeAgo(v.step_progress.started_at) : timeAgo(v.updated_at)}</td>
      <td className="px-2 py-2 w-10">
        <VideoDropdown
          videoId={v.id}
          isFailed={isFailed}
          onRetry={onRetry}
          onDelete={onDelete}
          onView={onView}
        />
      </td>
    </tr>
  );
}

// ============================================================
// Main Page
// ============================================================

export default function PipelineV2Page() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [videos, setVideos] = useState<PipelineVideo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [limit, setLimit] = useState(10);
  const [source, setSource] = useState('boobsradar');
  const [category, setCategory] = useState('');
  const [maxSizeMb, setMaxSizeMb] = useState(0);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [aiErrors, setAiErrors] = useState<AiErrorVideo[]>([]);
  const [aiErrorsOpen, setAiErrorsOpen] = useState(false);
  const [aiErrorExpanded, setAiErrorExpanded] = useState<Set<string>>(new Set());
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairResult, setRepairResult] = useState<{ ok?: boolean; message?: string; brokenCount?: number; error?: string } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const resp = await fetch('/api/admin/pipeline-v2', { cache: 'no-store' });
      const data = await resp.json();
      if (data.error && !data.status) {
        setError(data.error);
      } else {
        setStatus(data.status || null);
        setVideos(data.videos || []);
        setError(data.error || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchAiErrors = useCallback(async () => {
    try {
      const resp = await fetch('/api/admin/pipeline-v2?action=ai-errors', { cache: 'no-store' });
      if (!resp.ok) {
        console.error('AI errors fetch failed:', resp.status);
        return;
      }
      const data = await resp.json();
      setAiErrors(data.ai_errors || []);
    } catch (err) {
      console.error('AI errors fetch error:', err);
    }
  }, []);

  const fetchCategories = useCallback(async (src: string) => {
    if (!src) {
      setCategories([]);
      setCategoriesError(false);
      return;
    }
    setCategoriesLoading(true);
    setCategoriesError(false);
    try {
      const resp = await fetch(`/api/admin/pipeline-v2?action=categories&source=${encodeURIComponent(src)}`, { cache: 'no-store' });
      const data = await resp.json();
      setCategories(data.categories || []);
    } catch {
      setCategoriesError(true);
      setCategories([]);
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchAiErrors();
    intervalRef.current = setInterval(() => fetchData(true), 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchData, fetchAiErrors]);

  // Fetch categories when source changes
  useEffect(() => {
    setCategory('');
    fetchCategories(source);
  }, [source, fetchCategories]);

  const doAction = async (action: string, extra?: Record<string, unknown>) => {
    setActionLoading(true);
    setMessage(null);
    try {
      const resp = await fetch('/api/admin/pipeline-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await resp.json();
      setMessage(data.message || data.error || JSON.stringify(data));
      fetchData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetry = (videoId: string) => doAction('retry', { videoId });

  const handleDelete = (videoId: string) => {
    const video = videos.find(v => v.id === videoId);
    const name = video?.title?.substring(0, 40) || videoId.substring(0, 8);
    setConfirmDialog({
      title: 'Удалить видео?',
      message: `"${name}" будет удалено со всеми связями. Это действие необратимо.`,
      onConfirm: () => {
        setConfirmDialog(null);
        doAction('delete', { videoId });
        setSelectedIds(prev => { const next = new Set(prev); next.delete(videoId); return next; });
      },
    });
  };

  const handleView = (videoId: string) => {
    window.open(`/admin/videos/${videoId}`, '_blank');
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setConfirmDialog({
      title: `Удалить ${selectedIds.size} видео?`,
      message: `${selectedIds.size} видео будут удалены со всеми связями. Это действие необратимо.`,
      onConfirm: () => {
        setConfirmDialog(null);
        doAction('delete-bulk', { videoIds: Array.from(selectedIds) });
        setSelectedIds(new Set());
      },
    });
  };

  const handleBulkRetry = () => {
    if (selectedIds.size === 0) return;
    const failedSelected = videos.filter(v =>
      selectedIds.has(v.id) && (v.status === 'failed' || v.status === 'needs_review')
    );
    if (failedSelected.length === 0) {
      setMessage('Нет failed/needs_review видео среди выбранных');
      return;
    }
    failedSelected.forEach(v => doAction('retry', { videoId: v.id }));
    setSelectedIds(new Set());
  };

  const handleClearAiError = async (videoId: string) => {
    await doAction('clear-ai-error', { videoId });
    fetchAiErrors();
  };

  const handleClearAllAiErrors = () => {
    setConfirmDialog({
      title: 'Очистить все AI ошибки?',
      message: `${aiErrors.length} записей об ошибках будут удалены. Видео не будут затронуты.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        await doAction('clear-all-ai-errors');
        fetchAiErrors();
      },
    });
  };

  const handleRepairScan = async () => {
    setRepairLoading(true);
    setRepairResult(null);
    try {
      const resp = await fetch('/api/admin/pipeline-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'repair-thumbnails-scan' }),
      });
      const data = await resp.json();
      setRepairResult(data);
    } catch (err) {
      setRepairResult({ error: err instanceof Error ? err.message : 'Scan failed' });
    } finally {
      setRepairLoading(false);
    }
  };

  const handleRepairStart = () => {
    setConfirmDialog({
      title: 'Запустить ремонт тамбнейлов?',
      message: `Будут найдены все опубликованные видео с битыми тамбнейлами, скачаны с CDN, пересозданы скриншоты и превью, загружены обратно. Это может занять длительное время.${repairResult?.brokenCount ? ` Найдено: ${repairResult.brokenCount} видео.` : ''}`,
      onConfirm: async () => {
        setConfirmDialog(null);
        setRepairLoading(true);
        setRepairResult(null);
        try {
          const resp = await fetch('/api/admin/pipeline-v2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'repair-thumbnails' }),
          });
          const data = await resp.json();
          setRepairResult(data);
          setMessage(data.message || data.error || 'Repair started');
        } catch (err) {
          setRepairResult({ error: err instanceof Error ? err.message : 'Repair failed' });
        } finally {
          setRepairLoading(false);
        }
      },
    });
  };

  const toggleAiErrorExpand = (id: string) => {
    setAiErrorExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === videos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(videos.map(v => v.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-600 border-t-blue-500" />
      </div>
    );
  }

  const queues = status?.queues || {};
  const totals = status?.totals || { total: 0, published: 0, failed: 0, needs_review: 0, in_progress: 0 };

  return (
    <div className="space-y-6">
      {/* Confirm Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* ── Block 1: Control Panel ─────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white">Pipeline v2</h1>
            {status?.running ? (
              <span className="flex items-center gap-1.5 text-sm">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                </span>
                <span className="text-green-400">Running</span>
                <span className="text-gray-500 text-xs">
                  pid {status.pid} &middot; {formatUptime(status.uptime_sec)}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-sm">
                <span className="h-2.5 w-2.5 rounded-full bg-gray-600" />
                <span className="text-gray-400">Stopped</span>
              </span>
            )}
            {refreshing && (
              <span className="animate-spin h-3 w-3 border border-gray-600 border-t-blue-400 rounded-full" />
            )}
          </div>
        </div>

        {/* Launch controls row */}
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wide block mb-1">Источник</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white min-w-[130px]"
            >
              <option value="">Все источники</option>
              <option value="boobsradar">boobsradar</option>
              <option value="xcadr">xcadr</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wide block mb-1">Категория</label>
            {categoriesLoading ? (
              <div className="flex items-center gap-1.5 h-[30px] px-2 text-xs text-gray-500">
                <span className="animate-spin h-3 w-3 border border-gray-600 border-t-blue-400 rounded-full" />
                Загрузка категорий...
              </div>
            ) : categoriesError || (source && categories.length === 0 && !categoriesLoading) ? (
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="celebrity-nudes..."
                className="rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white w-52 placeholder:text-gray-600"
              />
            ) : (
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white min-w-[220px] max-w-[320px]"
              >
                <option value="">
                  {source ? `Все категории (${categories.reduce((s, c) => s + c.count, 0).toLocaleString()})` : 'Выберите источник'}
                </option>
                {categories.map(cat => (
                  <option key={cat.slug} value={cat.slug}>
                    {cat.name} ({cat.count.toLocaleString()})
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wide block mb-1">Лимит</label>
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value) || 10)}
              className="w-16 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white"
              min={1}
              max={200}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wide block mb-1">Макс. МБ</label>
            <input
              type="number"
              value={maxSizeMb || ''}
              onChange={(e) => setMaxSizeMb(parseInt(e.target.value) || 0)}
              placeholder="0"
              className="w-16 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white placeholder-gray-600"
              min={0}
              max={2000}
              title="Макс. размер файла в МБ (0 = без ограничения)"
            />
          </div>
          <div className="flex gap-2">
            {!status?.running ? (
              <button
                onClick={() => doAction('start', { limit, source, category, maxSizeMb: maxSizeMb || undefined })}
                disabled={actionLoading}
                className="flex items-center gap-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
              >
                {'\u25B6'} Запуск
              </button>
            ) : (
              <button
                onClick={() => doAction('stop')}
                disabled={actionLoading}
                className="flex items-center gap-1 bg-red-600 hover:bg-red-500 disabled:bg-gray-700 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
              >
                {'\u23F9'} Стоп
              </button>
            )}
          </div>
        </div>

        {/* Totals */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="text-gray-400">Total: <span className="text-white font-medium">{totals.total}</span></span>
          <span className="text-green-400">Published: <span className="font-medium">{totals.published}</span></span>
          <span className="text-blue-400">In Progress: <span className="font-medium">{totals.in_progress}</span></span>
          <span className="text-red-400">Failed: <span className="font-medium">{totals.failed}</span></span>
          <span className="text-amber-400">Review: <span className="font-medium">{totals.needs_review}</span></span>
          {status?.stats?.elapsedMs ? (
            <span className="text-gray-500">Elapsed: {formatUptime(Math.round(status.stats.elapsedMs / 1000))}</span>
          ) : null}
          {status?.running && status?.queues && status?.stats?.elapsedMs ? (() => {
            const q = status.queues;
            const totalVideos = Math.max(1, ...Object.values(q).map((s: QueueInfo) => s.waiting + s.active + s.done + s.failed));
            const totalSteps = totalVideos * STEP_ORDER.length;
            const doneSteps = STEP_ORDER.reduce((sum, name) => sum + (q[name]?.done || 0), 0);
            if (doneSteps > 0 && doneSteps < totalSteps) {
              const elapsedSec = status.stats.elapsedMs / 1000;
              const etaSec = Math.round((elapsedSec / doneSteps) * (totalSteps - doneSteps));
              return <span className="text-cyan-400">ETA: ~{formatUptime(etaSec)}</span>;
            }
            return null;
          })() : null}
        </div>
        {/* DB stats */}
        {status?.scraping && (
          <div className="flex gap-4 text-xs mt-1.5 text-gray-500">
            <span>В базе: <span className="text-gray-300 font-medium">{status.scraping.total_in_db.toLocaleString()}</span> видео</span>
            <span>Ожидают обработки: <span className={`font-medium ${status.scraping.raw_pending > 0 ? 'text-yellow-400' : 'text-gray-400'}`}>{status.scraping.raw_pending}</span></span>
            {status.scraping.last_scrape_at && (
              <span>Последний скрапинг: {timeAgo(status.scraping.last_scrape_at)}</span>
            )}
          </div>
        )}

        {/* Message */}
        {message && (
          <div className="mt-2 text-xs text-amber-300 bg-amber-900/20 rounded px-3 py-1.5">
            {message}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-2 text-xs text-red-400 bg-red-900/20 rounded px-3 py-1.5">
            {error}
          </div>
        )}
      </div>

      {/* ── Block 2: Queue Map ─────────────────────────── */}
      <div className="grid grid-cols-8 gap-2">
        {STEP_ORDER.map((name) => (
          <QueueCard key={name} name={name} q={queues[name] || { waiting: 0, active: 0, done: 0, failed: 0, status: 'idle' }} />
        ))}
      </div>

      {/* ── Block 3: Videos Table ──────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">
            Videos in Pipeline ({videos.length})
          </h2>
          {/* Bulk actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                Выбрано: <span className="text-white font-medium">{selectedIds.size}</span>
              </span>
              <button
                onClick={handleBulkRetry}
                disabled={actionLoading}
                className="text-xs bg-amber-600/80 hover:bg-amber-500 disabled:bg-gray-700 text-white px-2.5 py-1 rounded transition-colors"
              >
                {'\uD83D\uDD04'} Retry выбранных
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={actionLoading}
                className="text-xs bg-red-600/80 hover:bg-red-500 disabled:bg-gray-700 text-white px-2.5 py-1 rounded transition-colors"
              >
                {'\uD83D\uDDD1'} Удалить выбранных
              </button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-900/80 sticky top-0">
              <tr>
                <th className="px-2 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={videos.length > 0 && selectedIds.size === videos.length}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 h-3.5 w-3.5"
                    title="Выбрать все"
                  />
                </th>
                <th className="px-2 py-2 text-xs text-gray-500 font-medium">#</th>
                <th className="px-3 py-2 text-xs text-gray-500 font-medium">Video</th>
                <th className="px-3 py-2 text-xs text-gray-500 font-medium">Celebrity</th>
                <th className="px-3 py-2 text-xs text-gray-500 font-medium">Movie</th>
                <th className="px-3 py-2 text-xs text-gray-500 font-medium">Step</th>
                <th className="px-3 py-2 text-xs text-gray-500 font-medium">Updated</th>
                <th className="px-2 py-2 text-xs text-gray-500 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {videos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500 text-sm">
                    No videos in pipeline
                  </td>
                </tr>
              ) : (
                videos.map((v, i) => (
                  <VideoRow
                    key={v.id}
                    v={v}
                    idx={i + 1}
                    selected={selectedIds.has(v.id)}
                    onToggleSelect={toggleSelect}
                    onRetry={handleRetry}
                    onDelete={handleDelete}
                    onView={handleView}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Dead Letter Queue ──────────────────────────── */}
      {status?.dead_letter && status.dead_letter.length > 0 && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-4">
          <h2 className="text-sm font-semibold text-red-400 mb-3">
            Dead Letter Queue ({status.dead_letter.length})
          </h2>
          <div className="space-y-2">
            {status.dead_letter.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-xs bg-red-900/10 rounded px-3 py-2">
                <div>
                  <span className="text-gray-400">{d.videoId.substring(0, 8)}</span>
                  <span className="text-red-400 mx-2">{d.step}</span>
                  <span className="text-gray-500">{d.error?.substring(0, 80)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">{d.attempts}x</span>
                  <button
                    onClick={() => handleRetry(d.videoId)}
                    className="text-xs bg-amber-600/80 hover:bg-amber-500 text-white px-2 py-0.5 rounded transition-colors"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Repair Thumbnails ─────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-300">Repair Broken Thumbnails</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Сканирует published видео с отсутствующими/битыми тамбнейлами и пересоздаёт скриншоты + превью
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRepairScan}
              disabled={repairLoading}
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
            >
              {repairLoading ? 'Scanning...' : 'Scan'}
            </button>
            <button
              onClick={handleRepairStart}
              disabled={repairLoading}
              className="text-xs bg-brand-accent/80 hover:bg-brand-accent text-black font-medium px-3 py-1.5 rounded transition-colors disabled:opacity-50"
            >
              {repairLoading ? 'Working...' : 'Repair All'}
            </button>
          </div>
        </div>
        {repairResult && (
          <div className={`mt-3 text-xs rounded px-3 py-2 ${
            repairResult.error
              ? 'bg-red-900/20 text-red-400'
              : 'bg-green-900/20 text-green-400'
          }`}>
            {repairResult.error && <span>Error: {repairResult.error}</span>}
            {repairResult.brokenCount !== undefined && (
              <span>Found <strong>{repairResult.brokenCount}</strong> videos with broken thumbnails</span>
            )}
            {repairResult.message && <span>{repairResult.message}</span>}
          </div>
        )}
      </div>

      {/* ── AI Vision Errors ────────────────────────────── */}
      <div className="rounded-xl border border-orange-900/50 bg-orange-950/10 overflow-hidden">
        <button
          onClick={() => { setAiErrorsOpen(!aiErrorsOpen); if (!aiErrorsOpen) fetchAiErrors(); }}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-orange-950/20 transition-colors"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-orange-400">
              AI Vision Errors
            </h2>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              aiErrors.length > 0 ? 'bg-orange-600/30 text-orange-300' : 'bg-gray-800 text-gray-500'
            }`}>
              {aiErrors.length}
            </span>
          </div>
          <span className="text-gray-500 text-xs">{aiErrorsOpen ? '\u25B2' : '\u25BC'}</span>
        </button>

        {aiErrorsOpen && (
          <div className="border-t border-orange-900/30">
            {/* Header actions */}
            {aiErrors.length > 0 && (
              <div className="px-4 py-2 flex items-center justify-between border-b border-orange-900/20">
                <span className="text-[10px] text-gray-500">
                  Видео с ошибками AI Vision (fallback на donor tags)
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => fetchAiErrors()}
                    className="text-[10px] text-gray-500 hover:text-white transition-colors"
                  >
                    Обновить
                  </button>
                  <button
                    onClick={handleClearAllAiErrors}
                    className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
                  >
                    Очистить все
                  </button>
                </div>
              </div>
            )}

            <div className="max-h-[500px] overflow-y-auto">
              {aiErrors.length === 0 ? (
                <div className="px-4 py-6 text-center text-gray-500 text-xs">
                  Нет ошибок AI Vision
                </div>
              ) : (
                <div className="divide-y divide-orange-900/20">
                  {aiErrors.map((v) => {
                    const isExpanded = aiErrorExpanded.has(v.id);
                    return (
                      <div key={v.id} className="px-4 py-2.5 hover:bg-orange-950/10 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] px-1 py-0.5 rounded ${
                                v.status === 'published' ? 'bg-green-900/30 text-green-400' :
                                v.status === 'failed' ? 'bg-red-900/30 text-red-400' :
                                'bg-gray-800 text-gray-400'
                              }`}>
                                {v.status}
                              </span>
                              <span className="text-xs text-gray-200 truncate max-w-[300px]" title={v.title || v.original_title || v.id}>
                                {v.title || v.original_title || v.id.substring(0, 8)}
                              </span>
                              {v.celebrity && (
                                <span className="text-[10px] text-gray-500 truncate max-w-[120px]">
                                  {v.celebrity}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-orange-400/70">
                                {v.ai_vision_status} / {v.ai_vision_model || 'unknown'}
                              </span>
                              <button
                                onClick={() => toggleAiErrorExpand(v.id)}
                                className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                              >
                                {isExpanded ? 'Скрыть ошибку' : 'Показать ошибку'}
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="mt-1.5 p-2 bg-gray-900/80 rounded text-[10px] text-orange-300/80 font-mono leading-relaxed break-all max-h-[120px] overflow-y-auto">
                                {v.ai_vision_error}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[10px] text-gray-600">{timeAgo(v.updated_at)}</span>
                            <button
                              onClick={() => handleView(v.id)}
                              title="Редактировать"
                              className="text-xs text-blue-400 hover:text-blue-300 px-1.5 py-0.5 rounded hover:bg-blue-950/30 transition-colors"
                            >
                              {'\u270F'}
                            </button>
                            <button
                              onClick={() => handleClearAiError(v.id)}
                              title="Очистить ошибку"
                              className="text-xs text-gray-500 hover:text-green-400 px-1.5 py-0.5 rounded hover:bg-green-950/30 transition-colors"
                            >
                              {'\u2713'}
                            </button>
                            <button
                              onClick={() => handleDelete(v.id)}
                              title="Удалить видео"
                              className="text-xs text-gray-500 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-950/30 transition-colors"
                            >
                              {'\u2717'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
