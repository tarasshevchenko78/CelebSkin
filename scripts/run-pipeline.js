#!/usr/bin/env node
/**
 * run-pipeline.js — CelebSkin Full Automation Pipeline
 *
 * Complete flow:
 *   1. Scrape → raw_videos (scrape-boobsradar.js)
 *   2. AI Processing → videos with 10-lang JSONB (process-with-ai.js)
 *   2b. Visual Recognition → boost low-confidence (visual-recognize.js)
 *   3. TMDB Enrichment → celebrity photos, movie posters (enrich-metadata.js)
 *   4. Watermark → video with celeb.skin overlay (watermark.js)
 *   5. Thumbnails → screenshots + sprite + preview GIF (generate-thumbnails.js)
 *   6. CDN Upload → BunnyCDN (upload-to-cdn.js)
 *   6b. Preview Clips → 6s hover preview from watermarked video (generate-preview.js)
 *   7. Publish → status=published, multilingual slugs (publish-to-site.js)
 *
 * Modes:
 *   Scheduler (default) — DB-driven loop, spawns steps when work available, max 3 videos/step
 *   Sequential (--sequential) — fallback mode, steps run one after another
 *
 * Usage:
 *   node run-pipeline.js                    # scheduler mode (default)
 *   node run-pipeline.js --sequential       # sequential mode (strict order, one step at a time)
 *   node run-pipeline.js --test             # test mode (limit=1 per step)
 *   node run-pipeline.js --step=2           # start from specific step
 *   node run-pipeline.js --only=scrape      # run only one step
 *   node run-pipeline.js --skip=watermark   # skip specific step
 *   node run-pipeline.js --limit=10         # limit items per step
 *   node run-pipeline.js --auto-publish     # auto-publish high confidence
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, unlinkSync, accessSync } from 'fs';
import { query } from './lib/db.js';
import logger from './lib/logger.js';
import {
    writePipelineProgress, clearAllProgress, initSteps,
    markStepDone, writeStepStatus, readProgressFile, readStepResult,
    writeVideoJourneys,
} from './lib/progress.js';
import { canTransition } from './lib/state-machine.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================
// Pipeline Steps Configuration
// ============================================

const STEPS = [
    {
        name: 'scrape',
        label: '1. Scraping (boobsradar)',
        script: 'scrape-boobsradar.js',
        args: [],
        timeout: 1800000,  // 30 min
        required: false,
        runOnce: true,     // Don't poll in conveyor mode
    },
    {
        name: 'ai-process',
        label: '2. AI Processing (Gemini 2.5 Flash)',
        script: 'process-with-ai.js',
        args: [],
        timeout: 1200000, // 20 min
        required: true,
        deps: ['scrape'],  // Wait for scrape to produce at least 1 video
    },
    {
        name: 'visual-recognize',
        label: '2b. Visual Recognition (Gemini Vision)',
        script: 'visual-recognize.js',
        args: [],
        timeout: 1800000,
        required: false,
        deps: ['ai-process'],
    },
    {
        name: 'tmdb-enrich',
        label: '3. TMDB Enrichment',
        script: 'enrich-metadata.js',
        args: [],
        timeout: 600000,
        required: false,
        deps: ['ai-process'],
    },
    {
        name: 'watermark',
        label: '4. Watermarking',
        script: 'watermark.js',
        args: [],
        timeout: 1800000,
        required: false,
        deps: ['ai-process'],
    },
    {
        name: 'thumbnails',
        label: '5. Thumbnail & Sprite Generation',
        script: 'generate-thumbnails.js',
        args: [],
        timeout: 1800000,
        required: false,
        deps: ['watermark'],
    },
    {
        name: 'cdn-upload',
        label: '6. CDN Upload (BunnyCDN)',
        script: 'upload-to-cdn.js',
        args: ['--cleanup'],
        timeout: 1800000,
        required: false,
        deps: ['watermark', 'thumbnails'],
    },
    {
        name: 'preview-generate',
        label: '6b. Preview Clip Generation',
        script: 'generate-preview.js',
        args: [],
        timeout: 1800000,  // 30 min
        required: false,
        deps: ['cdn-upload'],
    },
    {
        name: 'publish',
        label: '7. Publishing',
        script: 'publish-to-site.js',
        args: ['--auto'],
        timeout: 300000,
        required: true,
        deps: ['cdn-upload'],
    },
];

// ============================================
// Step Runner
// ============================================

async function runStep(step, extraArgs = [], testMode = false) {
    const scriptPath = join(__dirname, step.script);
    const args = [...step.args, ...extraArgs];

    if (testMode && !args.some(a => a.startsWith('--limit='))) {
        args.push('--limit=3');
    }

    logger.info(`\nStarting: ${step.label}`);
    logger.info(`Script: ${step.script} ${args.join(' ')}`);
    logger.info('-'.repeat(50));

    const startTime = Date.now();

    try {
        const { stdout, stderr } = await execFileAsync('node', [scriptPath, ...args], {
            cwd: __dirname,
            timeout: step.timeout,
            env: { ...process.env },
            maxBuffer: 10 * 1024 * 1024,
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        if (stdout) {
            const lines = stdout.trim().split('\n');
            const lastLines = lines.slice(-20);
            lastLines.forEach(line => logger.info(`  ${line}`));
        }
        if (stderr && !stderr.includes('ExperimentalWarning')) {
            logger.warn(`  STDERR: ${stderr.substring(0, 500)}`);
        }

        logger.info(`✓ ${step.label} — completed in ${duration}s`);
        await logPipelineStep(step.name, 'completed', { duration, args }).catch(() => {});

        return { success: true, duration, stdout: stdout || '' };
    } catch (err) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.error(`✗ ${step.label} — failed after ${duration}s`);
        logger.error(`  Error: ${err.message}`);

        if (err.stdout) {
            const lines = err.stdout.trim().split('\n').slice(-10);
            lines.forEach(line => logger.info(`  ${line}`));
        }

        await logPipelineStep(step.name, 'failed', { duration, error: err.message }).catch(() => {});

        return { success: false, error: err.message, duration, stdout: err.stdout || '' };
    }
}

async function logPipelineStep(stepName, status, details) {
    await query(
        `INSERT INTO processing_log (step, status, metadata)
         VALUES ($1, $2, $3::jsonb)`,
        [`pipeline:${stepName}`, status, JSON.stringify(details)]
    );
}

// ============================================
// Scheduler Mode (replaces conveyor)
// ============================================

const PID_FILE = join(__dirname, 'logs', 'pipeline.pid');
const CHILDREN_PID_FILE = join(__dirname, 'logs', 'children.pid');
const STOP_FILE = join(__dirname, 'logs', '.stop');
const SCHEDULER_INTERVAL = 5000;  // 5 sec between checks
const MAX_PER_STEP = 3;           // max videos per step

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// Graceful shutdown
let shuttingDown = false;
process.on('SIGINT', () => {
    logger.info('\n[scheduler] SIGINT received — shutting down gracefully...');
    shuttingDown = true;
});
process.on('SIGTERM', () => {
    logger.info('\n[scheduler] SIGTERM received — shutting down gracefully...');
    shuttingDown = true;
});

/**
 * Parse item count from script stdout.
 * Each script logs differently; we look for common patterns.
 */
