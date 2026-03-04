#!/usr/bin/env node
/**
 * run-pipeline.js — CelebSkin Full Automation Pipeline
 *
 * Complete flow:
 *   1. Scrape → raw_videos (scrape-boobsradar.js)
 *   2. AI Processing → videos with 10-lang JSONB (process-with-ai.js)
 *   3. TMDB Enrichment → celebrity photos, movie posters (enrich-metadata.js)
 *   4. Watermark → video with celeb.skin overlay (watermark.js)
 *   5. Thumbnails → screenshots + sprite + preview GIF (generate-thumbnails.js)
 *   6. CDN Upload → BunnyCDN (upload-to-cdn.js)
 *   7. Publish → status=published, multilingual slugs (publish-to-site.js)
 *
 * Usage:
 *   node run-pipeline.js                    # full pipeline
 *   node run-pipeline.js --test             # test mode (limit=3 per step)
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
import { writePipelineProgress, clearAllProgress, initSteps } from './lib/progress.js';

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
        timeout: 1800000,  // 30 min (large video downloads)
        required: false,   // Can skip if raw_videos already exist
    },
    {
        name: 'ai-process',
        label: '2. AI Processing (Gemini 2.5 Flash)',
        script: 'process-with-ai.js',
        args: [],
        timeout: 1200000, // 20 min
        required: true,
    },
    {
        name: 'visual-recognize',
        label: '2b. Visual Recognition (Gemini Vision)',
        script: 'visual-recognize.js',
        args: [],
        timeout: 1800000, // 30 min (video downloads + Gemini Vision)
        required: false,
    },
    {
        name: 'tmdb-enrich',
        label: '3. TMDB Enrichment',
        script: 'enrich-metadata.js',
        args: [],
        timeout: 600000,
        required: false,
    },
    {
        name: 'watermark',
        label: '4. Watermarking',
        script: 'watermark.js',
        args: [],
        timeout: 1800000, // 30 min (video processing is slow)
        required: false,
    },
    {
        name: 'thumbnails',
        label: '5. Thumbnail & Sprite Generation',
        script: 'generate-thumbnails.js',
        args: [],
        timeout: 1800000,
        required: false,
    },
    {
        name: 'cdn-upload',
        label: '6. CDN Upload (BunnyCDN)',
        script: 'upload-to-cdn.js',
        args: ['--cleanup'],
        timeout: 1800000,
        required: false,
    },
    {
        name: 'publish',
        label: '7. Publishing',
        script: 'publish-to-site.js',
        args: ['--auto'],
        timeout: 300000,
        required: true,
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
            maxBuffer: 10 * 1024 * 1024, // 10MB output buffer
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        if (stdout) {
            // Show last 20 lines of output (summary)
            const lines = stdout.trim().split('\n');
            const lastLines = lines.slice(-20);
            lastLines.forEach(line => logger.info(`  ${line}`));
        }
        if (stderr && !stderr.includes('ExperimentalWarning')) {
            logger.warn(`  STDERR: ${stderr.substring(0, 500)}`);
        }

        logger.info(`✓ ${step.label} — completed in ${duration}s`);

        // Log pipeline step
        await logPipelineStep(step.name, 'completed', { duration, args }).catch(() => {});

        return { success: true, duration };
    } catch (err) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.error(`✗ ${step.label} — failed after ${duration}s`);
        logger.error(`  Error: ${err.message}`);

        if (err.stdout) {
            const lines = err.stdout.trim().split('\n').slice(-10);
            lines.forEach(line => logger.info(`  ${line}`));
        }

        await logPipelineStep(step.name, 'failed', { duration, error: err.message }).catch(() => {});

        return { success: false, error: err.message, duration };
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
// Main
// ============================================

async function main() {
    const args = parseArgs();
    const testMode = args.test;
    const startStep = args.step || 1;
    const onlyStep = args.only;
    const skipSteps = new Set(args.skip || []);

    logger.info('═'.repeat(60));
    logger.info('  CelebSkin — Full Automation Pipeline');
    logger.info('═'.repeat(60));
    logger.info(`Mode: ${testMode ? 'TEST (limit=3)' : 'PRODUCTION'}`);
    logger.info(`Time: ${new Date().toISOString()}`);

    // Show initial stats
    const statsBefore = await getPipelineStats();
    printStats(statsBefore, 'BEFORE PIPELINE');

    const pipelineStart = Date.now();
    const results = [];

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

    // Initialize all step panels in progress (shows conveyor belt in UI)
    initSteps(stepsToRun.map(s => ({ name: s.name, label: s.label })));

    writePipelineProgress({
        totalSteps: stepsToRun.length,
        completedSteps: 0,
        currentStep: stepsToRun[0]?.name || '',
        currentLabel: stepsToRun[0]?.label || '',
        elapsedMs: 0,
    });

    // Run pipeline steps sequentially with multi-step progress display
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
        results.push({ step: step.name, ...result });

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

    clearAllProgress();

    // Show final stats
    const statsAfter = await getPipelineStats();
    printStats(statsAfter, 'AFTER PIPELINE');

    // Show pipeline summary
    const totalDuration = ((Date.now() - pipelineStart) / 1000).toFixed(1);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    logger.info('\n' + '═'.repeat(60));
    logger.info('PIPELINE SUMMARY');
    logger.info('═'.repeat(60));
    logger.info(`Total time: ${totalDuration}s`);
    logger.info(`Steps: ${successful} succeeded, ${failed} failed`);
    logger.info('');

    for (const result of results) {
        const icon = result.success ? '✓' : '✗';
        logger.info(`  ${icon} ${result.step} (${result.duration}s)${result.error ? ` — ${result.error}` : ''}`);
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

    // Exit with error code if any required step failed
    if (failed > 0 && results.some(r => !r.success && STEPS.find(s => s.name === r.step)?.required)) {
        process.exit(1);
    }
}

function parseArgs() {
    const args = { test: false, step: null, only: null, skip: [], limit: null, autoPublish: false };
    for (const arg of process.argv.slice(2)) {
        if (arg === '--test') args.test = true;
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
