import { getDashboardStats } from '@/lib/db';

function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

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

    try {
        stats = await getDashboardStats();
    } catch (error) {
        console.error('[AdminDashboard] DB error:', error);
    }

    return (
        <div>
            <h1 className="mb-8 text-3xl font-bold text-white">Dashboard</h1>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                    <p className="text-sm text-gray-400">Total Videos</p>
                    <p className="mt-2 text-3xl font-bold text-white">{formatNumber(stats.totalVideos)}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                    <p className="text-sm text-gray-400">Published</p>
                    <p className="mt-2 text-3xl font-bold text-green-400">{formatNumber(stats.publishedVideos)}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                    <p className="text-sm text-gray-400">Celebrities</p>
                    <p className="mt-2 text-3xl font-bold text-purple-400">{formatNumber(stats.totalCelebrities)}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                    <p className="text-sm text-gray-400">Total Views</p>
                    <p className="mt-2 text-3xl font-bold text-blue-400">{formatNumber(stats.totalViews)}</p>
                </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                    <p className="text-sm text-gray-400">Movies</p>
                    <p className="mt-2 text-2xl font-bold text-orange-400">{formatNumber(stats.totalMovies)}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                    <p className="text-sm text-gray-400">Pending Review</p>
                    <p className="mt-2 text-2xl font-bold text-yellow-400">{formatNumber(stats.pendingVideos)}</p>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                    <p className="text-sm text-gray-400">Blog Posts</p>
                    <p className="mt-2 text-2xl font-bold text-cyan-400">{formatNumber(stats.totalBlogPosts)}</p>
                </div>
            </div>

            <div className="mt-8 rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                <h2 className="mb-4 text-xl font-semibold text-white">Pipeline Status</h2>
                {stats.pendingVideos > 0 ? (
                    <div className="flex items-center gap-3">
                        <div className="h-3 w-3 rounded-full bg-yellow-400 animate-pulse" />
                        <p className="text-gray-300">{stats.pendingVideos} videos in pipeline</p>
                    </div>
                ) : (
                    <p className="text-gray-500">No active pipeline tasks</p>
                )}
            </div>
        </div>
    );
}
