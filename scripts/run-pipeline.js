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
 *   7. Publish → status=published, multilingual slugs (publish-to-site.js)
 *
 * Modes:
 *   Conveyor (default) — all steps run concurrently as polling workers
 *   Sequential (--sequential) — classic mode, steps run one after another
 *
 * Usage:
 *   node run-pipeline.js                    # conveyor mode (default)
 *   node run-pipeline.js --sequential       # classic sequential mode
 *   node run-pipeline.js --test             # test mode (limit=1 per step)
 *   node run-pipeline.js --step=2           # start from specific step
 *   node run-pipeline.js --only=scrape      # run only one step
 *   node run-pipeline.js --skip=watermark   # skip specific step
 *   node run-pipeline.js --limit=10         # limit items per step
 *   node run-pipeline.js --auto-publish     # auto-publish high confidence
 */

import dotenv from 'dotenv';
dotenv.config();

import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query } from './lib/db.js';
import logger from './lib/logger.js';
import {
    writePipelineProgress, clearAllProgress, initSteps,
    markStepDone, writeStepStatus, readProgressFile, readStepResult,
} from './lib/progress.js';

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
// Conveyor Belt Mode
// ============================================

const CONVEYOR_DEFAULTS = {
    pollInterval: 10000,    // 10 sec between polls
    maxIdlePolls: 6,        // 6 consecutive empty polls → check if done
    staggerDelay: 3000,     // 3 sec between launching workers
    batchLimit: 3,          // videos per run (normal)
    testBatchLimit: 1,      // videos per run (test mode)
};

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Check if there are videos still flowing through the pipeline.
 * Prevents workers from marking themselves "done" prematurely.
 */
async function hasInFlightVideos() {
    try {
        const { rows } = await query(`
            SELECT
                (SELECT COUNT(*) FROM raw_videos WHERE status = 'pending') AS raw_pending,
                (SELECT COUNT(*) FROM videos
                 WHERE status NOT IN ('published', 'rejected', 'needs_review')
                ) AS videos_wip
        `);
        const rawPending = parseInt(rows[0].raw_pending) || 0;
        const videosWip = parseInt(rows[0].videos_wip) || 0;
        return { inFlight: rawPending > 0 || videosWip > 0, rawPending, videosWip };
    } catch {
        return { inFlight: false, rawPending: 0, videosWip: 0 };
    }
}

