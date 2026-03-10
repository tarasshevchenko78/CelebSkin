import { pool } from './pool';
import { cached } from '../cache';

// ============================================
// Admin — Dashboard stats
// ============================================

export async function getDashboardStats(): Promise<{
    totalVideos: number;
    publishedVideos: number;
    totalCelebrities: number;
    totalMovies: number;
    totalViews: number;
    pendingVideos: number;
    totalBlogPosts: number;
}> {
    return cached('dashboard_stats', async () => {
        const [videos, published, celebs, movies, views, pending, blogs] = await Promise.all([
            pool.query(`SELECT COUNT(*) FROM videos`),
            pool.query(`SELECT COUNT(*) FROM videos WHERE status = 'published'`),
            pool.query(`SELECT COUNT(*) FROM celebrities`),
            pool.query(`SELECT COUNT(*) FROM movies`),
            pool.query(`SELECT COALESCE(SUM(views_count), 0) AS total FROM videos WHERE status = 'published'`),
            pool.query(`SELECT COUNT(*) FROM videos WHERE status IN ('new', 'processing', 'enriched', 'needs_review')`),
            pool.query(`SELECT COUNT(*) FROM blog_posts WHERE is_published = true`),
        ]);

        return {
            totalVideos: parseInt(videos.rows[0].count),
            publishedVideos: parseInt(published.rows[0].count),
            totalCelebrities: parseInt(celebs.rows[0].count),
            totalMovies: parseInt(movies.rows[0].count),
            totalViews: parseInt(views.rows[0].total),
            pendingVideos: parseInt(pending.rows[0].count),
            totalBlogPosts: parseInt(blogs.rows[0].count),
        };
    }, 60);
}

// ============================================
// Admin — Extended dashboard (pipeline health)
// ============================================

export interface StatusCount {
    status: string;
    count: number;
}

export interface LogEntry {
    id: number;
    video_id: string | null;
    step: string;
    status: string;
    message: string | null;
    duration_ms: number | null;
    created_at: string;
}

export interface FailureEntry {
    id: number;
    video_id: string | null;
    step: string;
    error: string;
    attempts: number;
    created_at: string;
}

export async function getAdminDashboardExtended(): Promise<{
    statusBreakdown: StatusCount[];
    recentLogs: LogEntry[];
    brokenMediaCount: number;
    unresolvedFailures: FailureEntry[];
}> {
    const [statusBreakdown, recentLogs, brokenMediaCount, unresolvedFailures] = await Promise.all([
        pool.query<StatusCount>(
            `SELECT status, COUNT(*)::int AS count FROM videos GROUP BY status ORDER BY count DESC`
        ).then(r => r.rows).catch(() => [] as StatusCount[]),

        pool.query<LogEntry>(
            `SELECT id, video_id, step, status, message, duration_ms, created_at
             FROM processing_log ORDER BY created_at DESC LIMIT 10`
        ).then(r => r.rows).catch(() => [] as LogEntry[]),

        pool.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM videos
             WHERE status = 'published' AND (video_url IS NULL OR video_url NOT LIKE '%b-cdn.net%')`
        ).then(r => r.rows[0]?.count ?? 0).catch(() => 0),

        pool.query<FailureEntry>(
            `SELECT id, video_id, step, error, attempts, created_at
             FROM pipeline_failures WHERE resolved = false
             ORDER BY created_at DESC LIMIT 20`
        ).then(r => r.rows).catch(() => [] as FailureEntry[]),
    ]);

    return { statusBreakdown, recentLogs, brokenMediaCount, unresolvedFailures };
}
