#!/usr/bin/env node
/**
 * pipeline.js — SearchCelebrityHD Complete Pipeline
 *
 * Clean, simple pipeline that runs each step sequentially for each video:
 *   1. Scrape → raw_videos (pending)
 *   2. AI (screenshots) → videos (enriched) with tags, description
 *   3. TMDB Enrich → celebrity photos, movie posters
 *   4. Download + Watermark → watermarked video file
 *   5. CDN Upload → screenshots + watermarked video to BunnyCDN
 *   6. Publish → status=published
 *
 * Key differences from boobsradar pipeline:
 *   - Screenshots already exist (from source site) — no FFmpeg thumbnail generation needed
 *   - AI analyzes screenshots (not video) — no Gemini video blocking
 *   - Sequential per-video processing — no complex scheduler
 *   - No fullPipelineReset — preserves existing data
 *
 * Usage:
 *   node pipeline.js                        # scrape 1 page + process all
 *   node pipeline.js --pages=5              # scrape 5 pages
 *   node pipeline.js --skip-scrape          # process existing pending only
 *   node pipeline.js --limit=10             # limit videos per step
 *   node pipeline.js --url=https://...      # single video URL
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { query } from '../lib/db.js';
import logger from '../lib/logger.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = dirname(__dirname); // parent scripts/ dir

// ============================================
// Run a script and return result
// ============================================

async function runScript(name, scriptPath, args = [], timeoutMs = 600000) {
  logger.info(`\n${'─'.repeat(50)}`);
  logger.info(`▶ ${name}`);
  logger.info(`  Script: ${scriptPath} ${args.join(' ')}`);

  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync('node', [scriptPath, ...args], {
      cwd: dirname(scriptPath),
      timeout: timeoutMs,
      env: { ...process.env },
      maxBuffer: 10 * 1024 * 1024,
    });

    const duration = ((Date.now() - start) / 1000).toFixed(1);

    // Show last 15 lines of output
    if (stdout) {
      stdout.trim().split('\n').slice(-15).forEach(line => logger.info(`  ${line}`));
    }
    if (stderr && !stderr.includes('ExperimentalWarning')) {
      logger.warn(`  STDERR: ${stderr.substring(0, 300)}`);
    }

    logger.info(`✓ ${name} — ${duration}s`);
    return { success: true, duration, stdout };
  } catch (err) {
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    logger.error(`✗ ${name} — failed after ${duration}s: ${err.message}`);
    if (err.stdout) {
      err.stdout.trim().split('\n').slice(-10).forEach(line => logger.info(`  ${line}`));
    }
    return { success: false, duration, error: err.message };
  }
}

// ============================================
// Pipeline Steps
// ============================================

async function getStats() {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(*) FROM raw_videos WHERE status = 'pending') as pending,
      (SELECT COUNT(*) FROM videos WHERE status = 'enriched') as enriched,
      (SELECT COUNT(*) FROM videos WHERE status = 'watermarked') as watermarked,
      (SELECT COUNT(*) FROM videos WHERE status = 'published') as published,
      (SELECT COUNT(*) FROM videos WHERE status = 'needs_review') as review
  `);
  return rows[0];
}

async function main() {
  const args = process.argv.slice(2);
  const skipScrape = args.includes('--skip-scrape');
  const singleUrl = args.find(a => a.startsWith('--url='))?.split('=').slice(1).join('=');
  const pages = args.find(a => a.startsWith('--pages='))?.split('=')[1] || '1';
  const limit = args.find(a => a.startsWith('--limit='))?.split('=')[1] || '20';

  const pipelineStart = Date.now();

  logger.info('═'.repeat(60));
  logger.info('  SearchCelebrityHD — Pipeline');
  logger.info('═'.repeat(60));
  logger.info(`Time: ${new Date().toISOString()}`);

  // Show initial stats
  const before = await getStats();
  logger.info(`\nBEFORE: pending=${before.pending}, enriched=${before.enriched}, watermarked=${before.watermarked}, published=${before.published}, review=${before.review}`);

  const results = [];

  // ── STEP 1: Scrape ──
  if (!skipScrape) {
    const scrapeArgs = singleUrl ? [`--url=${singleUrl}`] : [`--pages=${pages}`];
    const scrapeResult = await runScript(
      '1. Scrape (searchcelebrityhd.com)',
      join(__dirname, 'scrape.js'),
      scrapeArgs,
      300000 // 5 min
    );
    results.push({ step: 'scrape', ...scrapeResult });
  }

  // ── STEP 2: AI Processing (screenshots) ──
  const aiResult = await runScript(
    '2. AI Processing (Gemini + screenshots)',
    join(__dirname, 'process-ai.js'),
    [`--limit=${limit}`],
    600000 // 10 min
  );
  results.push({ step: 'ai', ...aiResult });

  // ── STEP 3: TMDB Enrichment ──
  const tmdbResult = await runScript(
    '3. TMDB Enrichment',
    join(SCRIPTS_DIR, 'enrich-metadata.js'),
    [`--limit=${limit}`],
    300000 // 5 min
  );
  results.push({ step: 'tmdb', ...tmdbResult });

  // ── STEP 4: Download + Watermark (with source watermark detection + blur) ──
  const wmResult = await runScript(
    '4. Download + Watermark (detect → blur → celeb.skin)',
    join(__dirname, 'watermark.js'),
    [`--limit=${limit}`],
    1800000 // 30 min
  );
  results.push({ step: 'watermark', ...wmResult });

  // ── STEP 5: CDN Upload ──
  const cdnResult = await runScript(
    '5. CDN Upload (BunnyCDN)',
    join(SCRIPTS_DIR, 'upload-to-cdn.js'),
    [`--limit=${limit}`],
    1800000 // 30 min
  );
  results.push({ step: 'cdn', ...cdnResult });

  // ── STEP 6: Preview Generation ──
  const previewResult = await runScript(
    '6. Preview Clip',
    join(SCRIPTS_DIR, 'generate-preview.js'),
    [`--limit=${limit}`],
    1800000 // 30 min
  );
  results.push({ step: 'preview', ...previewResult });

  // ── STEP 7: Publish ──
  const pubResult = await runScript(
    '7. Publish',
    join(SCRIPTS_DIR, 'publish-to-site.js'),
    ['--auto', `--limit=${limit}`],
    300000 // 5 min
  );
  results.push({ step: 'publish', ...pubResult });

  // ── Summary ──
  const totalDuration = ((Date.now() - pipelineStart) / 1000).toFixed(1);
  const after = await getStats();

  logger.info('\n' + '═'.repeat(60));
  logger.info('  PIPELINE SUMMARY');
  logger.info('═'.repeat(60));
  logger.info(`Duration: ${totalDuration}s`);
  logger.info(`AFTER: pending=${after.pending}, enriched=${after.enriched}, watermarked=${after.watermarked}, published=${after.published}, review=${after.review}`);
  logger.info(`New published: ${parseInt(after.published) - parseInt(before.published)}`);

  for (const r of results) {
    const icon = r.success ? '✓' : '✗';
    logger.info(`  ${icon} ${r.step}: ${r.duration}s`);
  }

  const failedSteps = results.filter(r => !r.success);
  if (failedSteps.length > 0) {
    logger.error(`\n${failedSteps.length} step(s) failed:`);
    for (const f of failedSteps) {
      logger.error(`  - ${f.step}: ${f.error}`);
    }
    process.exit(1);
  }

  logger.info('\n✅ Pipeline complete!');
}

main().catch(err => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
