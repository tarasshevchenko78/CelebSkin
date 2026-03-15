import type { Metadata } from 'next';
import '../globals.css';
import { pool } from '@/lib/db';

export const metadata: Metadata = {
    title: 'Admin — CelebSkin',
    robots: { index: false, follow: false },
};

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    let xcadrPendingCount = 0;
    try {
        const res = await pool.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM xcadr_imports WHERE status IN ('matched', 'parsed', 'translated')`
        );
        xcadrPendingCount = res.rows[0]?.count ?? 0;
    } catch {
        // table may not exist yet in all environments — safe to ignore
    }

    return (
        <html lang="en" className="dark">
            <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
                <div className="flex min-h-screen">
                    <aside className="w-64 border-r border-gray-800 bg-gray-900/50 p-4">
                        <div className="mb-8">
                            <h1 className="text-lg font-bold text-white">CelebSkin Admin</h1>
                        </div>
                        <nav className="flex flex-col gap-1">
                            <a href="/admin" className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                                Дашборд
                            </a>
                            <a href="/admin/videos" className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                                Видео
                            </a>
                            <a href="/admin/celebrities" className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                                Актрисы
                            </a>
                            <a href="/admin/movies" className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                                Фильмы
                            </a>
                            <a href="/admin/moderation" className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                                Модерация
                            </a>
                            <a href="/admin/scraper" className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                                🔄 Пайплайн
                            </a>
                            <a href="/admin/ai" className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                                AI Пайплайн
                            </a>
                            <a href="/admin/pipeline-v2" className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                                {'\uD83D\uDE80'} Pipeline v2
                            </a>
                            <a href="/admin/xcadr" className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                                <span>Импорт xcadr</span>
                                {xcadrPendingCount > 0 && (
                                    <span className="rounded-full bg-red-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                                        {xcadrPendingCount}
                                    </span>
                                )}
                            </a>
                            <a href="/admin/settings" className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                                Настройки
                            </a>
                        </nav>
                    </aside>
                    <main className="flex-1 p-8">{children}</main>
                </div>
            </body>
        </html>
    );
}