function parseItemCount(stdout) {
    if (!stdout) return 0;

    // Look for "Found N" patterns (most scripts log this)
    const foundMatch = stdout.match(/Found (\d+)\b/i);
    const foundCount = foundMatch ? parseInt(foundMatch[1]) : 0;

    // If found 0, return 0 immediately
    if (foundCount === 0 && foundMatch) return 0;

    // Look for processing summary patterns
    const patterns = [
        /Processed:\s*(\d+)/i,
        /Published:\s*(\d+)/i,
        /Watermarked:\s*(\d+)/i,
        /Generated:\s*(\d+)/i,
        /Uploaded:\s*(\d+)/i,
        /Enriched:\s*(\d+)/i,
        /Video media uploads:\s*(\d+)/i,
        /videos?\s+processed/i,
    ];

    for (const pattern of patterns) {
        const match = stdout.match(pattern);
        if (match && match[1]) return parseInt(match[1]);
    }

    // Fallback: if "Found N" with N > 0, use that
    return foundCount;
}

/**
 * Read step's videosDone from progress.json (written by the script itself)
 */
function readStepVideosDone(stepName) {
    const progress = readProgressFile();
    return parseInt(progress.steps?.[stepName]?.videosDone) || 0;
}

// ─────────────────────────────────────────────────
// Stop mechanism — PID files + .stop sentinel file
// ─────────────────────────────────────────────────

function shouldStop() {
    if (shuttingDown) return true;
    try { accessSync(STOP_FILE); return true; } catch { return false; }
}

function writePidFile(pid) {
    try { writeFileSync(PID_FILE, String(pid)); } catch {}
}

function writeChildPids(runningChildren) {
    const pids = [...runningChildren.values()].map(c => c.pid).filter(Boolean).join('\n');
    try { writeFileSync(CHILDREN_PID_FILE, pids); } catch {}
}

function cleanupPidFiles() {
    for (const f of [PID_FILE, CHILDREN_PID_FILE, STOP_FILE]) {
        try { unlinkSync(f); } catch {}
    }
}

async function waitForChildren(runningChildren, timeoutMs) {
    const start = Date.now();
    while (runningChildren.size > 0 && Date.now() - start < timeoutMs) {
        for (const [name, child] of runningChildren) {
            if (child.proc.exitCode !== null) runningChildren.delete(name);
        }
        if (runningChildren.size > 0) await sleep(1000);
    }
    for (const [name, child] of runningChildren) {
        try { child.proc.kill('SIGTERM'); } catch {}
        logger.warn(`[scheduler] Force killed ${name} (PID ${child.pid})`);
        runningChildren.delete(name);
    }
}

