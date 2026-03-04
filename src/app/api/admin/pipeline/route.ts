import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { pool } from '@/lib/db';

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

        // Count celebrities & movies
        const [celebResult, movieResult, tagResult] = await Promise.all([
            pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE tmdb_id IS NOT NULL) AS enriched FROM celebrities`),
            pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE tmdb_id IS NOT NULL) AS enriched FROM movies`),
            pool.query(`SELECT COUNT(*) AS total FROM tags`),
        ]);

        // Get currently running steps with elapsed time
        const progressResult = await pool.query(`
            SELECT step, metadata, created_at,
                   EXTRACT(EPOCH FROM (NOW() - created_at))::int AS elapsed_seconds
            FROM processing_log
            WHERE status = 'started'
              AND created_at > NOW() - INTERVAL '6 hours'
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
            actions: Object.entries(PIPELINE_ACTIONS).map(([key, val]) => ({
                id: key,
                label: val.label,
                script: val.script,
            })),
        });
    } catch (error) {
        console.error('[Pipeline API] Error:', error);
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
        if (options?.limit) args.push(`--limit=${options.limit}`);
        if (options?.model) args.push(`--model=${options.model}`);
        if (options?.force) args.push('--force');
        if (options?.test) args.push('--test');
        if (action === 'full-pipeline' && options?.test) args.push('--test');
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
        console.error('[Pipeline API] Error starting action:', error);
        return NextResponse.json(
            { error: `Failed to start pipeline: ${error instanceof Error ? error.message : 'Unknown error'}` },
            { status: 500 }
        );
    }
}

// DELETE — stop all pipeline processes on Contabo
export async function DELETE() {
    try {
        await pool.query(
            `INSERT INTO processing_log (step, status, metadata) VALUES ($1, $2, $3::jsonb)`,
            ['admin:stop-all', 'started', JSON.stringify({ stoppedAt: new Date().toISOString() })]
        );

        let killed = 0;
        try {
            const { stdout } = await execAsync(
                `ssh ${SSH_OPTS} ${CONTABO_HOST} "pkill -f 'node.*(scrape|process-with-ai|visual-recognize|enrich-metadata|watermark|generate-thumbnails|upload-to-cdn|publish-to-site|run-pipeline)' 2>/dev/null; echo \\$?"`,
                { timeout: 15000, env: { ...process.env, HOME: '/root' } }
            );
            const exitCode = parseInt(stdout.trim());
            killed = exitCode === 0 ? 1 : 0;
        } catch {
            // pkill exit code 1 means no processes matched — still success
        }

        await pool.query(
            `INSERT INTO processing_log (step, status, metadata) VALUES ($1, $2, $3::jsonb)`,
            ['admin:stop-all', 'completed', JSON.stringify({ killed, stoppedAt: new Date().toISOString() })]
        );

        return NextResponse.json({
            success: true,
            message: killed > 0 ? 'Pipeline processes stopped' : 'No running processes found',
        });
    } catch (error) {
        console.error('[Pipeline API] Error stopping:', error);
        return NextResponse.json(
            { error: `Failed to stop pipeline: ${error instanceof Error ? error.message : 'Unknown error'}` },
            { status: 500 }
        );
    }
}
