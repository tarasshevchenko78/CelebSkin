'use client';

import { useState, useEffect, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────
interface StepInfo { queued: number; active: number; completed: number; }
interface PipelineProgress { status: string; steps: Record<string, StepInfo>; completed: number; failed: number; elapsed: number; }
interface PipelineStatus { running: boolean; pid: number | null; started_at: string | null; progress: PipelineProgress | null; counts: Record<string, number>; }
interface StepProgress { step: string; status: string; percent: number; detail: string; started_at?: string; updated_at?: string; elapsed_sec?: number; }
interface XcadrVideo {
  id: number; title_ru: string; title_en: string; celebrity_name_en: string; celebrity_name_ru: string;
  movie_title_en: string; movie_title_ru: string; year: number; status: string;
  pipeline_step: string; pipeline_error: string; xcadr_url: string; updated_at: string;
  matched_video_id: string; step_progress: StepProgress | null;
  ai_vision_status: string | null; ai_vision_error: string | null;
}

// ── Constants (same as Pipeline v2) ──────────────────────────
const STEP_ORDER = ['download', 'ai_vision', 'watermark', 'media', 'cdn_upload', 'publish', 'cleanup'];

const STEP_LABELS: Record<string, string> = {
  download: 'Download', ai_vision: 'AI Vision', watermark: 'Watermark',
  media: 'Media', cdn_upload: 'CDN', publish: 'Publish', cleanup: 'Cleanup',
};

const STEP_ICONS: Record<string, string> = {
  download: '\u2B07', downloading: '\u2B07',
  ai_vision: '\uD83E\uDD16', ai_analyzing: '\uD83E\uDD16',
  watermark: '\uD83C\uDFAC', watermarking: '\uD83C\uDFAC',
  media: '\uD83D\uDDBC', media_generating: '\uD83D\uDDBC',
  cdn_upload: '\u2601', cdn_uploading: '\u2601',
  publish: '\u2705', publishing: '\u2705', published: '\u2705',
  cleanup: '\uD83E\uDDF9',
  failed: '\u274C', processing: '\u23F3',
  parsed: '\uD83D\uDCC4', translated: '\uD83C\uDF10', matched: '\uD83D\uDD17',
  imported: '\uD83D\uDCE5', no_match: '\u2754', duplicate: '\uD83D\uDD04',
};

const STEP_COLORS: Record<string, string> = {
  download: 'text-blue-400', downloading: 'text-blue-400',
  ai_vision: 'text-orange-400', ai_analyzing: 'text-orange-400',
  watermark: 'text-yellow-400', watermarking: 'text-yellow-400',
  media: 'text-cyan-400', media_generating: 'text-cyan-400',
  cdn_upload: 'text-green-400', cdn_uploading: 'text-green-400',
  publish: 'text-emerald-400', publishing: 'text-emerald-400', published: 'text-emerald-400',
  cleanup: 'text-gray-400',
  failed: 'text-red-400', processing: 'text-yellow-400',
  parsed: 'text-gray-400', translated: 'text-purple-400', matched: 'text-cyan-400',
  imported: 'text-blue-400', no_match: 'text-gray-500', duplicate: 'text-gray-500',
};

const STEP_BAR_COLORS: Record<string, string> = {
  download: 'bg-blue-500', ai_vision: 'bg-orange-500', watermark: 'bg-yellow-500',
  media: 'bg-cyan-500', cdn_upload: 'bg-teal-500', publish: 'bg-green-500', cleanup: 'bg-gray-500',
};

// ── Helpers ──────────────────────────────────────────────────
function timeAgo(dateStr: string) {
  const sec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  return `${Math.floor(hr / 24)}d`;
}

function formatElapsed(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getVideoStep(v: XcadrVideo): string {
  return v.pipeline_step || v.status || 'unknown';
}

// ── AI Vision error classification ──────────────────────────
function classifyAiError(error: string): { label: string; color: string } {
  const e = (error || '').toLowerCase();
  if (e.includes('censor') || e.includes('safety') || e.includes('blocked')) return { label: 'Censored', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' };
  if (e.includes('429') || e.includes('quota') || e.includes('resource_exhausted') || e.includes('exceeded')) return { label: 'Quota', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' };
  if (e.includes('api key') || e.includes('invalid key') || e.includes('permission') || e.includes('403') || e.includes('key_error')) return { label: 'API Key', color: 'bg-red-500/20 text-red-300 border-red-500/30' };
  if (e.includes('timeout') || e.includes('etimedout') || e.includes('econnreset')) return { label: 'Timeout', color: 'bg-orange-500/20 text-orange-300 border-orange-500/30' };
  return { label: 'Error', color: 'bg-gray-500/20 text-gray-300 border-gray-500/30' };
}

function AiVisionBadge({ video }: { video: XcadrVideo }) {
  // Show badge for: censored status, error status, or ai_vision error in pipeline_error
  const aiStatus = video.ai_vision_status;
  const aiError = video.ai_vision_error || '';
  const pipeError = video.pipeline_error || '';

  // Show censored badge even on successful videos (they used fallback tags)
  if (aiStatus === 'censored') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium bg-purple-500/20 text-purple-300 border-purple-500/30" title={aiError || 'Content blocked by safety filter'}>
        AI: Censored
      </span>
    );
  }
  if (aiStatus === 'timeout_fallback') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium bg-orange-500/20 text-orange-300 border-orange-500/30" title="AI Vision timed out, using donor tags">
        AI: Timeout
      </span>
    );
  }
  if (aiStatus === 'error' || (pipeError.includes('[ai_vision'))) {
    const errText = aiError || pipeError;
    const cls = classifyAiError(errText);
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${cls.color}`} title={errText}>
        AI: {cls.label}
      </span>
    );
  }
  return null;
}

// ── StepProgressBar (from Pipeline v2) ───────────────────────
function StepProgressBar({ progress, step }: { progress: StepProgress | null; step: string }) {
  const icon = STEP_ICONS[step] || '\u2753';
  const color = STEP_COLORS[step] || 'text-gray-400';
  const barColor = STEP_BAR_COLORS[step] || STEP_BAR_COLORS[progress?.step || ''] || 'bg-blue-500';
  const label = STEP_LABELS[step] || step;

  if (!progress) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="animate-spin h-3 w-3 border border-gray-700 border-t-current rounded-full" style={{ borderTopColor: 'currentColor' }} />
        <span className={`text-xs ${color}`}>{icon} {label}</span>
      </div>
    );
  }

  const pct = Math.min(progress.percent, 100);
  return (
    <div className="min-w-[220px]">
      <div className="flex items-center gap-1.5 text-xs mb-0.5 flex-wrap">
        <span className={`${color} font-medium`}>{icon} {label}</span>
        <span className="text-white font-semibold">{pct}%</span>
        {progress.detail && (
          <span className="text-gray-500 truncate max-w-[180px]" title={progress.detail}>{progress.detail}</span>
        )}
        {progress.elapsed_sec && progress.elapsed_sec > 0 && (
          <span className="text-gray-600">{formatElapsed(progress.elapsed_sec)}</span>
        )}
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all duration-1000`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── QueueCard (from Pipeline v2) ─────────────────────────────
function QueueCard({ name, q }: { name: string; q: StepInfo }) {
  const total = (q.queued || 0) + (q.active || 0) + (q.completed || 0);
  const pct = total > 0 ? Math.round(((q.completed || 0) / total) * 100) : 0;
  const isActive = (q.active || 0) > 0;
  const hasWaiting = (q.queued || 0) > 0;

  return (
    <div className={`rounded-lg border p-3 text-center transition-all min-w-[110px] ${
      isActive ? 'border-blue-500/50 bg-blue-950/30' :
      hasWaiting ? 'border-yellow-500/30 bg-yellow-950/20' :
      'border-gray-800 bg-gray-900/50'
    }`}>
      <div className="text-xs font-semibold text-gray-400 mb-2">{STEP_LABELS[name] || name}</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs mb-2">
        <span title="Active"><span className="text-blue-400">{'\u25C9'}</span> {q.active || 0}</span>
        <span title="Queued"><span className="text-yellow-400">{'\u23F3'}</span> {q.queued || 0}</span>
        <span title="Done"><span className="text-green-400">{'\u2705'}</span> {q.completed || 0}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${isActive ? 'bg-blue-500' : 'bg-green-500'}`}
          style={{ width: `${pct}%` }} />
      </div>
      <div className="text-center text-[10px] text-gray-500 mt-1">{pct}%</div>
    </div>
  );
}

// ── Filter tabs ──────────────────────────────────────────────
type FilterTab = 'all' | 'active' | 'published' | 'failed' | 'pre-pipeline';
const PRE_PIPELINE_STATUSES = ['parsed', 'translated', 'matched', 'imported', 'no_match', 'duplicate', 'skipped'];

// ── Main Page ────────────────────────────────────────────────
export default function XcadrPipelinePage() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [videos, setVideos] = useState<XcadrVideo[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(10);
  const [xcadrUrl, setXcadrUrl] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<FilterTab>('all');
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/xcadr-pipeline');
      const data = await res.json();
      if (data.error && !data.status) { setError(data.error); return; }
      setStatus(data.status);
      setVideos(data.videos || []);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Fetch failed'); }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 3000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const handleStart = async () => {
    setLoading(true);
    try {
      const body: Record<string, unknown> = { action: 'start', limit };
      if (xcadrUrl) {
        if (xcadrUrl.includes('/celebs/')) body.celeb = xcadrUrl;
        else if (xcadrUrl.includes('/collection/')) body.collection = xcadrUrl;
        else body.url = xcadrUrl;
      }
      const res = await fetch('/api/admin/xcadr-pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.error) setError(data.error);
      setTimeout(fetchData, 1000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Start failed'); }
    finally { setLoading(false); }
  };

  const handleStop = async () => {
    try {
      await fetch('/api/admin/xcadr-pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) });
      setTimeout(fetchData, 1000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Stop failed'); }
  };

  const handleDelete = async (ids: number[]) => {
    if (!confirm(`Удалить ${ids.length} записей? Все данные будут полностью удалены.`)) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/admin/xcadr-pipeline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids.length === 1 ? { action: 'delete', id: ids[0] } : { action: 'delete-bulk', ids }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      setSelected(new Set());
      setTimeout(fetchData, 500);
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setDeleting(false); }
  };

  const isRunning = status?.running;
  const progress = status?.progress;
  // counts from API not used — we use local filter counts instead
  const elapsed = progress?.elapsed || 0;

  // Filter videos to current pipeline run only (by started_at)
  const runStart = status?.started_at ? new Date(status.started_at).getTime() : 0;
  const currentRunVideos = runStart > 0
    ? videos.filter(v => v.updated_at && new Date(v.updated_at).getTime() >= runStart - 60000)
    : videos;

  const filteredVideos = currentRunVideos.filter(v => {
    const isPre = PRE_PIPELINE_STATUSES.includes(v.status);
    if (filter === 'active') return !isPre && !['published', 'failed'].includes(v.status);
    if (filter === 'published') return v.status === 'published';
    if (filter === 'failed') return v.status === 'failed';
    if (filter === 'pre-pipeline') return isPre;
    // 'all' — only actively processing (not published, not failed, not pre-pipeline)
    return !isPre && !['published', 'failed'].includes(v.status);
  });

  const toggleSelect = (id: number) => {
    setSelected(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  };
  const toggleAll = () => {
    if (selected.size === filteredVideos.length) setSelected(new Set());
    else setSelected(new Set(filteredVideos.map(v => v.id)));
  };

  const pipelineActive = currentRunVideos.filter(v => !PRE_PIPELINE_STATUSES.includes(v.status) && !['published', 'failed'].includes(v.status));
  const activeCount = pipelineActive.length;
  const publishedCount = currentRunVideos.filter(v => v.status === 'published').length;
  const failedCount = currentRunVideos.filter(v => v.status === 'failed').length;
  const prePipelineCount = currentRunVideos.filter(v => PRE_PIPELINE_STATUSES.includes(v.status)).length;

  // AI Vision error summary
  const aiIssues = currentRunVideos.filter(v => v.ai_vision_status === 'censored' || v.ai_vision_status === 'timeout_fallback' || v.ai_vision_status === 'error' || (v.pipeline_error || '').includes('[ai_vision'));
  const aiCensored = aiIssues.filter(v => v.ai_vision_status === 'censored').length;
  const aiTimeout = aiIssues.filter(v => v.ai_vision_status === 'timeout_fallback').length;
  const aiKeyErr = aiIssues.filter(v => {
    const e = (v.ai_vision_error || v.pipeline_error || '').toLowerCase();
    return e.includes('key') || e.includes('permission') || e.includes('403');
  }).length;
  const aiQuota = aiIssues.filter(v => {
    const e = (v.ai_vision_error || v.pipeline_error || '').toLowerCase();
    return e.includes('quota') || e.includes('429') || e.includes('resource_exhausted');
  }).length;
  const aiOther = aiIssues.length - aiCensored - aiTimeout - aiKeyErr - aiQuota;

  return (
    <div className="p-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold text-white">XCADR Pipeline</h1>
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${isRunning ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
          {isRunning ? '● Running' : '● Stopped'}
        </span>
        {isRunning && status?.pid && <span className="text-xs text-gray-500">pid {status.pid} · {formatElapsed(elapsed)}</span>}
      </div>

      {error && <div className="bg-red-900/30 border border-red-700 text-red-300 p-2 rounded mb-4 text-sm">{error}</div>}

      {/* Control Panel */}
      <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">URL (видео / актриса / подборка)</label>
            <input type="text" value={xcadrUrl} onChange={e => setXcadrUrl(e.target.value)}
              placeholder="https://xcadr.online/..." className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white w-[320px]" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Лимит</label>
            <input type="number" value={limit} onChange={e => setLimit(parseInt(e.target.value) || 10)} min={1} max={1000}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white w-[80px]" />
          </div>
          {!isRunning ? (
            <button onClick={handleStart} disabled={loading}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50">
              ▶ Запуск
            </button>
          ) : (
            <button onClick={handleStop}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded text-sm font-medium">
              ■ Стоп
            </button>
          )}
        </div>
        {(publishedCount > 0 || failedCount > 0 || activeCount > 0) && (
          <div className="flex gap-4 mt-3 text-xs">
            {activeCount > 0 && <span className="text-blue-400">В обработке: <b>{activeCount}</b></span>}
            <span className="text-green-400">Опубликовано: <b>{publishedCount}</b></span>
            {failedCount > 0 && <span className="text-red-400">Ошибки: <b>{failedCount}</b></span>}
          </div>
        )}
      </div>

      {/* Queue Map — always show when running */}
      {progress?.steps && Object.keys(progress.steps).length > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {STEP_ORDER.map(name => (
            <QueueCard key={name} name={name} q={progress.steps[name] || { queued: 0, active: 0, completed: 0 }} />
          ))}
        </div>
      )}

      {/* AI Vision Issues Summary */}
      {aiIssues.length > 0 && (
        <div className="bg-orange-950/20 border border-orange-700/30 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-orange-400">{'\uD83E\uDD16'} AI Vision ошибки ({aiIssues.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {aiCensored > 0 && <span className="px-2 py-0.5 rounded border text-xs font-medium bg-purple-500/20 text-purple-300 border-purple-500/30">Censored: {aiCensored}</span>}
            {aiQuota > 0 && <span className="px-2 py-0.5 rounded border text-xs font-medium bg-yellow-500/20 text-yellow-300 border-yellow-500/30">Quota: {aiQuota}</span>}
            {aiKeyErr > 0 && <span className="px-2 py-0.5 rounded border text-xs font-medium bg-red-500/20 text-red-300 border-red-500/30">API Key: {aiKeyErr}</span>}
            {aiTimeout > 0 && <span className="px-2 py-0.5 rounded border text-xs font-medium bg-orange-500/20 text-orange-300 border-orange-500/30">Timeout: {aiTimeout}</span>}
            {aiOther > 0 && <span className="px-2 py-0.5 rounded border text-xs font-medium bg-gray-500/20 text-gray-300 border-gray-500/30">Other: {aiOther}</span>}
          </div>
        </div>
      )}

      {/* Filter tabs + bulk actions */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1">
          {([['all', 'Pipeline', activeCount], ['published', 'Опубликованные', publishedCount], ['failed', 'Ошибки', failedCount], ['pre-pipeline', 'Импорт', prePipelineCount]] as [FilterTab, string, number][]).map(([key, label, count]) => (
            <button key={key} onClick={() => { setFilter(key); setSelected(new Set()); }}
              className={`px-3 py-1 rounded text-xs font-medium transition ${filter === key ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
              {label} {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
            </button>
          ))}
        </div>
        {selected.size > 0 && (
          <button onClick={() => handleDelete(Array.from(selected))} disabled={deleting}
            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-medium disabled:opacity-50">
            {deleting ? 'Удаление...' : `Удалить (${selected.size})`}
          </button>
        )}
      </div>

      {/* Videos Table */}
      <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-700/50">
                <th className="p-2 w-8">
                  <input type="checkbox" checked={selected.size > 0 && selected.size === filteredVideos.length}
                    onChange={toggleAll} className="rounded bg-gray-700 border-gray-600" />
                </th>
                <th className="p-2 w-8">#</th>
                <th className="p-2">Video</th>
                <th className="p-2">Celebrity</th>
                <th className="p-2">Movie</th>
                <th className="p-2 min-w-[240px]">Step</th>
                <th className="p-2 w-16">Updated</th>
                <th className="p-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filteredVideos.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-500">Нет видео</td></tr>
              ) : filteredVideos.map((v, i) => {
                const step = getVideoStep(v);
                const icon = STEP_ICONS[step] || '\u2753';
                const color = STEP_COLORS[step] || 'text-gray-400';

                return (
                  <tr key={v.id} className={`border-b border-gray-700/30 hover:bg-gray-800/30 ${selected.has(v.id) ? 'bg-blue-900/20' : ''}`}>
                    <td className="p-2">
                      <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggleSelect(v.id)}
                        className="rounded bg-gray-700 border-gray-600" />
                    </td>
                    <td className="p-2 text-gray-500">{i + 1}</td>
                    <td className="p-2 max-w-[300px]">
                      <div className="text-white text-sm truncate" title={v.title_en || v.title_ru || ''}>
                        {v.title_en || v.title_ru || `#${v.id}`}
                      </div>
                    </td>
                    <td className="p-2 text-gray-300 text-xs truncate max-w-[130px]" title={v.celebrity_name_en || v.celebrity_name_ru || ''}>
                      {v.celebrity_name_en || v.celebrity_name_ru || '-'}
                    </td>
                    <td className="p-2 text-gray-300 text-xs truncate max-w-[150px]" title={`${v.movie_title_en || v.movie_title_ru || ''}${v.year ? ` (${v.year})` : ''}`}>
                      {v.movie_title_en || v.movie_title_ru || '-'}{v.year ? ` (${v.year})` : ''}
                    </td>
                    <td className="px-3 py-2">
                      {/* Progress bar when actively processing */}
                      {v.step_progress && !v.pipeline_error ? (
                        <div>
                          <StepProgressBar progress={v.step_progress} step={v.step_progress.step || step} />
                          {v.ai_vision_status && v.ai_vision_status !== 'completed' && <div className="mt-1"><AiVisionBadge video={v} /></div>}
                        </div>
                      ) : v.pipeline_step && !v.pipeline_error && !['failed', 'published', 'parsed', 'translated', 'matched', 'imported', 'no_match', 'duplicate'].includes(v.status) ? (
                        <StepProgressBar progress={null} step={step} />
                      ) : (
                        <>
                          <span className={`text-sm ${color}`} title={v.pipeline_error || step}>
                            {icon} <span className="text-xs">{STEP_LABELS[step] || step}</span>
                          </span>
                          {v.pipeline_error && (
                            <div className="text-[10px] text-red-400/70 mt-0.5 max-w-[280px] break-words leading-tight" title={v.pipeline_error}>
                              {v.pipeline_error.length > 150 ? v.pipeline_error.substring(0, 150) + '…' : v.pipeline_error}
                            </div>
                          )}
                          <AiVisionBadge video={v} />
                        </>
                      )}
                    </td>
                    <td className="p-2 text-xs text-gray-500">
                      {v.step_progress?.started_at ? timeAgo(v.step_progress.started_at) : v.updated_at ? timeAgo(v.updated_at) : '-'}
                    </td>
                    <td className="p-2">
                      <button onClick={() => handleDelete([v.id])} className="text-gray-600 hover:text-red-400 text-xs" title="Удалить">{'\u2715'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
