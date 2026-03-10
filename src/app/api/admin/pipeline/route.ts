import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);

const CONTABO_HOST = 'root@161.97.142.117';
const SSH_KEY = '/root/.ssh/id_ed25519';
const SSH_OPTS = `-o ConnectTimeout=10 -o StrictHostKeyChecking=no -i ${SSH_KEY}`;

// Available pipeline actions
const PIPELINE_ACTIONS: Record<string, { script: string; label: string; timeout: number }> = {
    'scrape': {
        script: 'scrape-boobsradar.js',
        label: 'Scraping (Boobsradar)',
        timeout: 600,
    },
    'ai-process': {
        script: 'process-with-ai.js',
        label: 'AI Processing (Gemini)',
        timeout: 1200,
    },
    'visual-recognize': {
        script: 'visual-recognize.js',
        label: 'Visual Recognition (Gemini Vision)',
        timeout: 1800,
    },
    'tmdb-enrich': {
        script: 'enrich-metadata.js',
        label: 'TMDB Enrichment',
        timeout: 600,
    },
    'watermark': {
        script: 'watermark.js',
        label: 'Video Watermarking',
        timeout: 1800,
    },
    'thumbnails': {
        script: 'generate-thumbnails.js',
        label: 'Thumbnail Generation',
        timeout: 1800,
    },
    'cdn-upload': {
        script: 'upload-to-cdn.js',
        label: 'CDN Upload (BunnyCDN)',
        timeout: 1800,
    },
    'publish': {
        script: 'publish-to-site.js',
        label: 'Publish Videos',
        timeout: 300,
    },
    'full-pipeline': {
        script: 'run-pipeline.js',
        label: 'Full Pipeline',
        timeout: 3600,
    },
};