// ─────────────────────────────────────────────────
// Scheduler — DB-driven work availability
// ─────────────────────────────────────────────────

async function cleanupStuckVideos() {
    try {
        // Only transition statuses where needs_review is a valid target
        const { rows } = await query(`
            SELECT id, status FROM videos
            WHERE status NOT IN ('published','rejected','needs_review','dmca_removed')
              AND (video_url IS NULL OR video_url = '')
              AND updated_at < NOW() - INTERVAL '5 minutes'
        `);
        let moved = 0;
        for (const row of rows) {
            if (!canTransition(row.status, 'needs_review')) {
                logger.warn(`[scheduler] Cannot move video ${row.id} from "${row.status}" to "needs_review" — skipping`);
                continue;
            }
            await query(`UPDATE videos SET status='needs_review', updated_at=NOW() WHERE id = $1`, [row.id]);
            moved++;
        }
        if (moved > 0) logger.info(`[scheduler] Moved ${moved} video(s) without video_url to needs_review`);
    } catch {}
}

async function getWorkAvailability() {
    try {
        const { rows } = await query(`
            SELECT
                (SELECT COUNT(*) FROM raw_videos WHERE status='pending') AS ai_ready,
                (SELECT COUNT(*) FROM videos WHERE status IN ('enriched','auto_recognized')
                 AND video_url IS NOT NULL AND video_url != ''
                 AND (video_url_watermarked IS NULL OR video_url_watermarked = '')) AS watermark_ready,
                (SELECT COUNT(*) FROM videos WHERE status='watermarked'
                 AND (thumbnail_url IS NULL OR thumbnail_url NOT LIKE '%b-cdn.net%')) AS thumbnail_ready,
                (SELECT COUNT(*) FROM videos WHERE status='watermarked'
                 AND (video_url_watermarked LIKE 'tmp/%' OR thumbnail_url LIKE 'tmp/%')) AS cdn_ready,
                (SELECT COUNT(*) FROM videos WHERE status='watermarked'
                 AND video_url_watermarked LIKE '%b-cdn.net%'
                 AND thumbnail_url LIKE '%b-cdn.net%') AS publish_ready,
                (SELECT COUNT(*) FROM videos WHERE status IN ('watermarked','published')
                 AND video_url_watermarked LIKE '%b-cdn.net%'
                 AND preview_url IS NULL) AS preview_ready
        `);
        const r = rows[0];
        return {
            'scrape': 0, // scrape is always triggered once at pipeline start, not by DB state
            'ai-process': parseInt(r.ai_ready) || 0,
            'visual-recognize': 0,
            'tmdb-enrich': 0,
            'watermark': parseInt(r.watermark_ready) || 0,
            'thumbnails': parseInt(r.thumbnail_ready) || 0,
            'cdn-upload': parseInt(r.cdn_ready) || 0,
            'preview-generate': parseInt(r.preview_ready) || 0,
            'publish': parseInt(r.publish_ready) || 0,
        };
    } catch (err) {
        logger.error(`[scheduler] getWorkAvailability failed: ${err.message}`);
        return {};
    }
}

// TMDB enrich: triggered ONCE after each ai-process completion
let _enrichTriggered = false; // set to true when ai-process finishes, reset after tmdb-enrich runs
async function checkEnrichNeeded() {
    if (!_enrichTriggered) return 0;
    try {
        const { rows } = await query(`
            SELECT COUNT(DISTINCT c.id) AS cnt
            FROM celebrities c
            JOIN video_celebrities vc ON vc.celebrity_id = c.id
            JOIN videos v ON v.id = vc.video_id
            WHERE c.tmdb_id IS NULL
              AND v.status IN ('enriched','auto_recognized')
        `);
        return parseInt(rows[0].cnt) || 0;
    } catch { return 0; }
}

function spawnStepProcess(step, args) {
    const scriptPath = join(__dirname, step.script);
    return spawn('node', [scriptPath, ...step.args, ...args], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
    });
}

function mapStatusToStep(video) {
    switch (video.status) {
        case 'new': return 'ai-process';
        case 'enriched': case 'auto_recognized':
            return (video.video_url_watermarked && video.video_url_watermarked !== '') ? 'thumbnails' : 'watermark';
        case 'watermarked':
            if (video.video_url_watermarked?.startsWith('tmp/') || video.thumbnail_url?.startsWith('tmp/')) return 'cdn-upload';
            return 'publish';
        default: return video.status;
    }
}

