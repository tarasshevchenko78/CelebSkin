#!/usr/bin/env node
/**
 * pipeline-api.js — CelebSkin Pipeline v2 Management API
 *
 * Micro-API server on Contabo for managing Pipeline v2 from admin UI.
 * Runs as a separate PM2 process on port 3100.
 *
 * Endpoints:
 *   GET  /api/pipeline/status      — pipeline status + queue sizes
 *   GET  /api/pipeline/videos      — videos in pipeline with current step
 *   GET  /api/pipeline/categories  — scrape categories from source (boobsradar)
 *   POST /api/pipeline/start       — launch orchestrator
 *   POST /api/pipeline/stop        — graceful shutdown
 *   POST /api/pipeline/retry       — retry failed video
 *   POST /api/pipeline/delete      — delete single video + relations
 *   POST /api/pipeline/delete-bulk — delete multiple videos + relations
 *
 * Usage:
 *   node pipeline-api.js
 *   pm2 start pipeline-api.js --name pipeline-api
 *
 * Security: Bearer token from PIPELINE_API_TOKEN in .env
 */

import express from 'express';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './lib/config.js';
import { query } from './lib/db.js';
import { getUnresolved } from './lib/dead-letter.js';
import logger from './lib/logger.js';
import BoobsRadarAdapter from './adapters/boobsradar-adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PIPELINE_API_PORT || '3100');
const API_TOKEN = process.env.PIPELINE_API_TOKEN || '';
const PID_FILE = join(__dirname, 'pipeline.pid');
const PROGRESS_FILE = join(__dirname, 'logs', 'progress.json');
const ORCHESTRATOR = join(__dirname, 'run-pipeline-v2.js');

const app = express();
app.use(express.json());

// ============================================================
// Auth middleware
// ============================================================