// Graceful shutdown
let shuttingDown = false;
let draining = false;  // drain mode: stop scrape, finish the rest
process.on('SIGINT', () => {
    logger.info('\n[conveyor] SIGINT received — shutting down gracefully...');
    shuttingDown = true;
});
process.on('SIGTERM', () => {
    logger.info('\n[conveyor] SIGTERM received — shutting down gracefully...');
    shuttingDown = true;
});
process.on('SIGUSR1', () => {
    logger.info('\n[conveyor] SIGUSR1 received — drain mode: stop scraping, finish in-progress videos...');
    draining = true;
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
    return progress.steps?.[stepName]?.videosDone || 0;
}

/**
 * Run a single step as a conveyor worker — polls for work in a loop.
 */
async function runStepWorker(step, stepState, allStepStates, extraArgs, testMode, config) {
    const state = stepState;
    const stepStart = Date.now();

    // Initial stagger delay to avoid all steps hitting DB at once
    if (config.staggerIndex > 0) {
        state.phase = 'waiting';
        writeStepStatus(step.name, 'waiting', {
            stepLabel: step.label,
        });
        await sleep(config.staggerIndex * config.staggerDelay);
    }

    // Dependencies are checked at idle termination (not at startup).
    // Workers start polling immediately — scripts query DB for available work.
    // This enables true conveyor: downstream starts as soon as upstream produces items.
    const deps = step.deps || [];

    // Build args for conveyor mode (small batch limit)
    const batchLimit = testMode ? config.testBatchLimit : config.batchLimit;
    const conveyorArgs = extraArgs.filter(a => !a.startsWith('--limit='));
    conveyorArgs.push(`--limit=${batchLimit}`);

    // Polling loop
    while (!shuttingDown) {
        state.phase = 'running';
        state.lastRunAt = Date.now();
        state.totalRuns++;

        const result = await runStep(step, conveyorArgs, false); // testMode handled via batchLimit

        // Determine how many items were processed
        let itemsProcessed = 0;
        if (result.success) {
            // Read from progress.json (script writes videosDone via completeStep)
            const videosDone = readStepVideosDone(step.name);
            // Also parse stdout as fallback
            const stdoutCount = parseItemCount(result.stdout);
            itemsProcessed = Math.max(videosDone, stdoutCount);
        }

        if (!result.success) {
            state.errors.push({ run: state.totalRuns, error: result.error?.substring(0, 200) });
            state.consecutiveIdle++;
            logger.warn(`[conveyor] ${step.name} run #${state.totalRuns} failed: ${result.error?.substring(0, 100)}`);

            if (step.required && state.errors.length >= 3) {
                logger.error(`[conveyor] Required step ${step.name} failed ${state.errors.length} times — stopping worker`);
                state.phase = 'failed';
                state.completed = true;
                return buildWorkerResult(step, state, stepStart);
            }
        } else if (itemsProcessed === 0) {
            state.consecutiveIdle++;
            logger.info(`[conveyor] ${step.name} run #${state.totalRuns} — 0 items (idle ${state.consecutiveIdle}/${config.maxIdlePolls})`);
        } else {
            state.totalProcessed += itemsProcessed;
            state.consecutiveIdle = 0;
            logger.info(`[conveyor] ${step.name} run #${state.totalRuns} — processed ${itemsProcessed} items (total: ${state.totalProcessed})`);
        }

        // Update pipeline progress
        const activeWorkers = Object.entries(allStepStates)
            .filter(([, s]) => s.phase === 'running')
            .map(([name]) => name);
        const completedWorkers = Object.values(allStepStates).filter(s => s.completed).length;

        writePipelineProgress({
            totalSteps: Object.keys(allStepStates).length,
            completedSteps: completedWorkers,
            currentStep: 'conveyor',
            currentLabel: `Active: ${activeWorkers.join(', ') || 'polling...'}`,
            elapsedMs: Date.now() - config.pipelineStart,
            status: 'running',
            mode: 'conveyor',
        });

        // Check if this worker should stop
        if (state.consecutiveIdle >= config.maxIdlePolls) {
            // Are all upstream deps done?
            const allDepsDone = deps.every(depName => allStepStates[depName]?.completed);

            if (allDepsDone || deps.length === 0) {
                // Upstream is done — but check DB for in-flight videos before quitting
                const { inFlight, rawPending, videosWip } = await hasInFlightVideos();
                if (inFlight) {
                    // Videos still flowing through pipeline — keep polling
                    state.consecutiveIdle = 0;
                    logger.info(`[conveyor] ${step.name} — deps done but ${rawPending} raw pending + ${videosWip} videos WIP in DB, continuing to poll`);
                } else {
                    // Nothing in flight — we're truly done
                    logger.info(`[conveyor] ${step.name} — no more work, marking done (${state.totalProcessed} total processed)`);
                    state.phase = 'completed';
                    state.completed = true;

                    markStepDone(step.name, {
                        videosDone: state.totalProcessed,
                        videosTotal: state.totalProcessed,
                        elapsedMs: Date.now() - stepStart,
                    });

                    return buildWorkerResult(step, state, stepStart);
                }
            } else {
                // Upstream still running — reset idle counter and keep polling
                // (upstream may produce more work)
                state.consecutiveIdle = 0;
                logger.info(`[conveyor] ${step.name} — idle but upstream still running, continuing to poll`);
            }
        }

        // In drain mode: if no in-flight videos remain, stop this worker
        if (draining && state.consecutiveIdle >= 2) {
            const { inFlight } = await hasInFlightVideos();
            if (!inFlight) {
                logger.info(`[conveyor] ${step.name} — drain mode: pipeline empty, stopping worker`);
                state.phase = 'completed';
                state.completed = true;
                markStepDone(step.name, {
                    videosDone: state.totalProcessed,
                    videosTotal: state.totalProcessed,
                    elapsedMs: Date.now() - stepStart,
                });
                return buildWorkerResult(step, state, stepStart);
            }
        }

        // Wait before next poll
        state.phase = 'idle';
        writeStepStatus(step.name, 'idle', {
            stepLabel: step.label,
            videosDone: state.totalProcessed,
            videosTotal: state.totalProcessed,
            conveyorRun: state.totalRuns,
        });
        await sleep(config.pollInterval);
    }

    // Graceful shutdown
    state.phase = 'stopped';
    state.completed = true;
    return buildWorkerResult(step, state, stepStart);
}

function buildWorkerResult(step, state, stepStart) {
    // Read step errors from progress.json (written by the script itself)
    const stepResult = readStepResult(step.name);
    const videoErrors = stepResult?.errorCount || 0;
    const videoErrorDetails = stepResult?.errors || [];

    return {
        step: step.name,
        success: state.phase !== 'failed',
        duration: ((Date.now() - stepStart) / 1000).toFixed(1),
        processed: state.totalProcessed,
        runs: state.totalRuns,
        errors: state.errors.length,
        videoErrors,              // per-video errors within the step
        videoErrorDetails,        // error details [{id, title, error}]
    };
}

/**
 * Run a one-shot step as a conveyor worker — runs once, concurrently with polling workers.
 * This lets downstream workers pick up items as they're produced (e.g. scrape inserts videos one-by-one).
 */
async function runOnceWorker(step, stepState, allStepStates, extraArgs, testMode, config) {
    const state = stepState;
    const stepStart = Date.now();

    // Small stagger to not hit DB at same time as other workers
    if (config.staggerIndex > 0) {
        await sleep(config.staggerIndex * config.staggerDelay);
    }

    state.phase = 'running';
    writeStepStatus(step.name, 'active', { stepLabel: step.label });

    const result = await runStep(step, extraArgs, testMode);

    state.totalRuns = 1;
    state.totalProcessed = parseItemCount(result.stdout) || readStepVideosDone(step.name);
    state.phase = result.success ? 'completed' : 'failed';
    state.completed = true;

    markStepDone(step.name, {
        videosDone: state.totalProcessed,
        videosTotal: state.totalProcessed,
        elapsedMs: Date.now() - stepStart,
    });

    return buildWorkerResult(step, state, stepStart);
}

/**
 * Run pipeline in conveyor belt mode — all steps run concurrently.
 * One-shot steps (scrape) run once but IN PARALLEL with polling workers,
 * so downstream workers pick up items as they're produced.
 */
async function runConveyor(stepsToRun, extraArgs, testMode, pipelineStart) {
    logger.info('\n🔄 CONVEYOR MODE — all steps run concurrently');
    logger.info(`Poll interval: ${CONVEYOR_DEFAULTS.pollInterval / 1000}s, Max idle: ${CONVEYOR_DEFAULTS.maxIdlePolls}, Batch: ${testMode ? CONVEYOR_DEFAULTS.testBatchLimit : CONVEYOR_DEFAULTS.batchLimit}`);

    // Initialize state for ALL steps (both one-shot and polling)
    const allStepStates = {};
    for (const step of stepsToRun) {
        allStepStates[step.name] = {
            phase: 'pending',
            consecutiveIdle: 0,
            totalRuns: 0,
            totalProcessed: 0,
            lastRunAt: null,
            errors: [],
            completed: false,
        };
    }

    // Launch ALL workers concurrently — one-shot and polling side by side
    const config = {
        pollInterval: CONVEYOR_DEFAULTS.pollInterval,
        maxIdlePolls: CONVEYOR_DEFAULTS.maxIdlePolls,
        staggerDelay: CONVEYOR_DEFAULTS.staggerDelay,
        batchLimit: CONVEYOR_DEFAULTS.batchLimit,
        testBatchLimit: CONVEYOR_DEFAULTS.testBatchLimit,
        pipelineStart,
    };

    logger.info(`\n[conveyor] Launching ${stepsToRun.length} concurrent workers: ${stepsToRun.map(s => s.name).join(', ')}`);

    let pollingIndex = 0;
    const workerPromises = stepsToRun.map((step) => {
        if (step.runOnce) {
            // One-shot worker: runs once but concurrently with everything else
            return runOnceWorker(step, allStepStates[step.name], allStepStates, extraArgs, testMode, {
                ...config,
                staggerIndex: 0,  // one-shot starts immediately (no stagger)
            });
        } else {
            // Polling worker: loops until idle
            const idx = pollingIndex++;
            return runStepWorker(step, allStepStates[step.name], allStepStates, extraArgs, testMode, {
                ...config,
                staggerIndex: idx,
            });
        }
    });

    const results = await Promise.all(workerPromises);
    return results;
}

// ============================================
// Sequential Mode (classic)
// ============================================

async function runSequential(stepsToRun, extraArgs, testMode, pipelineStart) {
    logger.info('\n📋 SEQUENTIAL MODE — steps run one after another');
    const results = [];

    for (let i = 0; i < stepsToRun.length; i++) {
        const step = stepsToRun[i];

        writePipelineProgress({
            totalSteps: stepsToRun.length,
            completedSteps: i,
            currentStep: step.name,
            currentLabel: step.label,
            elapsedMs: Date.now() - pipelineStart,
        });

        const result = await runStep(step, extraArgs, testMode);
        results.push({ step: step.name, ...result, processed: 0, runs: 1, errors: result.success ? 0 : 1 });

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
    const isConveyor2 = args.conveyor2;
    const isSequential = args.sequential || !!onlyStep;

    logger.info('═'.repeat(60));
    logger.info('  CelebSkin — Full Automation Pipeline');
    logger.info('═'.repeat(60));
    logger.info(`Mode: ${isConveyor2 ? 'CONVEYOR2 (per-file)' : isSequential ? 'SEQUENTIAL' : 'CONVEYOR'} ${testMode ? '(TEST)' : '(PRODUCTION)'}`);
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
        mode: isSequential ? 'sequential' : 'conveyor',
    });

    // Run pipeline
    let results;
    if (isConveyor2) {
        const { runConveyor: runConveyor2 } = await import('./conveyor.js');
        results = await runConveyor2({
            limit: args.limit,
            skipScrape: skipSteps.has('scrape'),
            skipSteps: args.skip || [],
            pipelineStart,
        });
    } else if (isSequential) {
        results = await runSequential(stepsToRun, extraArgs, testMode, pipelineStart);
    } else {
        results = await runConveyor(stepsToRun, extraArgs, testMode, pipelineStart);
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
        mode: isSequential ? 'sequential' : 'conveyor',
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
    logger.info(`Mode: ${isSequential ? 'sequential' : 'conveyor'}`);
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
    const args = { test: false, step: null, only: null, skip: [], limit: null, autoPublish: false, sequential: false, conveyor2: false };
    for (const arg of process.argv.slice(2)) {
        if (arg === '--test') args.test = true;
        if (arg === '--sequential') args.sequential = true;
        if (arg === '--conveyor2') args.conveyor2 = true;
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