async function buildVideoJourneys() {
    try {
        const { rows } = await query(`
            SELECT v.id, v.title->>'en' AS title, v.status, v.updated_at,
                   v.video_url_watermarked, v.thumbnail_url
            FROM videos
            WHERE status NOT IN ('published', 'rejected', 'needs_review')
            ORDER BY created_at DESC LIMIT 20
        `);
        return rows.map(v => ({
            id: v.id,
            title: v.title || v.id.slice(0, 8),
            status: v.status,
            currentStep: mapStatusToStep(v),
            updatedAt: v.updated_at,
        }));
    } catch { return []; }
}

// ─────────────────────────────────────────────────
// runScheduler — main scheduler loop
// ─────────────────────────────────────────────────

async function runScheduler(stepsToRun, extraArgs, testMode, pipelineStart) {
    const maxPerStep = testMode ? 1 : MAX_PER_STEP;
    const runningChildren = new Map();
    const stepStats = {};

    for (const step of stepsToRun) {
        stepStats[step.name] = { totalProcessed: 0, runs: 0, errors: [], lastDuration: 0 };
    }

    writePidFile(process.pid);
    logger.info(`\n🎯 SCHEDULER MODE — max ${maxPerStep} videos/step, check every ${SCHEDULER_INTERVAL / 1000}s`);
    logger.info(`PID: ${process.pid}`);

    let consecutiveEmpty = 0;

    while (!shouldStop()) {
        // 1. Collect finished children
        for (const [stepName, child] of runningChildren) {
            if (child.proc.exitCode !== null) {
                const elapsed = Date.now() - child.startedAt;
                const stats = stepStats[stepName];
                stats.runs++;
                stats.lastDuration = elapsed;

                const processed = parseItemCount(child.stdout) || readStepVideosDone(stepName);
                if (processed > stats.totalProcessed) stats.totalProcessed = processed;

                if (child.proc.exitCode !== 0) {
                    const errMsg = child.stderr.slice(-300).trim() || `exit code ${child.proc.exitCode}`;
                    stats.errors.push({ run: stats.runs, error: errMsg });
                    logger.warn(`[scheduler] ${stepName} failed (exit ${child.proc.exitCode}): ${errMsg.slice(0, 100)}`);
                } else {
                    logger.info(`[scheduler] ${stepName} done in ${(elapsed / 1000).toFixed(1)}s (processed: ${processed})`);
                    // Trigger TMDB enrich after ai-process completes
                    if (stepName === 'ai-process') _enrichTriggered = true;
                    // Reset trigger after tmdb-enrich completes (don't re-run until next ai-process)
                    if (stepName === 'tmdb-enrich') _enrichTriggered = false;
                }

                markStepDone(stepName, {
                    videosDone: stats.totalProcessed,
                    videosTotal: stats.totalProcessed,
                    elapsedMs: elapsed,
                });
                runningChildren.delete(stepName);
                await logPipelineStep(stepName, child.proc.exitCode === 0 ? 'completed' : 'failed', {
                    duration: (elapsed / 1000).toFixed(1), processed,
                }).catch(() => {});
            }
        }

        // 2. CONVEYOR BELT: all steps run in parallel, each processes up to 3 videos
        // Each step only picks up videos that FINISHED the previous step
        // Videos flow: scrape → ai → tmdb → watermark → thumbnails → cdn → publish

        await cleanupStuckVideos();
        const work = await getWorkAvailability();

        // Scrape runs once at the start
        if (stepStats['scrape'] && stepStats['scrape'].runs === 0 && !runningChildren.has('scrape')) {
            work['scrape'] = 1;
        }

        // tmdb-enrich: only runs once after ai-process finishes, then waits for next ai-process
        if (_enrichTriggered && !runningChildren.has('tmdb-enrich')) {
            const enrichNeeded = await checkEnrichNeeded();
            if (enrichNeeded > 0) {
                work['tmdb-enrich'] = enrichNeeded;
            } else {
                _enrichTriggered = false; // no celebrities to enrich — skip
            }
        }

        // 3. Spawn ALL steps that have work and aren't already running
        for (const step of stepsToRun) {
            if (runningChildren.has(step.name)) continue;
            const available = work[step.name] || 0;
            if (available <= 0) continue;

            const stepArgs = [`--limit=${maxPerStep}`, ...extraArgs];
            if (testMode && !stepArgs.includes('--test')) stepArgs.push('--test');

            const proc = spawnStepProcess(step, stepArgs);
            const child = { proc, pid: proc.pid, startedAt: Date.now(), stdout: '', stderr: '' };
            proc.stdout.on('data', (d) => { child.stdout += d.toString(); });
            proc.stderr.on('data', (d) => { child.stderr += d.toString(); });
            proc.on('error', (err) => { child.stderr += err.message; });

            runningChildren.set(step.name, child);
            writeStepStatus(step.name, 'active', { stepLabel: step.label });
            logger.info(`[scheduler] ▶ ${step.name} (PID ${proc.pid}) — ${available} videos ready`);
        }

        // 4. Write child PIDs
        writeChildPids(runningChildren);

        // 5. Per-video journey + progress
        const videos = await buildVideoJourneys();
        writeVideoJourneys(videos);

        const activeNames = [...runningChildren.keys()];
        const completedCount = stepsToRun.filter(s =>
            stepStats[s.name].runs > 0 && !runningChildren.has(s.name)
        ).length;

        writePipelineProgress({
            totalSteps: stepsToRun.length,
            completedSteps: completedCount,
            currentStep: 'scheduler',
            currentLabel: activeNames.length > 0 ? `Running: ${activeNames.join(', ')}` : 'Checking...',
            elapsedMs: Date.now() - pipelineStart,
            status: 'running',
            mode: 'scheduler',
        });

        // 6. Check done
        const totalWork = Object.values(work).reduce((s, v) => s + (v || 0), 0);
        if (runningChildren.size === 0 && totalWork === 0) {
            consecutiveEmpty++;
            if (consecutiveEmpty >= 3) {
                logger.info('[scheduler] No work remaining — pipeline complete');
                break;
            }
        } else {
            consecutiveEmpty = 0;
        }

        await sleep(SCHEDULER_INTERVAL);
    }

    // Wait for running children
    if (runningChildren.size > 0) {
        logger.info(`[scheduler] Stopping — waiting for ${runningChildren.size} step(s)...`);
        await waitForChildren(runningChildren, 60000);
    }

    cleanupPidFiles();

    return stepsToRun.map(step => {
        const stats = stepStats[step.name];
        const stepResult = readStepResult(step.name);
        return {
            step: step.name,
            success: stats.errors.length === 0,
            duration: ((stats.lastDuration || 0) / 1000).toFixed(1),
            processed: stats.totalProcessed,
            runs: stats.runs,
            errors: stats.errors.length,
            videoErrors: stepResult?.errorCount || 0,
            videoErrorDetails: stepResult?.errors || [],
        };
    });
}