function authMiddleware(req, res, next) {
  if (!API_TOKEN) {
    // No token configured — allow (dev mode)
    return next();
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.use('/api/pipeline', (req, res, next) => { if (req.path === '/health') return next(); authMiddleware(req, res, next); });

// ============================================================
// Helpers
// ============================================================

function readProgress() {
  try {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function getPipelinePid() {
  try {
    if (!existsSync(PID_FILE)) return null;
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim());
    if (!pid || isNaN(pid)) return null;
    // Check if process is alive
    process.kill(pid, 0); // signal 0 = check existence
    return pid;
  } catch {
    return null; // process not running
  }
}

/**
 * Delete a single video and all its relations.
 * Also deletes the linked raw_videos record so the donor URL
 * becomes "available" again and the scraper can re-download it.
 *
 * Relation chain: videos.raw_video_id → raw_videos.id
 * (raw_videos has NO video_id column — the FK is on the videos side)
 *
 * Returns { deleted: true, videoId } or throws.
 */
async function deleteVideoFull(videoId) {
  // 1. Look up raw_video_id before deleting the video row
  const { rows: [videoRow] } = await query(
    `SELECT raw_video_id FROM videos WHERE id = $1`,
    [videoId]
  );
  const rawVideoId = videoRow?.raw_video_id || null;

  // 2. Delete junction/relation tables
  await query(`DELETE FROM video_celebrities WHERE video_id = $1`, [videoId]);
  await query(`DELETE FROM movie_scenes WHERE video_id = $1`, [videoId]);
  await query(`DELETE FROM video_tags WHERE video_id = $1`, [videoId]);
  await query(`DELETE FROM collection_videos WHERE video_id = $1`, [videoId]);
  await query(`DELETE FROM video_categories WHERE video_id = $1`, [videoId]);
  await query(`DELETE FROM pipeline_failures WHERE video_id = $1`, [videoId]);

  // 3. Delete the video itself (must happen before raw_videos due to FK)
  const { rowCount } = await query(`DELETE FROM videos WHERE id = $1`, [videoId]);

  // 4. Delete the raw_videos record (now safe — FK from videos is gone)
  //    This frees the donor_url so the scraper can re-scrape it if needed.
  if (rawVideoId) {
    await query(`DELETE FROM raw_videos WHERE id = $1`, [rawVideoId]);
  }

  return { deleted: rowCount > 0, videoId };
}

// ============================================================
// Categories cache (in-memory, 1 hour TTL)
// ============================================================

const categoriesCache = {
  boobsradar: { data: null, cachedAt: null },
};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function fetchBoobsradarCategories() {
  const now = Date.now();
  const cache = categoriesCache.boobsradar;
  if (cache.data && cache.cachedAt && (now - cache.cachedAt) < CACHE_TTL_MS) {
    return { categories: cache.data, cached: true, cached_at: new Date(cache.cachedAt).toISOString() };
  }

  logger.info('[pipeline-api] Fetching boobsradar categories...');

  // 1. Scrape category list from boobsradar.com using existing adapter
  const adapter = new BoobsRadarAdapter();
  const rawCategories = await adapter.getCategories();
  logger.info(`[pipeline-api] Scraped ${rawCategories.length} categories from boobsradar`);

  // 2. Get video counts from DB collections table (populated by sync-categories.js)
  const { rows: dbCounts } = await query(
    `SELECT slug, videos_count FROM collections WHERE is_auto = true`
  );
  const countMap = new Map();
  for (const row of dbCounts) {
    countMap.set(row.slug, row.videos_count || 0);
  }

  // 3. Merge: adapter names + DB counts
  const categories = rawCategories.map(cat => ({
    name: cat.title,
    slug: cat.slug,
    url: cat.url,
    count: countMap.get(cat.slug) || 0,
  }));

  // Sort by count descending, then name
  categories.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Cache
  cache.data = categories;
  cache.cachedAt = now;

  return { categories, cached: false, cached_at: new Date(now).toISOString() };
}

// ============================================================
// GET /api/pipeline/status
// ============================================================

app.get('/api/pipeline/status', async (req, res) => {
  try {
    const pid = getPipelinePid();
    const progress = readProgress();
    const pipeline = progress.pipeline || {};

    // Queue stats from progress.json
    const stepNames = ['download', 'tmdb_enrich', 'ai_vision', 'watermark', 'media', 'cdn_upload', 'publish', 'cleanup'];
    const queues = {};
    for (const name of stepNames) {
      const step = progress.steps?.[name] || {};
      queues[name] = {
        waiting: step.queueSize || 0,
        active: step.activeWorkers || 0,
        done: step.completedCount || step.videosDone || 0,
        failed: step.errorCount || 0,
        status: step.status || 'idle',
      };
    }

    // DB stats for totals
    const { rows: stepCounts } = await query(`
      SELECT pipeline_step, COUNT(*)::int AS cnt
      FROM videos WHERE pipeline_step IS NOT NULL
        AND status NOT IN ('published', 'failed', 'needs_review')
      GROUP BY pipeline_step
    `);

    const { rows: [statusCounts] } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'published')::int AS published,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'needs_review')::int AS needs_review,
        COUNT(*) FILTER (WHERE pipeline_step IS NOT NULL AND status NOT IN ('published', 'failed', 'needs_review'))::int AS in_progress
      FROM videos
    `);

    // Scraping stats
    const { rows: [scrapingStats] } = await query(`
      SELECT
        (SELECT COUNT(*)::int FROM videos) AS total_in_db,
        (SELECT COUNT(*)::int FROM raw_videos WHERE status = 'pending') AS raw_pending,
        (SELECT MAX(created_at) FROM raw_videos) AS last_scrape_at
    `);

    // Dead letter queue (last 20)
    const deadLetter = await getUnresolved(20);

    // Uptime calc
    let uptimeSec = null;
    let startedAt = pipeline.startedAt || null;
    if (pid && pipeline.startedAt) {
      uptimeSec = Math.round((Date.now() - new Date(pipeline.startedAt).getTime()) / 1000);
    }

    res.json({
      running: !!pid,
      pid,
      uptime_sec: uptimeSec,
      started_at: startedAt,
      pipeline_status: pipeline.status || (pid ? 'running' : 'stopped'),
      queues,
      step_counts: stepCounts.reduce((acc, r) => { acc[r.pipeline_step] = r.cnt; return acc; }, {}),
      totals: {
        total: (statusCounts?.published || 0) + (statusCounts?.failed || 0) + (statusCounts?.needs_review || 0) + (statusCounts?.in_progress || 0),
        published: statusCounts?.published || 0,
        failed: statusCounts?.failed || 0,
        needs_review: statusCounts?.needs_review || 0,
        in_progress: statusCounts?.in_progress || 0,
      },
      stats: {
        totalCompleted: pipeline.totalCompleted || 0,
        totalFailed: pipeline.totalFailed || 0,
        elapsedMs: pipeline.elapsedMs || 0,
      },
      scraping: {
        total_in_db: scrapingStats?.total_in_db || 0,
        raw_pending: scrapingStats?.raw_pending || 0,
        last_scrape_at: scrapingStats?.last_scrape_at || null,
      },
      dead_letter: deadLetter.map(d => ({
        id: d.id,
        videoId: d.video_id,
        step: d.step,
        error: d.error,
        attempts: d.attempts,
        failed_at: d.created_at,
      })),
    });
  } catch (err) {
    logger.error(`[pipeline-api] /status error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/pipeline/videos
// ============================================================

app.get('/api/pipeline/videos', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT v.id, v.title->>'en' AS title_en, v.pipeline_step, v.pipeline_error,
             v.ai_vision_status, v.status, v.created_at, v.updated_at,
             c.name AS celebrity, m.title AS movie, m.year AS movie_year
      FROM videos v
      LEFT JOIN LATERAL (
        SELECT c2.name FROM celebrities c2
        JOIN video_celebrities vc ON vc.celebrity_id = c2.id
        WHERE vc.video_id = v.id LIMIT 1
      ) c ON true
      LEFT JOIN LATERAL (
        SELECT m2.title, m2.year FROM movies m2
        JOIN movie_scenes ms ON ms.movie_id = m2.id
        WHERE ms.video_id = v.id LIMIT 1
      ) m ON true
      WHERE (v.pipeline_step IS NOT NULL AND v.status NOT IN ('published'))
         OR v.status IN ('new', 'processing', 'downloading', 'downloaded',
                         'tmdb_enriching', 'tmdb_enriched', 'ai_analyzing', 'ai_analyzed',
                         'watermarking', 'media_generating', 'media_generated',
                         'cdn_uploading', 'cdn_uploaded', 'publishing',
                         'failed', 'needs_review')
      ORDER BY v.updated_at DESC
      LIMIT 200
    `);

    // Read step-progress.json for each video (file-based progress from workers)
    const PIPELINE_WORK_DIR = '/opt/celebskin/pipeline-work';
    const videosWithProgress = rows.map(r => {
      let progress = null;
      try {
        const progFile = join(PIPELINE_WORK_DIR, r.id, 'step-progress.json');
        if (existsSync(progFile)) {
          progress = JSON.parse(readFileSync(progFile, 'utf8'));
        }
      } catch {}
      return {
        id: r.id,
        title: r.title_en || `${r.celebrity || 'Unknown'} in ${r.movie || 'Unknown'}${r.movie_year ? ` (${r.movie_year})` : ''}`,
        celebrity: r.celebrity || null,
        movie: r.movie ? `${r.movie}${r.movie_year ? ` (${r.movie_year})` : ''}` : null,
        pipeline_step: r.pipeline_step,
        pipeline_error: r.pipeline_error,
        ai_vision_status: r.ai_vision_status,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
        progress,
      };
    });

    res.json({
      count: rows.length,
      videos: videosWithProgress,
    });
  } catch (err) {
    logger.error(`[pipeline-api] /videos error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/pipeline/categories — scrape categories from source
// ============================================================

app.get('/api/pipeline/categories', async (req, res) => {
  try {
    const source = req.query.source || 'boobsradar';

    if (source === 'boobsradar') {
      const result = await fetchBoobsradarCategories();
      return res.json({
        source: 'boobsradar',
        ...result,
      });
    }

    // xcadr or other sources — return empty for now
    return res.json({
      source,
      categories: [],
      cached: false,
      cached_at: null,
      message: `Source '${source}' categories not implemented yet`,
    });
  } catch (err) {
    logger.error(`[pipeline-api] /categories error: ${err.message}`);
    res.status(500).json({ error: err.message, categories: [] });
  }
});

// ============================================================
// POST /api/pipeline/start
// ============================================================

app.post('/api/pipeline/start', (req, res) => {
  try {
    const pid = getPipelinePid();
    if (pid) {
      return res.status(409).json({
        error: 'Pipeline already running',
        pid,
        message: `Process ${pid} is already running. Stop it first or wait for it to finish.`,
      });
    }

    const limit = parseInt(req.body?.limit) || 0;
    const source = req.body?.source || '';
    // Strip count suffix like "(280)" from category name sent by UI
    const category = (req.body?.category || '').replace(/\s*\(\d+\)\s*$/, '').trim();
    const args = [];
    if (limit > 0) args.push(`--limit=${limit}`);
    if (source) args.push(`--source=${source}`);
    if (category) args.push(`--category=${category}`);

    // Spawn detached child process
    const child = spawn('node', [ORCHESTRATOR, ...args], {
      cwd: __dirname,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    // Pipe logs
    child.stdout.on('data', (d) => logger.info(`[pipeline] ${d.toString().trimEnd()}`));
    child.stderr.on('data', (d) => logger.warn(`[pipeline:err] ${d.toString().trimEnd()}`));

    child.on('error', (err) => {
      logger.error(`[pipeline-api] Failed to start pipeline: ${err.message}`);
    });

    child.on('exit', (code) => {
      logger.info(`[pipeline-api] Pipeline exited with code ${code}`);
    });

    // Unref so pipeline-api can exit independently
    child.unref();

    logger.info(`[pipeline-api] Started pipeline pid=${child.pid}${limit ? ` limit=${limit}` : ''}${source ? ` source=${source}` : ''}${category ? ` category=${category}` : ''}`);

    res.json({
      ok: true,
      pid: child.pid,
      args,
      message: `Pipeline started (pid=${child.pid})`,
    });
  } catch (err) {
    logger.error(`[pipeline-api] /start error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/pipeline/stop
// ============================================================

app.post('/api/pipeline/stop', (req, res) => {
  try {
    const pid = getPipelinePid();
    if (!pid) {
      return res.status(404).json({
        error: 'Pipeline not running',
        message: 'No running pipeline process found.',
      });
    }

    process.kill(pid, 'SIGTERM');
    logger.info(`[pipeline-api] Sent SIGTERM to pid=${pid}`);

    res.json({
      ok: true,
      pid,
      message: `Stopping pipeline (pid=${pid}). Workers will finish current work and exit.`,
    });
  } catch (err) {
    if (err.code === 'ESRCH') {
      // Process already dead — clean up PID file
      try { unlinkSync(PID_FILE); } catch {}
      return res.json({ ok: true, message: 'Pipeline was already stopped. PID file cleaned.' });
    }
    logger.error(`[pipeline-api] /stop error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/pipeline/retry
// ============================================================

app.post('/api/pipeline/retry', async (req, res) => {
  try {
    const videoId = req.body?.videoId;
    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' });
    }

    // Check video exists
    const { rows: [video] } = await query(
      `SELECT id, status, pipeline_step, pipeline_error FROM videos WHERE id = $1`,
      [videoId]
    );
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Reset pipeline error and step
    await query(`
      UPDATE videos SET
        pipeline_error = NULL,
        pipeline_step = NULL,
        status = CASE
          WHEN status = 'failed' THEN 'new'
          WHEN status = 'needs_review' THEN 'new'
          ELSE status
        END,
        updated_at = NOW()
      WHERE id = $1
    `, [videoId]);

    // Mark dead-letter entries as resolved
    await query(`
      UPDATE pipeline_failures SET resolved = true, resolved_at = NOW()
      WHERE video_id = $1 AND resolved = false
    `, [videoId]);

    logger.info(`[pipeline-api] Retry: video=${videoId.substring(0, 8)}, was_status=${video.status}, was_step=${video.pipeline_step}`);

    res.json({
      ok: true,
      videoId,
      message: `Video reset for retry. Previous status: ${video.status}, step: ${video.pipeline_step || 'none'}. Will be picked up on next pipeline run.`,
    });
  } catch (err) {
    logger.error(`[pipeline-api] /retry error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/pipeline/delete — delete single video + relations
// ============================================================

app.post('/api/pipeline/delete', async (req, res) => {
  try {
    const videoId = req.body?.videoId;
    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' });
    }

    // Check video exists
    const { rows: [video] } = await query(
      `SELECT id, status, pipeline_step FROM videos WHERE id = $1`,
      [videoId]
    );
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const result = await deleteVideoFull(videoId);
    logger.info(`[pipeline-api] Deleted video=${videoId.substring(0, 8)}, was_status=${video.status}, was_step=${video.pipeline_step}`);

    res.json({
      ok: true,
      ...result,
      message: `Video ${videoId.substring(0, 8)} deleted with all relations.`,
    });
  } catch (err) {
    logger.error(`[pipeline-api] /delete error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/pipeline/delete-bulk — delete multiple videos
// ============================================================

app.post('/api/pipeline/delete-bulk', async (req, res) => {
  try {
    const videoIds = req.body?.videoIds;
    if (!videoIds || !Array.isArray(videoIds) || videoIds.length === 0) {
      return res.status(400).json({ error: 'videoIds array is required' });
    }

    if (videoIds.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 videos per bulk delete' });
    }

    const results = [];
    let deleted = 0;
    let failed = 0;

    for (const videoId of videoIds) {
      try {
        const result = await deleteVideoFull(videoId);
        if (result.deleted) deleted++;
        results.push(result);
      } catch (err) {
        failed++;
        results.push({ videoId, deleted: false, error: err.message });
      }
    }

    logger.info(`[pipeline-api] Bulk delete: ${deleted} deleted, ${failed} failed out of ${videoIds.length}`);

    res.json({
      ok: true,
      deleted,
      failed,
      total: videoIds.length,
      message: `Deleted ${deleted}/${videoIds.length} videos.${failed > 0 ? ` ${failed} failed.` : ''}`,
    });
  } catch (err) {
    logger.error(`[pipeline-api] /delete-bulk error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// XCADR Pipeline endpoints
// ============================================================

const XCADR_PID_FILE = join(__dirname, 'xcadr-pipeline.pid');
const XCADR_PROGRESS_FILE = join(__dirname, 'logs', 'xcadr-progress.json');
const XCADR_ORCHESTRATOR = join(__dirname, 'run-xcadr-pipeline.js');
const XCADR_WORK_DIR = '/opt/celebskin/xcadr-work';
const XCADR_V2_WORK_DIR = '/opt/celebskin/pipeline-work';

app.use('/api/xcadr-pipeline', authMiddleware);

function getXcadrPid() {
  try {
    if (!existsSync(XCADR_PID_FILE)) return null;
    const pid = parseInt(readFileSync(XCADR_PID_FILE, 'utf8').trim());
    if (!pid || isNaN(pid)) return null;
    process.kill(pid, 0);
    return pid;
  } catch { return null; }
}

function readXcadrProgress() {
  try { return JSON.parse(readFileSync(XCADR_PROGRESS_FILE, 'utf8')); }
  catch { return {}; }
}

// GET /api/xcadr-pipeline/status
app.get('/api/xcadr-pipeline/status', async (req, res) => {
  try {
    const pid = getXcadrPid();
    const progress = readXcadrProgress();

    const stepNames = ['download', 'ai_vision', 'watermark', 'media', 'cdn_upload', 'publish', 'cleanup'];
    const queues = {};
    for (const name of stepNames) {
      const step = progress.steps?.[name] || {};
      queues[name] = {
        queued: step.queued || 0,
        active: step.active || 0,
        completed: step.completed || 0,
      };
    }

    const { rows: [counts] } = await query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'published')::int AS published,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status IN ('parsed','translated','matched'))::int AS parsed,
        COUNT(*) FILTER (WHERE status = 'translated')::int AS translated,
        COUNT(*) FILTER (WHERE status = 'matched')::int AS matched,
        COUNT(*) FILTER (WHERE status NOT IN ('published','failed','parsed','translated','matched','imported','no_match','duplicate'))::int AS in_progress
      FROM xcadr_imports
    `);

    res.json({
      running: !!pid,
      pid,
      pipeline_status: progress.status || (pid ? 'running' : 'stopped'),
      queues,
      totals: {
        total: counts?.total || 0,
        published: counts?.published || 0,
        failed: counts?.failed || 0,
        parsed: counts?.parsed || 0,
        translated: counts?.translated || 0,
        matched: counts?.matched || 0,
        in_progress: counts?.in_progress || 0,
      },
      completed: progress.completed || 0,
      failed_count: progress.failed || 0,
      elapsed: progress.elapsed || 0,
    });
  } catch (err) {
    logger.error(`[pipeline-api] /xcadr-pipeline/status error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/xcadr-pipeline/videos
app.get('/api/xcadr-pipeline/videos', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, title_ru, title_en, celebrity_name_ru, celebrity_name_en,
             movie_title_ru, movie_title_en, status, pipeline_step, pipeline_error,
             xcadr_url, matched_video_id, created_at, updated_at
      FROM xcadr_imports
      ORDER BY updated_at DESC
      LIMIT 200
    `);

    const videosWithProgress = rows.map(r => {
      let step_progress = null;
      let ai_vision_status = null;
      let ai_vision_error = null;
      const wdir = join(XCADR_WORK_DIR, String(r.id));
      try {
        const progFile = join(wdir, 'step-progress.json');
        if (existsSync(progFile)) step_progress = JSON.parse(readFileSync(progFile, 'utf8'));
      } catch {}
      try {
        const aiFile = join(wdir, 'ai-results.json');
        if (existsSync(aiFile)) {
          const aiData = JSON.parse(readFileSync(aiFile, 'utf8'));
          ai_vision_status = aiData.ai_vision_status || null;
          ai_vision_error = aiData.ai_vision_error || null;
        }
      } catch {}
      // Also check step_progress for ai_vision_status (set during processing)
      if (!ai_vision_status && step_progress?.ai_vision_status) ai_vision_status = step_progress.ai_vision_status;
      return { ...r, step_progress, ai_vision_status, ai_vision_error };
    });

    res.json({ count: rows.length, videos: videosWithProgress });
  } catch (err) {
    logger.error(`[pipeline-api] /xcadr-pipeline/videos error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/xcadr-pipeline/start
app.post('/api/xcadr-pipeline/start', (req, res) => {
  try {
    const pid = getXcadrPid();
    if (pid) return res.status(409).json({ error: 'XCADR Pipeline already running', pid });

    // Ensure Cloudflare WARP proxy is running (xcadr blocks Contabo IP)
    try {
      const { execSync } = require('child_process');
      const warpStatus = execSync("warp-cli --accept-tos status 2>&1 || true", { encoding: 'utf8' });
      if (!warpStatus.includes('Connected')) {
        execSync("warp-cli --accept-tos connect", { timeout: 10000 });
        logger.info('[pipeline-api] Connected Cloudflare WARP proxy');
      }
    } catch (e) { logger.warn('[pipeline-api] WARP check failed: ' + e.message); }

    const limit = parseInt(req.body?.limit) || 10;
    const url = req.body?.url || '';
    const celeb = req.body?.celeb || '';
    const collection = req.body?.collection || '';
    const pages = parseInt(req.body?.pages) || 0;
    const downloadThreads = parseInt(req.body?.download_threads) || 0;

    const args = [`--limit=${limit}`];
    if (downloadThreads > 0) args.push(`--download-threads=${downloadThreads}`);
    if (url) args.push(`--url=${url}`);
    if (celeb) args.push(`--celeb=${celeb}`);
    if (collection) args.push(`--collection=${collection}`);
    if (pages > 0) args.push(`--pages=${pages}`);

    const child = spawn('node', [XCADR_ORCHESTRATOR, ...args], {
      cwd: __dirname, detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    child.stdout.on('data', (d) => logger.info(`[xcadr] ${d.toString().trimEnd()}`));
    child.stderr.on('data', (d) => logger.warn(`[xcadr:err] ${d.toString().trimEnd()}`));
    child.on('error', (err) => logger.error(`[xcadr] Failed to start: ${err.message}`));
    child.on('exit', (code) => logger.info(`[xcadr] Exited with code ${code}`));
    child.unref();

    logger.info(`[pipeline-api] XCADR pipeline started pid=${child.pid} limit=${limit}`);
    res.json({ ok: true, pid: child.pid, args, message: `XCADR Pipeline started (pid=${child.pid})` });
  } catch (err) {
    logger.error(`[pipeline-api] /xcadr-pipeline/start error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/xcadr-pipeline/stop
app.post('/api/xcadr-pipeline/stop', (req, res) => {
  try {
    const pid = getXcadrPid();
    if (!pid) return res.status(404).json({ error: 'XCADR Pipeline not running' });
    process.kill(pid, 'SIGTERM');
    logger.info(`[pipeline-api] XCADR: SIGTERM to pid=${pid}`);
    res.json({ ok: true, pid, message: `Stopping XCADR pipeline (pid=${pid})` });
  } catch (err) {
    if (err.code === 'ESRCH') {
      try { unlinkSync(XCADR_PID_FILE); } catch {}
      return res.json({ ok: true, message: 'XCADR pipeline was already stopped. PID file cleaned.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/xcadr-pipeline/delete — full cleanup of xcadr_import + temp video + workdirs
app.post('/api/xcadr-pipeline/delete', async (req, res) => {
  try {
    const id = parseInt(req.body?.id);
    if (!id) return res.status(400).json({ error: 'id is required' });
    const result = await deleteXcadrImport(id);
    res.json(result);
  } catch (err) {
    logger.error(`[pipeline-api] /xcadr-pipeline/delete error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/xcadr-pipeline/delete-bulk
app.post('/api/xcadr-pipeline/delete-bulk', async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    if (ids.length > 500) return res.status(400).json({ error: 'Maximum 500 per bulk delete' });

    let deleted = 0, failed = 0;
    for (const id of ids) {
      try { await deleteXcadrImport(parseInt(id)); deleted++; }
      catch { failed++; }
    }
    logger.info(`[pipeline-api] XCADR bulk delete: ${deleted} deleted, ${failed} failed`);
    res.json({ ok: true, deleted, failed, total: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Delete an xcadr_import and ALL associated data:
 * - If published: delete the created video + all relations
 * - Always: delete temp video record from videos table (ai_vision temp)
 * - Always: delete workdirs (xcadr-work/{id}, pipeline-work/{tempVideoId})
 * - Always: delete the xcadr_imports row
 */
async function deleteXcadrImport(xcadrId) {
  const { rows: [item] } = await query(`SELECT * FROM xcadr_imports WHERE id = $1`, [xcadrId]);
  if (!item) return { deleted: false, error: 'Not found' };

  // 1. If published, delete the created video and all relations
  if (item.matched_video_id) {
    try { await deleteVideoFull(item.matched_video_id); } catch {}
  }

  // 2. Delete temp video record (created during ai_vision for watermark queue)
  const workDir = join(XCADR_WORK_DIR, String(xcadrId));
  let tempVideoId = null;
  try {
    tempVideoId = readFileSync(join(workDir, 'temp-video-id.txt'), 'utf8').trim();
  } catch {}
  if (tempVideoId) {
    try { await query(`DELETE FROM video_celebrities WHERE video_id = $1`, [tempVideoId]); } catch {}
    try { await query(`DELETE FROM movie_scenes WHERE video_id = $1`, [tempVideoId]); } catch {}
    try { await query(`DELETE FROM video_tags WHERE video_id = $1`, [tempVideoId]); } catch {}
    try { await query(`DELETE FROM collection_videos WHERE video_id = $1`, [tempVideoId]); } catch {}
    try { await query(`DELETE FROM videos WHERE id = $1`, [tempVideoId]); } catch {}
    // Delete pipeline-work dir for temp video
    try {
      const { rm } = await import('fs/promises');
      await rm(join(XCADR_V2_WORK_DIR, tempVideoId), { recursive: true, force: true });
    } catch {}
  }

  // 3. Delete xcadr-work dir
  try {
    const { rm } = await import('fs/promises');
    await rm(workDir, { recursive: true, force: true });
  } catch {}

  // 4. Delete the xcadr_imports row
  await query(`DELETE FROM xcadr_imports WHERE id = $1`, [xcadrId]);
  logger.info(`[pipeline-api] Deleted xcadr #${xcadrId}${tempVideoId ? ` + temp ${tempVideoId.substring(0,8)}` : ''}${item.matched_video_id ? ` + video ${item.matched_video_id.substring(0,8)}` : ''}`);

  return { deleted: true, id: xcadrId };
}

// ============================================================
// Health check (no auth)
// ============================================================

app.get('/api/pipeline/health', (req, res) => {
  res.json({ ok: true, version: '2.3', uptime: process.uptime() });
});

// ============================================================
// Start server
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`[pipeline-api] Listening on port ${PORT}`);
  if (!API_TOKEN) {
    logger.warn('[pipeline-api] WARNING: PIPELINE_API_TOKEN not set — API is unprotected!');
  }
});
