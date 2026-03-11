import { getDashboardStats, getAdminDashboardExtended } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { StatusCount, LogEntry, FailureEntry } from '@/lib/db/admin';

export const dynamic = 'force-dynamic';

function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин. назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч. назад`;
    const days = Math.floor(hours / 24);
    return `${days} д. назад`;
}

const STATUS_COLORS: Record<string, { border: string; text: string }> = {
    published:                 { border: 'border-l-green-500',  text: 'text-green-400' },
    watermarked:               { border: 'border-l-indigo-500', text: 'text-indigo-400' },
    needs_review:              { border: 'border-l-yellow-500', text: 'text-yellow-400' },
    processing:                { border: 'border-l-blue-500',   text: 'text-blue-400' },
    enriched:                  { border: 'border-l-purple-500', text: 'text-purple-400' },
    auto_recognized:           { border: 'border-l-cyan-500',   text: 'text-cyan-400' },
    unknown_with_suggestions:  { border: 'border-l-orange-500', text: 'text-orange-400' },
    new:                       { border: 'border-l-gray-500',   text: 'text-gray-400' },
    rejected:                  { border: 'border-l-red-500',    text: 'text-red-400' },
    dmca_removed:              { border: 'border-l-red-700',    text: 'text-red-300' },
};

const LOG_STATUS_COLORS: Record<string, string> = {
    success: 'bg-green-900/50 text-green-400',
    completed: 'bg-green-900/50 text-green-400',
    error: 'bg-red-900/50 text-red-400',
    failed: 'bg-red-900/50 text-red-400',
    started: 'bg-blue-900/50 text-blue-400',
    skipped: 'bg-gray-700 text-gray-400',
};

export default async function AdminDashboard() {
    let stats = {
        totalVideos: 0,
        publishedVideos: 0,
        totalCelebrities: 0,
        totalMovies: 0,
        totalViews: 0,
        pendingVideos: 0,
        totalBlogPosts: 0,
    };

    let extended = {
        statusBreakdown: [] as StatusCount[],
        recentLogs: [] as LogEntry[],
        brokenMediaCount: 0,
        unresolvedFailures: [] as FailureEntry[],
    };

    try {
        [stats, extended] = await Promise.all([
            getDashboardStats(),
            getAdminDashboardExtended(),
        ]);
    } catch (error) {
        logger.error('Admin dashboard DB error', { page: 'admin/dashboard', error: error instanceof Error ? error.message : String(error) });
    }

    const stuckCount = extended.unresolvedFailures.length;

    return (
        <div>
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold text-white">Дашборд</h1>
                {/* Quick Actions */}
                <div className="flex gap-2">
                    <a
                        href="/admin/scraper"
                        className="px-4 py-2 text-xs font-medium rounded-lg bg-green-900/50 text-green-400 border border-green-800 hover:bg-green-800/50 transition-colors"
                    >
                        Запустить пайплайн
                    </a>
                    <a
                        href="/admin/test-video"
                        className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-900/50 text-blue-400 border border-blue-800 hover:bg-blue-800/50 transition-colors"
                    >
                        Проверить здоровье
                    </a>
                    <a
                        href="#dead-letter"
                        className="px-4 py-2 text-xs font-medium rounded-lg bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700 transition-colors"
                    >
                        Зависшие
                    </a>
                </div>
            </div>

            {/* Pipeline Health — Status Breakdown */}
            <section className="mb-8">
                <h2 className="text-lg font-semibold text-white mb-4">Здоровье пайплайна</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {extended.statusBreakdown.map((s) => {
                        const colors = STATUS_COLORS[s.status] || { border: 'border-l-gray-600', text: 'text-gray-400' };
                        return (
                            <div
                                key={s.status}
                                className={`rounded-lg border border-gray-800 bg-gray-900/50 p-4 border-l-4 ${colors.border}`}
                            >
                                <p className="text-xs text-gray-500 capitalize">{s.status.replace(/_/g, ' ')}</p>
                                <p className={`text-2xl font-bold mt-1 ${colors.text}`}>{s.count}</p>
                            </div>
                        );
                    })}
                    {/* Broken media card */}
                    <div className={`rounded-lg border bg-gray-900/50 p-4 border-l-4 ${extended.brokenMediaCount > 0 ? 'border-red-500 border-gray-800' : 'border-l-green-500 border-gray-800'}`}>
                        <p className="text-xs text-gray-500">Битые медиа</p>
                        <p className={`text-2xl font-bold mt-1 ${extended.brokenMediaCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {extended.brokenMediaCount}
                        </p>
                    </div>
                </div>
            </section>

            {/* Overview Stats */}
            <section className="mb-8">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                        <p className="text-sm text-gray-400">Всего видео</p>
                        <p className="mt-2 text-3xl font-bold text-white">{formatNumber(stats.totalVideos)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                        <p className="text-sm text-gray-400">Актрисы</p>
                        <p className="mt-2 text-3xl font-bold text-purple-400">{formatNumber(stats.totalCelebrities)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                        <p className="text-sm text-gray-400">Всего просмотров</p>
                        <p className="mt-2 text-3xl font-bold text-blue-400">{formatNumber(stats.totalViews)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                        <p className="text-sm text-gray-400">Фильмы</p>
                        <p className="mt-2 text-3xl font-bold text-orange-400">{formatNumber(stats.totalMovies)}</p>
                    </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                        <p className="text-sm text-gray-400">Опубликовано</p>
                        <p className="mt-2 text-2xl font-bold text-green-400">{formatNumber(stats.publishedVideos)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                        <p className="text-sm text-gray-400">На проверке</p>
                        <p className="mt-2 text-2xl font-bold text-yellow-400">{formatNumber(stats.pendingVideos)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                        <p className="text-sm text-gray-400">Блог-посты</p>
                        <p className="mt-2 text-2xl font-bold text-cyan-400">{formatNumber(stats.totalBlogPosts)}</p>
                    </div>
                </div>
            </section>

            {/* Dead Letter Queue */}
            <section id="dead-letter" className="mb-8">
                <h2 className="text-lg font-semibold text-white mb-4">Очередь ошибок</h2>
                {stuckCount > 0 ? (
                    <div className="rounded-xl border border-red-800 bg-red-950/30 p-4">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                            <p className="text-red-400 font-semibold">{stuckCount} видео зависло в пайплайне</p>
                        </div>
                        <details>
                            <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
                                Показать детали
                            </summary>
                            <div className="mt-3 overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-gray-500 border-b border-gray-800">
                                            <th className="pb-2 pr-4">ID видео</th>
                                            <th className="pb-2 pr-4">Шаг</th>
                                            <th className="pb-2 pr-4">Ошибка</th>
                                            <th className="pb-2 pr-4">Попытки</th>
                                            <th className="pb-2">Когда</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800">
                                        {extended.unresolvedFailures.map((f) => (
                                            <tr key={f.id} className="text-gray-300">
                                                <td className="py-2 pr-4 font-mono text-xs">{f.video_id?.slice(0, 8) ?? '—'}...</td>
                                                <td className="py-2 pr-4">{f.step}</td>
                                                <td className="py-2 pr-4 text-red-400 max-w-xs truncate">{f.error.slice(0, 100)}</td>
                                                <td className="py-2 pr-4">{f.attempts}</td>
                                                <td className="py-2 text-gray-500">{timeAgo(f.created_at)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </details>
                    </div>
                ) : (
                    <div className="rounded-xl border border-green-800/50 bg-green-950/20 p-4 flex items-center gap-3">
                        <div className="h-3 w-3 rounded-full bg-green-500" />
                        <p className="text-green-400 text-sm">Зависших видео нет — пайплайн работает нормально</p>
                    </div>
                )}
            </section>

            {/* Recent Activity */}
            {extended.recentLogs.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-lg font-semibold text-white mb-4">Последняя активность</h2>
                    <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-gray-500 border-b border-gray-800">
                                        <th className="p-3">Время</th>
                                        <th className="p-3">Шаг</th>
                                        <th className="p-3">Статус</th>
                                        <th className="p-3">Сообщение</th>
                                        <th className="p-3">Длительность</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800/50">
                                    {extended.recentLogs.map((log) => {
                                        const statusClass = LOG_STATUS_COLORS[log.status] || 'bg-gray-700 text-gray-400';
                                        return (
                                            <tr key={log.id} className="text-gray-300 hover:bg-gray-900/80 transition-colors">
                                                <td className="p-3 text-gray-500 whitespace-nowrap">{timeAgo(log.created_at)}</td>
                                                <td className="p-3 font-mono text-xs">{log.step}</td>
                                                <td className="p-3">
                                                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>
                                                        {log.status}
                                                    </span>
                                                </td>
                                                <td className="p-3 max-w-xs truncate text-gray-400">{log.message || '—'}</td>
                                                <td className="p-3 text-gray-500 whitespace-nowrap">
                                                    {log.duration_ms != null ? `${(log.duration_ms / 1000).toFixed(1)}s` : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}