// ============================================
// Sequential Mode (classic)
// ============================================

async function runSequential(stepsToRun, extraArgs, testMode, pipelineStart) {
    logger.info('\n📋 SEQUENTIAL MODE — steps run one after another');
    const results = [];

    for (let i = 0; i < stepsToRun.length; i++) {
        if (shouldStop()) {
            logger.info('[sequential] Stop signal — aborting');
            break;
        }
        const step = stepsToRun[i];

        writePipelineProgress({
            totalSteps: stepsToRun.length,
            completedSteps: i,
            currentStep: step.name,
            currentLabel: step.label,
            elapsedMs: Date.now() - pipelineStart,
        });

        const result = await runStep(step, extraArgs, testMode);
        const stepProcessed = parseItemCount(result.stdout) || parseInt(readStepVideosDone(step.name)) || 0;
        results.push({ step: step.name, ...result, processed: stepProcessed, runs: 1, errors: result.success ? 0 : 1 });

        // Mark step done in progress
        markStepDone(step.name, {
            elapsedMs: Math.round(parseFloat(result.duration) * 1000),
        });

        writePipelineProgress({
            totalSteps: stepsToRun.length,
            completedSteps: i + 1,
            currentStep: step.name,
            currentLabel: step.label,
            elapsedMs: Date.now() - pipelineStart,
        });

        if (!result.success && step.required) {
            logger.error(`Required step ${step.name} failed — stopping pipeline`);
            break;
        }
    }

    return results;
}

// ============================================
// Pipeline Stats
// ============================================

async function getPipelineStats() {
    const stats = {};

    const queries = {
        raw_pending: `SELECT COUNT(*) FROM raw_videos WHERE status = 'pending'`,
        raw_processed: `SELECT COUNT(*) FROM raw_videos WHERE status = 'processed'`,
        videos_new: `SELECT COUNT(*) FROM videos WHERE status = 'new'`,
        videos_enriched: `SELECT COUNT(*) FROM videos WHERE status IN ('enriched', 'auto_recognized')`,
        videos_watermarked: `SELECT COUNT(*) FROM videos WHERE status = 'watermarked'`,
        videos_published: `SELECT COUNT(*) FROM videos WHERE status = 'published'`,
        videos_needs_review: `SELECT COUNT(*) FROM videos WHERE status = 'needs_review'`,
        celebrities_total: `SELECT COUNT(*) FROM celebrities`,
        celebrities_enriched: `SELECT COUNT(*) FROM celebrities WHERE tmdb_id IS NOT NULL`,
        movies_total: `SELECT COUNT(*) FROM movies`,
        movies_enriched: `SELECT COUNT(*) FROM movies WHERE tmdb_id IS NOT NULL`,
        tags_total: `SELECT COUNT(*) FROM tags`,
    };

    for (const [key, sql] of Object.entries(queries)) {
        try {
            const { rows } = await query(sql);
            stats[key] = parseInt(rows[0].count);
        } catch {
            stats[key] = '?';
        }
    }

    return stats;
}

