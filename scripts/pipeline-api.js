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
      GROUP BY pipeline_step
    `);

    const { rows: [statusCounts] } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'published')::int AS published,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'needs_review')::int AS needs_review,
        COUNT(*) FILTER (WHERE pipeline_step IS NOT NULL)::int AS in_progress
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
      WHERE v.pipeline_step IS NOT NULL
         OR v.status IN ('new', 'processing', 'downloading', 'downloaded',
                         'tmdb_enriching', 'tmdb_enriched', 'ai_analyzing', 'ai_analyzed',
                         'watermarking', 'media_generating', 'media_generated',
                         'cdn_uploading', 'cdn_uploaded', 'publishing',
                         'failed', 'needs_review')
      ORDER BY v.updated_at DESC
      LIMIT 200
    `);

    res.json({
      count: rows.length,
      videos: rows.map(r => ({
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
      })),
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
    const category = req.body?.category || '';
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

    if (videoIds.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 videos per bulk delete' });
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
// Health check (no auth)
// ============================================================

app.get('/api/pipeline/health', (req, res) => {
  res.json({ ok: true, version: '2.2', uptime: process.uptime() });
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