// GET — pipeline stats & running processes
export async function GET() {
    try {
        // Get pipeline stats from DB
        const [rawStats, videoStats, pipelineLogs] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                    COUNT(*) FILTER (WHERE status = 'processing') AS processing,
                    COUNT(*) FILTER (WHERE status = 'processed') AS processed,
                    COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                    COUNT(*) FILTER (WHERE status = 'skipped') AS skipped
                FROM raw_videos
            `),
            pool.query(`
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'new') AS new,
                    COUNT(*) FILTER (WHERE status = 'enriched') AS enriched,
                    COUNT(*) FILTER (WHERE status = 'auto_recognized') AS auto_recognized,
                    COUNT(*) FILTER (WHERE status = 'watermarked') AS watermarked,
                    COUNT(*) FILTER (WHERE status = 'needs_review') AS needs_review,
                    COUNT(*) FILTER (WHERE status = 'unknown_with_suggestions') AS unknown_with_suggestions,
                    COUNT(*) FILTER (WHERE status = 'published') AS published,
                    COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
                    COALESCE(AVG(ai_confidence) FILTER (WHERE ai_confidence IS NOT NULL), 0) AS avg_confidence
                FROM videos
            `),
            pool.query(`
                SELECT step, status, metadata, created_at
                FROM processing_log
                ORDER BY created_at DESC
                LIMIT 30
            `),
        ]);

        // Count celebrities & movies + pipeline flow counts + in-progress videos
        const [celebResult, movieResult, tagResult, flowResult, inProgressResult] = await Promise.all([
            pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE tmdb_id IS NOT NULL) AS enriched FROM celebrities`),
            pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE tmdb_id IS NOT NULL) AS enriched FROM movies`),
            pool.query(`SELECT COUNT(*) AS total FROM tags`),
            pool.query(`
                SELECT
                    (SELECT COUNT(*) FROM raw_videos WHERE status='pending') AS scrape,
                    (SELECT COUNT(*) FROM raw_videos WHERE status='pending') AS ai_process,
                    (SELECT COUNT(*) FROM videos WHERE status IN ('enriched','auto_recognized')
                     AND video_url IS NOT NULL
                     AND (video_url_watermarked IS NULL OR video_url_watermarked = '')) AS watermark,
                    (SELECT COUNT(*) FROM videos WHERE status='watermarked'
                     AND (thumbnail_url IS NULL OR thumbnail_url NOT LIKE '%b-cdn.net%')) AS thumbnails,
                    (SELECT COUNT(*) FROM videos WHERE video_url_watermarked LIKE 'tmp/%%'
                     OR thumbnail_url LIKE 'tmp/%%') AS cdn_upload,
                    (SELECT COUNT(*) FROM videos WHERE status='watermarked'
                     AND video_url_watermarked LIKE '%%b-cdn.net%%'
                     AND thumbnail_url LIKE '%%b-cdn.net%%') AS publish
            `),
            pool.query(`
                SELECT id, title->>'en' as title, status, updated_at,
                       video_url_watermarked, thumbnail_url
                FROM videos
                WHERE status NOT IN ('published', 'rejected', 'needs_review')
                ORDER BY updated_at DESC LIMIT 20
            `),
        ]);

        // Get currently running steps with elapsed time
        const progressResult = await pool.query(`
            SELECT step, metadata, created_at,
                   EXTRACT(EPOCH FROM (NOW() - created_at))::int AS elapsed_seconds
            FROM processing_log
            WHERE status = 'started'
              AND step NOT LIKE 'admin:%'
              AND created_at > NOW() - INTERVAL '1 hour'
              AND NOT EXISTS (
                  SELECT 1 FROM processing_log pl2
                  WHERE pl2.step = processing_log.step
                    AND pl2.status IN ('completed', 'failed')
                    AND pl2.created_at > processing_log.created_at
              )
            ORDER BY created_at DESC
        `);

        // Get categories from DB
        let categories: Array<{ slug: string; name: string; videos_count: number }> = [];
        try {
            const catResult = await pool.query(
                `SELECT slug, name, videos_count FROM categories ORDER BY videos_count DESC`
            );
            categories = catResult.rows;
        } catch {
            // categories table might not exist
        }

        // Check if any pipeline process is running on Contabo
        let runningProcesses: string[] = [];
        let videoProgress = null;
        try {
            const { stdout } = await execAsync(
                `ssh ${SSH_OPTS} ${CONTABO_HOST} "ps aux | grep -E 'node.*(scrape|process-with-ai|visual-recognize|enrich-metadata|watermark|generate-thumbnails|upload-to-cdn|publish-to-site|run-pipeline)' | grep -v grep | awk '{for(i=1;i<=NF;i++){if(\\$i~/\\\\.js$/){sub(/.*\\\\//,\\\"\\\",\\$i);print \\$i;break}}}'; echo '___PROGRESS_SEP___'; cat /opt/celebskin/scripts/logs/progress.json 2>/dev/null || echo 'null'"`,
                { timeout: 10000, env: { ...process.env, HOME: '/root' } }
            );
            const parts = stdout.split('___PROGRESS_SEP___');
            runningProcesses = (parts[0] || '').trim().split('\n').filter(Boolean);

            try {
                const progressRaw = (parts[1] || '').trim();
                if (progressRaw && progressRaw !== 'null') {
                    const parsed = JSON.parse(progressRaw);
                    // Filter stale data: if updatedAt is older than 60 seconds and no matching process running
                    const updatedAt = new Date(parsed.updatedAt).getTime();
                    const age = Date.now() - updatedAt;
                    if (age < 60000 || runningProcesses.length > 0) {
                        videoProgress = parsed;
                    }
                }
            } catch {
                // Invalid JSON — ignore
            }
        } catch {
            // SSH might fail — not critical
        }

        return NextResponse.json({
            raw: rawStats.rows[0],
            videos: videoStats.rows[0],
            celebrities: celebResult.rows[0],
            movies: movieResult.rows[0],
            tags: tagResult.rows[0],
            recentLogs: pipelineLogs.rows,
            runningProcesses,
            videoProgress,
            progress: progressResult.rows,
            categories,
            flowCounts: flowResult.rows[0],
            inProgressVideos: inProgressResult.rows,
            actions: Object.entries(PIPELINE_ACTIONS).map(([key, val]) => ({
                id: key,
                label: val.label,
                script: val.script,
            })),
        });
    } catch (error) {
        logger.error('Pipeline stats fetch failed', { route: '/api/admin/pipeline', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Failed to fetch pipeline stats' }, { status: 500 });
    }
}

// POST — run pipeline action
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { action, options } = body as {
            action: string;
            options?: { limit?: number; model?: string; force?: boolean; test?: boolean; categories?: string[] };
        };

        const pipelineAction = PIPELINE_ACTIONS[action];
        if (!pipelineAction) {
            return NextResponse.json(
                { error: `Unknown action: ${action}. Available: ${Object.keys(PIPELINE_ACTIONS).join(', ')}` },
                { status: 400 }
            );
        }

        // Build CLI args
        const args: string[] = [];
        // Test mode forces limit=3, overriding user's limit field
        if (options?.test) {
            args.push('--limit=3');
            args.push('--test');
        } else if (options?.limit) {
            args.push(`--limit=${options.limit}`);
        }
        if (options?.model) args.push(`--model=${options.model}`);
        if (options?.force) args.push('--force');
        if (action === 'publish') args.push('--auto');
        if (options?.categories && options.categories.length > 0) {
            args.push(`--categories=${options.categories.join(',')}`);
        }

        const argsStr = args.length > 0 ? ' ' + args.join(' ') : '';
        const scriptArgs = `${pipelineAction.script}${argsStr}`;

        // Log pipeline start
        await pool.query(
            `INSERT INTO processing_log (step, status, metadata) VALUES ($1, $2, $3::jsonb)`,
            [`admin:${action}`, 'started', JSON.stringify({ args: argsStr.trim(), startedAt: new Date().toISOString() })]
        );

        // Execute via shell wrapper (handles SSH + nohup properly)
        const runScript = `${process.cwd()}/scripts/run-remote.sh`;
        await execAsync(`${runScript} ${scriptArgs}`, {
            timeout: 20000,
            env: { ...process.env, HOME: '/root' },
        });

        return NextResponse.json({
            success: true,
            action: action,
            label: pipelineAction.label,
            args: argsStr.trim(),
            message: `${pipelineAction.label} started on Contabo`,
        });
    } catch (error) {
        logger.error('Pipeline action start failed', { route: '/api/admin/pipeline', action: 'POST', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: `Failed to start pipeline: ${error instanceof Error ? error.message : 'Unknown error'}` },
            { status: 500 }
        );
    }
}

// DELETE — stop pipeline processes on Contabo
// Body: { mode: 'drain' } — graceful: create .stop file, scheduler stops spawning new work
// Body: empty / { mode: 'kill' } — hard stop: kill by PID + pkill safety net
export async function DELETE(request: NextRequest) {
    try {
        let mode = 'kill';
        try {
            const body = await request.json();
            if (body?.mode === 'drain') mode = 'drain';
        } catch {
            // No body = hard stop
        }

        const SCRIPTS_DIR = '/opt/celebskin/scripts';
        const PID_FILE = `${SCRIPTS_DIR}/logs/pipeline.pid`;
        const CHILDREN_FILE = `${SCRIPTS_DIR}/logs/children.pid`;
        const STOP_FILE = `${SCRIPTS_DIR}/logs/.stop`;

        if (mode === 'drain') {
            // Drain: create .stop sentinel → scheduler stops spawning new steps
            await pool.query(
                `INSERT INTO processing_log (step, status, metadata) VALUES ($1, $2, $3::jsonb)`,
                ['admin:drain', 'started', JSON.stringify({ drainedAt: new Date().toISOString() })]
            );

            let success = false;
            try {
                await execAsync(
                    `ssh ${SSH_OPTS} ${CONTABO_HOST} "touch ${STOP_FILE}; echo done"`,
                    { timeout: 15000, env: { ...process.env, HOME: '/root' } }
                );
                success = true;
            } catch {
                // SSH might fail
            }

            await pool.query(
                `INSERT INTO processing_log (step, status, metadata) VALUES ($1, $2, $3::jsonb)`,
                ['admin:drain', 'completed', JSON.stringify({ success, drainedAt: new Date().toISOString() })]
            );

            return NextResponse.json({
                success: true,
                message: success
                    ? 'Drain mode: scheduler will stop after current steps finish'
                    : 'Failed to signal drain mode',
            });
        }

        // Hard stop — kill by PID files + pkill safety net
        await pool.query(
            `INSERT INTO processing_log (step, status, metadata) VALUES ($1, $2, $3::jsonb)`,
            ['admin:stop-all', 'started', JSON.stringify({ stoppedAt: new Date().toISOString() })]
        );

        let killed = false;
        try {
            const killCmd = [
                // Kill orchestrator by PID
                `if [ -f ${PID_FILE} ]; then kill $(cat ${PID_FILE}) 2>/dev/null; fi`,
                // Kill child processes by PID
                `if [ -f ${CHILDREN_FILE} ]; then while read pid; do kill $pid 2>/dev/null; done < ${CHILDREN_FILE}; fi`,
                // Safety net: pkill any remaining
                `pkill -f 'node.*(scrape|process-with-ai|visual-recognize|enrich-metadata|watermark|generate-thumbnails|upload-to-cdn|publish-to-site|run-pipeline)' 2>/dev/null`,
                // Cleanup PID files
                `rm -f ${PID_FILE} ${CHILDREN_FILE} ${STOP_FILE}`,
                'echo done',
            ].join('; ');

            await execAsync(
                `ssh ${SSH_OPTS} ${CONTABO_HOST} "${killCmd}"`,
                { timeout: 15000, env: { ...process.env, HOME: '/root' } }
            );
            killed = true;
        } catch {
            // pkill exit code 1 means no processes — still success
            killed = true;
        }

        await pool.query(
            `INSERT INTO processing_log (step, status, metadata) VALUES ($1, $2, $3::jsonb)`,
            ['admin:stop-all', 'completed', JSON.stringify({ killed, stoppedAt: new Date().toISOString() })]
        );

        return NextResponse.json({
            success: true,
            message: 'All pipeline processes stopped',
        });
    } catch (error) {
        logger.error('Pipeline stop failed', { route: '/api/admin/pipeline', action: 'DELETE', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: `Failed to stop pipeline: ${error instanceof Error ? error.message : 'Unknown error'}` },
            { status: 500 }
        );
    }
}