function printStats(stats, label) {
    logger.info(`\n${label}`);
    logger.info('─'.repeat(40));
    logger.info(`Raw videos:    pending=${stats.raw_pending}, processed=${stats.raw_processed}`);
    logger.info(`Videos:        new=${stats.videos_new}, enriched=${stats.videos_enriched}, watermarked=${stats.videos_watermarked}, published=${stats.videos_published}, review=${stats.videos_needs_review}`);
    logger.info(`Celebrities:   total=${stats.celebrities_total}, TMDB-enriched=${stats.celebrities_enriched}`);
    logger.info(`Movies:        total=${stats.movies_total}, TMDB-enriched=${stats.movies_enriched}`);
    logger.info(`Tags:          total=${stats.tags_total}`);
}

// ============================================
// Final Validation — check data integrity after pipeline
// ============================================

async function runFinalValidation() {
    logger.info('\n🔍 Running final validation...');

    const report = [];
    let critical = 0;
    let warnings = 0;

    // 1. Published videos with non-CDN video_url (will expire!)
    try {
        const { rows } = await query(`
            SELECT id, COALESCE(title->>'en', id::text) as title, video_url
            FROM videos WHERE status = 'published'
            AND video_url IS NOT NULL
            AND video_url NOT LIKE '%b-cdn.net%'
            AND 1=1  -- cdn.celeb.skin removed, only check b-cdn.net
        `);
        if (rows.length > 0) {
            critical++;
            report.push({
                level: 'critical',
                code: 'NON_CDN_VIDEO_URL',
                message: `${rows.length} published video(s) have expiring source URLs (not CDN)`,
                items: rows.map(r => `${r.title} → ${(r.video_url || '').substring(0, 60)}...`),
            });
        }
    } catch (err) {
        logger.warn(`  Validation query failed: ${err.message}`);
    }

    // 2. Published videos without CDN thumbnails
    try {
        const { rows } = await query(`
            SELECT id, COALESCE(title->>'en', id::text) as title, thumbnail_url
            FROM videos WHERE status = 'published'
            AND (thumbnail_url IS NULL
                 OR thumbnail_url NOT LIKE '%b-cdn.net%')
        `);
        if (rows.length > 0) {
            critical++;
            report.push({
                level: 'critical',
                code: 'NON_CDN_THUMBNAIL',
                message: `${rows.length} published video(s) without CDN thumbnails`,
                items: rows.map(r => `${r.title} → ${(r.thumbnail_url || 'NULL').substring(0, 60)}`),
            });
        }
    } catch (err) {
        logger.warn(`  Validation query failed: ${err.message}`);
    }

    // 3. Published videos without watermark
    try {
        const { rows } = await query(`
            SELECT id, COALESCE(title->>'en', id::text) as title
            FROM videos WHERE status = 'published'
            AND (video_url_watermarked IS NULL OR video_url_watermarked = '')
        `);
        if (rows.length > 0) {
            critical++;
            report.push({
                level: 'critical',
                code: 'NO_WATERMARK',
                message: `${rows.length} published video(s) without watermark`,
                items: rows.map(r => r.title),
            });
        }
    } catch (err) {
        logger.warn(`  Validation query failed: ${err.message}`);
    }

    // 4. Celebrities without photos
    try {
        const { rows } = await query(`
            SELECT c.id, c.name, c.tmdb_id,
                   (SELECT COUNT(*) FROM video_celebrities vc
                    JOIN videos v ON v.id = vc.video_id
                    WHERE vc.celebrity_id = c.id AND v.status = 'published') as pub_videos
            FROM celebrities c
            WHERE (c.photo_url IS NULL OR c.photo_url = '')
            AND EXISTS (SELECT 1 FROM video_celebrities vc
                        JOIN videos v ON v.id = vc.video_id
                        WHERE vc.celebrity_id = c.id AND v.status = 'published')
        `);
        if (rows.length > 0) {
            warnings++;
            report.push({
                level: 'warning',
                code: 'CELEBRITY_NO_PHOTO',
                message: `${rows.length} celebrity(s) with published videos but no photo`,
                items: rows.map(r => `${r.name} (${r.pub_videos} videos, tmdb=${r.tmdb_id || 'none'})`),
            });
        }
    } catch (err) {
        logger.warn(`  Validation query failed: ${err.message}`);
    }

    // 5. Published videos without sprite/preview
    try {
        const { rows } = await query(`
            SELECT id, COALESCE(title->>'en', id::text) as title
            FROM videos WHERE status = 'published'
            AND (sprite_url IS NULL OR preview_gif_url IS NULL)
        `);
        if (rows.length > 0) {
            warnings++;
            report.push({
                level: 'warning',
                code: 'MISSING_PREVIEWS',
                message: `${rows.length} published video(s) missing sprite or preview GIF`,
                items: rows.map(r => r.title),
            });
        }
    } catch (err) {
        logger.warn(`  Validation query failed: ${err.message}`);
    }

    // 6. Videos stuck in intermediate states
    try {
        const { rows } = await query(`
            SELECT status, COUNT(*) as cnt
            FROM videos
            WHERE status IN ('watermarked', 'enriched', 'auto_recognized', 'new')
            GROUP BY status
        `);
        if (rows.length > 0) {
            const items = rows.map(r => `${r.status}: ${r.cnt}`);
            warnings++;
            report.push({
                level: 'warning',
                code: 'STUCK_VIDEOS',
                message: `Videos in intermediate states: ${items.join(', ')}`,
                items,
            });
        }
    } catch (err) {
        logger.warn(`  Validation query failed: ${err.message}`);
    }

    if (report.length === 0) {
        logger.info('  ✅ All validation checks passed!');
    } else {
        logger.info(`  Found: ${critical} critical, ${warnings} warnings`);
    }

    return { critical, warnings, report };
}

// ============================================
// Main
// ============================================

async function main() {
    const args = parseArgs();
    const testMode = args.test;
    const startStep = args.step || 1;
    const onlyStep = args.only;
    const skipSteps = new Set(args.skip || []);
    const isSequential = args.sequential;

    logger.info('═'.repeat(60));
    logger.info('  CelebSkin — Full Automation Pipeline');
    logger.info('═'.repeat(60));
    logger.info(`Mode: ${isSequential ? 'SEQUENTIAL' : 'SCHEDULER'} ${testMode ? '(TEST)' : '(PRODUCTION)'}`);
    logger.info(`Time: ${new Date().toISOString()}`);

    // Show initial stats
    const statsBefore = await getPipelineStats();
    printStats(statsBefore, 'BEFORE PIPELINE');

    const pipelineStart = Date.now();

    // Filter steps based on args
    let stepsToRun = STEPS.filter((_, i) => i + 1 >= startStep);

    if (onlyStep) {
        stepsToRun = STEPS.filter(s => s.name === onlyStep);
        if (stepsToRun.length === 0) {
            logger.error(`Unknown step: ${onlyStep}. Available: ${STEPS.map(s => s.name).join(', ')}`);
            process.exit(1);
        }
    }

    stepsToRun = stepsToRun.filter(s => !skipSteps.has(s.name));

    logger.info(`\nSteps to run: ${stepsToRun.map(s => s.name).join(' → ')}`);

    // Build extra args
    const extraArgs = [];
    if (args.limit) extraArgs.push(`--limit=${args.limit}`);
    if (args.autoPublish) extraArgs.push('--auto');

    // Clear stale progress and initialize step panels
    clearAllProgress();
    initSteps(stepsToRun.map(s => ({ name: s.name, label: s.label })));

    writePipelineProgress({
        totalSteps: stepsToRun.length,
        completedSteps: 0,
        currentStep: stepsToRun[0]?.name || '',
        currentLabel: stepsToRun[0]?.label || '',
        elapsedMs: 0,
        mode: isSequential ? 'sequential' : 'scheduler',
    });

    // Run pipeline
    let results;
    if (isSequential) {
        results = await runSequential(stepsToRun, extraArgs, testMode, pipelineStart);
    } else {
        results = await runScheduler(stepsToRun, extraArgs, testMode, pipelineStart);
    }

    // ============================================
    // Final Validation — check published videos integrity
    // ============================================
    const validationIssues = await runFinalValidation();

    // Write final pipeline status (don't clear — keep results visible)
    const totalDuration = ((Date.now() - pipelineStart) / 1000).toFixed(1);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    // Collect per-video errors across all steps
    const totalVideoErrors = results.reduce((sum, r) => sum + (r.videoErrors || 0), 0);
    const stepsWithErrors = results.filter(r => (r.videoErrors || 0) > 0);

    // Determine final status — strict: any errors = not clean success
    let finalStatus = 'finished';
    if (failed > 0 || validationIssues.critical > 0) {
        finalStatus = 'finished_with_errors';
    } else if (totalVideoErrors > 0) {
        finalStatus = 'finished_with_errors';
    } else if (validationIssues.warnings > 0) {
        finalStatus = 'finished_with_warnings';
    }

    writePipelineProgress({
        totalSteps: stepsToRun.length,
        completedSteps: successful,
        currentStep: 'done',
        currentLabel: finalStatus === 'finished' ? 'Pipeline Complete ✓' :
                      finalStatus === 'finished_with_errors' ? 'Pipeline Complete ⚠️ WITH ERRORS' :
                      'Pipeline Complete (with warnings)',
        elapsedMs: Date.now() - pipelineStart,
        status: finalStatus,
        mode: isSequential ? 'sequential' : 'scheduler',
        stepTimings: results.map(r => ({
            step: r.step,
            success: r.success,
            duration: parseFloat(r.duration),
            processed: r.processed || 0,
            runs: r.runs || 1,
            videoErrors: r.videoErrors || 0,
            videoErrorDetails: (r.videoErrorDetails || []).slice(0, 5),
        })),
        totalVideoErrors,
        validation: validationIssues.report,
    });

    // Show final stats
    const statsAfter = await getPipelineStats();
    printStats(statsAfter, 'AFTER PIPELINE');

    // Show pipeline summary
    logger.info('\n' + '═'.repeat(60));
    logger.info('PIPELINE SUMMARY');
    logger.info('═'.repeat(60));
    logger.info(`Total time: ${totalDuration}s`);
    logger.info(`Mode: ${isSequential ? 'sequential' : 'scheduler'}`);
    logger.info(`Status: ${finalStatus.toUpperCase()}`);
    logger.info(`Steps: ${successful} succeeded, ${failed} failed`);
    if (totalVideoErrors > 0) {
        logger.info(`Video errors: ${totalVideoErrors} across ${stepsWithErrors.length} step(s)`);
    }
    logger.info('');

    for (const result of results) {
        const hasVideoErrs = (result.videoErrors || 0) > 0;
        const icon = !result.success ? '✗' : hasVideoErrs ? '⚠' : '✓';
        const extra = result.runs > 1 ? ` (${result.runs} runs, ${result.processed} processed)` : '';
        const errInfo = hasVideoErrs ? ` — ${result.videoErrors} video error(s)` : '';
        logger.info(`  ${icon} ${result.step} (${result.duration}s)${extra}${errInfo}${result.error ? ` — ${result.error}` : ''}`);
    }

    // Detailed per-step error report
    if (totalVideoErrors > 0) {
        logger.info('\n' + '─'.repeat(40));
        logger.info('PER-STEP ERROR DETAILS');
        logger.info('─'.repeat(40));
        for (const result of stepsWithErrors) {
            logger.error(`\n❌ ${result.step}: ${result.videoErrors} error(s)`);
            for (const err of (result.videoErrorDetails || []).slice(0, 10)) {
                logger.error(`  - ${err.id || err.title || 'unknown'}: ${err.error || 'unknown error'}`);
            }
            if ((result.videoErrorDetails || []).length > 10) {
                logger.error(`  ... and ${result.videoErrorDetails.length - 10} more`);
            }
        }
    }

    // Validation report
    if (validationIssues.critical > 0 || validationIssues.warnings > 0) {
        logger.info('\n' + '─'.repeat(40));
        logger.info('VALIDATION REPORT');
        logger.info('─'.repeat(40));
        for (const issue of validationIssues.report) {
            const icon = issue.level === 'critical' ? '❌' : '⚠️';
            logger.info(`  ${icon} ${issue.message}`);
            if (issue.items?.length > 0) {
                for (const item of issue.items.slice(0, 5)) {
                    logger.info(`    - ${item}`);
                }
                if (issue.items.length > 5) {
                    logger.info(`    ... and ${issue.items.length - 5} more`);
                }
            }
        }
    }

    // Changes
    logger.info('\nChanges:');
    for (const [key, val] of Object.entries(statsAfter)) {
        const before = statsBefore[key];
        if (before !== val && before !== '?' && val !== '?') {
            const diff = val - before;
            if (diff !== 0) {
                logger.info(`  ${key}: ${before} → ${val} (${diff > 0 ? '+' : ''}${diff})`);
            }
        }
    }

    logger.info('\n═'.repeat(60));

    // Exit with error code if critical issues found
    if (failed > 0 && results.some(r => !r.success && STEPS.find(s => s.name === r.step)?.required)) {
        process.exit(1);
    }
    if (validationIssues.critical > 0) {
        logger.error(`\n⛔ Pipeline finished with ${validationIssues.critical} critical validation issues!`);
        process.exit(2);
    }
}

function parseArgs() {
    const args = { test: false, step: null, only: null, skip: [], limit: null, autoPublish: false, sequential: false };
    for (const arg of process.argv.slice(2)) {
        if (arg === '--test') args.test = true;
        if (arg === '--sequential') args.sequential = true;
        if (arg === '--auto-publish') args.autoPublish = true;
        if (arg.startsWith('--step=')) args.step = parseInt(arg.split('=')[1]);
        if (arg.startsWith('--only=')) args.only = arg.split('=')[1];
        if (arg.startsWith('--skip=')) args.skip.push(arg.split('=')[1]);
        if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1]);
    }
    return args;
}

main().catch(err => {
    logger.error('Pipeline fatal error:', err);
    process.exit(1);
});
