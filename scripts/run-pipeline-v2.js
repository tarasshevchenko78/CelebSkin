#!/usr/bin/env node
/**
 * run-pipeline-v2.js — Pipeline v2.0 Orchestrator
 *
 * In-memory queues with worker pools. Each video passes ALL steps
 * sequentially: download → tmdb → ai_vision → watermark → media → cdn → publish → cleanup.
 *
 * When a worker finishes step N, it immediately enqueues the videoId
 * into step N+1's queue (0ms delay, no DB polling).
 *
 * Usage:
 *   node run-pipeline-v2.js                    # full pipeline
 *   node run-pipeline-v2.js --limit=10         # process max 10 videos
 *   node run-pipeline-v2.js --step=ai_vision   # run only one step (debug)
 *   node run-pipeline-v2.js --resume            # resume from workdirs
 *
 * Spec: /opt/celebskin/PIPELINE_V2_SPEC.md §2
 */

import { existsSync, readdirSync, mkdirSync, createWriteStream, writeFileSync, unlinkSync } from 'fs';
import { stat, unlink, readFile, rm, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pipeline as streamPipeline } from 'stream/promises';
import { execFile as execFileCb, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);
const __dirname = dirname(fileURLToPath(import.meta.url));
import axios from 'axios';
import { config } from './lib/config.js';
import { query } from './lib/db.js';
import { extractNationality, mapDonorTags } from './lib/tags.js';
import slugify from 'slugify';
import { recordFailure } from './lib/dead-letter.js';
import { uploadFile, getVideoPath } from './lib/bunny.js';
import logger from './lib/logger.js';
import {
  writePipelineProgress,
  writeStepStatus,
  writeVideoJourneys,
  clearAllProgress,
} from './lib/progress.js';

// ============================================================
// Constants
// ============================================================

const WORK_DIR = '/opt/celebskin/pipeline-work';
const PID_FILE = join(dirname(fileURLToPath(import.meta.url)), 'pipeline.pid');
const RETRY_DELAYS = [5000, 15000, 45000]; // 3 retries: 5s, 15s, 45s
const PROGRESS_INTERVAL_MS = 3000;

// ── Step progress helpers (per-video) ──────────────────────
function writeStepProgress(videoId, data) {
  try {
    const dir = join(WORK_DIR, videoId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = join(dir, 'step-progress.json');
    writeFileSync(file, JSON.stringify({
      ...data,
      started_at: data.started_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
  } catch (_) {}
}

function clearStepProgress(videoId) {
  try {
    const file = join(WORK_DIR, videoId, 'step-progress.json');
    if (existsSync(file)) unlinkSync(file);
  } catch (_) {}
}

const STEP_ORDER = [
  'download',
  'tmdb_enrich',
  'ai_vision',
  'watermark',
  'media',
  'cdn_upload',
  'publish',
  'cleanup',
];

const STEP_CONCURRENCY = {
  download:     3,  // Each download spawns Playwright browser — limit RAM usage
  tmdb_enrich:  4,
  ai_vision:    3,
  watermark:    2,  // 4-core Contabo handles 2 concurrent FFmpeg watermark jobs
  media:        3,
  cdn_upload:   4,
  publish:      3,
  cleanup:      3,
};

// DB status written at start of each step (for monitoring)
const STEP_DB_STATUS = {
  download:     'downloading',
  tmdb_enrich:  'tmdb_enriching',
  ai_vision:    'ai_analyzing',
  watermark:    'watermarking',
  media:        'media_generating',
  cdn_upload:   'cdn_uploading',
  publish:      'publishing',
  cleanup:      'published',
};

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);

function getArg(name) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}

const limitArg = parseInt(getArg('limit')) || 0;
const singleStep = getArg('step');
const resumeMode = args.includes('--resume');
const sourceArg = getArg('source') || '';   // boobsradar, xcadr
const categoryArg = getArg('category') || '';

// ============================================================
// PipelineQueue — simple in-memory FIFO
// ============================================================

class PipelineQueue {
  constructor(name) {
    this.name = name;
    this._items = [];
    this._waiters = [];
  }

  enqueue(videoId) {
    this._items.push(videoId);
    // Wake up a waiting worker if any
    if (this._waiters.length > 0) {
      const resolve = this._waiters.shift();
      resolve();
    }
  }

  dequeue() {
    return this._items.shift() || null;
  }

  /** Wait until an item is available or shutdown signal */
  async waitForItem(signal) {
    while (this._items.length === 0) {
      if (signal.stopped) return null;
      await new Promise(resolve => {
        this._waiters.push(resolve);
        // Also resolve on shutdown so workers can exit
        const check = setInterval(() => {
          if (signal.stopped) {
            clearInterval(check);
            resolve();
          }
        }, 500);
      });
      if (signal.stopped) return null;
    }
    return this.dequeue();
  }

  size() {
    return this._items.length;
  }

  /** Drain all waiters (on shutdown) */
  wakeAll() {
    while (this._waiters.length > 0) {
      const resolve = this._waiters.shift();
      resolve();
    }
  }
}

// ============================================================
// WorkerPool — runs N concurrent workers pulling from a queue
// ============================================================

class WorkerPool {
  constructor({ name, concurrency, processFn, inputQueue, nextQueue, signal, stats }) {
    this.name = name;
    this.concurrency = concurrency;
    this.processFn = processFn;
    this.inputQueue = inputQueue;
    this.nextQueue = nextQueue;
    this.signal = signal;
    this.stats = stats;
    this._activeCount = 0;
    this._workers = [];
  }

  start() {
    for (let i = 0; i < this.concurrency; i++) {
      this._workers.push(this._runWorker(i));
    }
    logger.info(`[${this.name}] Started ${this.concurrency} worker(s)`);
    return Promise.all(this._workers);
  }

  async _runWorker(workerId) {
    while (!this.signal.stopped) {
      let videoId = await this.inputQueue.waitForItem(this.signal);
      if (!videoId) break; // shutdown

      this._activeCount++;
      let shortId = String(videoId).substring(0, 8);

      try {
        // For download step: videoId might be a raw_video ID (UUID from raw_videos table)
        // Skip DB status update until we have a real video UUID
        let isRawId = false;
        if (this.name === 'download') {
          const { rows: vCheck } = await query(`SELECT 1 FROM videos WHERE id = $1`, [videoId]);
          isRawId = vCheck.length === 0;
        }

        if (!isRawId) {
          // Update DB status for monitoring
          const dbStatus = STEP_DB_STATUS[this.name];
          if (dbStatus) {
            if (this.name === 'watermark') {
              // Conditional claim: skip if home watermark worker already claimed this video
              const { rowCount } = await query(
                `UPDATE videos SET status = $2, pipeline_step = $3, pipeline_error = NULL, updated_at = NOW()
                 WHERE id = $1 AND pipeline_step != 'watermarking_home'`,
                [videoId, dbStatus, this.name]
              );
              if (rowCount === 0) {
                logger.info(`[${this.name}:${shortId}] Claimed by home worker — skipping`);
                clearStepProgress(videoId);
                continue; // finally(_activeCount--) runs, skip to next queue item
              }
            } else {
              await query(
                `UPDATE videos SET status = $2, pipeline_step = $3, pipeline_error = NULL, updated_at = NOW() WHERE id = $1`,
                [videoId, dbStatus, this.name]
              );
            }
          }
        }

        // Execute with retries
        let lastError = null;
        let success = false;
        let resultVideoId = null;

        for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
          if (attempt > 0) {
            const delay = RETRY_DELAYS[attempt - 1];
            logger.warn(`[${this.name}:${shortId}] Retry ${attempt}/${RETRY_DELAYS.length} in ${delay}ms...`);
            await sleep(delay);
          }

          try {
            // Before retry, check if video was already marked as permanently failed
            if (attempt > 0) {
              const { rows: [chk] } = await query('SELECT status FROM videos WHERE id = $1', [videoId]);
              if (chk?.status === 'failed') {
                logger.warn(`[${this.name}:${shortId}] Video already marked failed — stopping retries`);
                break;
              }
            }
            resultVideoId = await this.processFn(videoId, this.name);
            if (resultVideoId === '__skip__') {
              success = true;
              break;
            }
            success = true;
            break;
          } catch (err) {
            lastError = err;
            logger.error(`[${this.name}:${shortId}] Attempt ${attempt + 1} failed: ${err.message}`);
          }
        }

        if (success && resultVideoId === '__skip__') {
          // Skipped (duplicate etc) — don't pass to next step
          this._activeCount--;
          continue;
        }

        // For download: use returned videoId (UUID) for next steps
        if (isRawId && resultVideoId && resultVideoId !== '__skip__') {
          videoId = resultVideoId;
          shortId = videoId.substring(0, 8);
          // Now update DB status for the real video
          const dbStatus = STEP_DB_STATUS[this.name];
          if (dbStatus) {
            await query(
              `UPDATE videos SET status = $2, pipeline_step = $3, pipeline_error = NULL, updated_at = NOW() WHERE id = $1`,
              [videoId, dbStatus, this.name]
            );
          }
        }

        if (success) {
          this.stats.completed++;
          this.stats.byStep[this.name] = (this.stats.byStep[this.name] || 0) + 1;
          clearStepProgress(videoId);
          logger.info(`[${this.name}:${shortId}] ✅ Done`);

          // After ai_vision: mark as watermark_ready for home worker to claim
          if (this.name === 'ai_vision') {
            try {
              await query(
                `UPDATE videos SET pipeline_step = 'watermark_ready', updated_at = NOW() WHERE id = $1`,
                [videoId]
              );
            } catch {}
          }

          // Pass to next queue
          if (this.nextQueue) {
            this.nextQueue.enqueue(videoId);
          }
        } else {
          // Exhausted retries → dead letter queue
          this.stats.failed++;
          logger.error(`[${this.name}:${shortId}] ❌ Failed after ${RETRY_DELAYS.length + 1} attempts`);

          await query(
            `UPDATE videos SET status = 'failed', pipeline_step = $2, pipeline_error = $3, updated_at = NOW() WHERE id = $1`,
            [videoId, this.name, lastError?.message || 'Unknown error']
          );

          clearStepProgress(videoId);
          await recordFailure(videoId, this.name, lastError, RETRY_DELAYS.length + 1);
        }
      } catch (err) {
        // Unexpected error in worker itself
        this.stats.failed++;
        logger.error(`[${this.name}:${shortId}] Worker crash: ${err.message}`);
      } finally {
        this._activeCount--;
      }
    }
  }

  get activeCount() {
    return this._activeCount;
  }
}

// ============================================================
// Step processors — STUBS (will be implemented in prompts 6-13)
// ============================================================

async function processDownload(inputId, stepName) {
  // inputId can be a video UUID (existing 'new') or raw_video ID (from scraper)
  // Detect: if it looks like UUID with dashes, it's a video ID; otherwise raw_video ID
  let videoId = inputId;

  // Check if inputId is a raw_video ID — needs claiming first
  // Detect by checking: does a video with this ID exist? If not, it's a raw_video ID.
  const { rows: videoCheck } = await query(`SELECT id FROM videos WHERE id = $1`, [inputId]);
  if (videoCheck.length === 0) {
    // Not a video ID — must be a raw_video ID from scraper
    videoId = await claimRawVideoForDownload(inputId);
    if (!videoId) {
      logger.info(`[${stepName}] raw_video ${inputId.substring(0,8)} skipped (duplicate or already claimed)`);
      return '__skip__';  // signal to not enqueue to next step
    }
  }

  const shortId = videoId.substring(0, 8);
  const workDir = join(WORK_DIR, videoId);
  const outputPath = join(workDir, 'original.mp4');

  // Skip if already downloaded (resume support)
  if (existsSync(outputPath)) {
    const fileStat = await stat(outputPath);
    if (fileStat.size > 10240) {
      logger.info(`[${stepName}:${shortId}] Already downloaded (${(fileStat.size / 1024 / 1024).toFixed(1)}MB), skipping`);
      return videoId;
    }
    // File too small — corrupted, re-download
    await unlink(outputPath);
  }

  // 1. Get download URL from raw_videos
  const { rows } = await query(
    `SELECT r.video_file_url, r.source_url, r.raw_title
     FROM videos v
     JOIN raw_videos r ON v.raw_video_id = r.id
     WHERE v.id = $1`,
    [videoId]
  );

  if (!rows.length) {
    throw new Error('Video not found or no raw_video linked');
  }

  const { video_file_url, source_url, raw_title } = rows[0];
  let downloadUrl = video_file_url || source_url;

  if (!downloadUrl) {
    throw new Error('No download URL available (video_file_url and source_url both empty)');
  }

  logger.info(`[${stepName}:${shortId}] Downloading: ${raw_title || source_url?.substring(0, 80)}`);

  // 2. Ensure workdir exists
  if (!existsSync(workDir)) {
    mkdirSync(workDir, { recursive: true });
  }

  // 3. Get real CDN video URL via Playwright, then download via axios stream
  const pageUrl = source_url || downloadUrl;
  const startedAt = new Date().toISOString();
  writeStepProgress(videoId, { step: 'download', status: 'running', percent: 0, detail: 'Getting video URL...' });

  let realCdnUrl = null;
  let browserCookies = [];

  try {
    // Step A: Open page in Playwright to intercept real video CDN URL
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    page.on('response', r => {
      const ct = r.headers()['content-type'] || '';
      if (ct.includes('video/mp4') && !realCdnUrl) {
        realCdnUrl = r.url();
      }
    });

    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 60000 });

    // Get cookies for CDN download
    browserCookies = await ctx.cookies();

    await page.close();
    await ctx.close();
    await browser.close();

    if (!realCdnUrl) {
      throw new Error('No video/mp4 URL found on donor page');
    }

    logger.info(`[${stepName}:${shortId}] Got CDN URL, downloading via stream...`);
    writeStepProgress(videoId, { step: 'download', status: 'running', percent: 5, detail: 'Downloading...' });

    // Step B: Download via axios stream with cookies (full file, not partial)
    const cookieHeader = browserCookies.map(c => c.name + '=' + c.value).join('; ');
    const tmpPath = outputPath + '.downloading';

    const resp = await axios({
      method: 'get',
      url: realCdnUrl,
      responseType: 'stream',
      timeout: 1800000, // 30 min
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://boobsradar.com/',
        'Cookie': cookieHeader,
      },
    });

    const totalBytes = parseInt(resp.headers['content-length'] || '0');
    let downloadedBytes = 0;
    let lastProgressWrite = 0;

    await streamPipeline(
      resp.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const now = Date.now();
        if (now - lastProgressWrite > 2000 && totalBytes > 0) {
          lastProgressWrite = now;
          const pct = Math.min(95, Math.round(downloadedBytes / totalBytes * 100));
          const dlMB = (downloadedBytes / 1048576).toFixed(1);
          const totalMB = (totalBytes / 1048576).toFixed(1);
          const speed = downloadedBytes / ((now - Date.parse(startedAt)) / 1000) / 1048576;
          writeStepProgress(videoId, {
            step: 'download', status: 'running', percent: pct,
            detail: `${dlMB}/${totalMB} MB (${speed.toFixed(1)} MB/s)`,
          });
        }
      }),
      createWriteStream(tmpPath)
    );

    // Verify downloaded file
    const dlStat = await stat(tmpPath);
    if (dlStat.size < 100000) {
      await unlink(tmpPath).catch(() => {});
      throw new Error(`Downloaded file too small: ${dlStat.size} bytes (min 100KB) — donor returned stub`);
    }

    // Move to final path
    await rename(tmpPath, outputPath);
    const sizeMB = (dlStat.size / 1048576).toFixed(1);
    logger.info(`[${stepName}:${shortId}] Downloaded: ${sizeMB}MB → ${outputPath}`);
  } catch (err) {
    // Cleanup on failure
    const tmpPath = outputPath + '.downloading';
    await unlink(tmpPath).catch(() => {});
    if (existsSync(outputPath) && (await stat(outputPath).catch(() => ({size:0}))).size < 100000) {
      await unlink(outputPath).catch(() => {});
    }
    throw new Error(`Download failed: ${err.message}`);
  }

  return videoId;
}

async function processTmdbEnrich(videoId, stepName) {
  const shortId = videoId.substring(0, 8);
  const TMDB_KEY = config.ai.tmdbApiKey;
  const TMDB_BASE = 'https://api.themoviedb.org/3';
  const TMDB_IMG = 'https://image.tmdb.org/t/p';

  // Helper: TMDB API call (supports both api_key and Bearer token)
  async function tmdbGet(path, params = {}) {
    const url = new URL(`${TMDB_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const headers = {};
    if (TMDB_KEY.startsWith('eyJ')) {
      // JWT Bearer token (v4 style key)
      headers['Authorization'] = `Bearer ${TMDB_KEY}`;
    } else {
      // Classic API key (v3)
      url.searchParams.set('api_key', TMDB_KEY);
    }

    const res = await axios.get(url.toString(), { timeout: 15000, headers });
    return res.data;
  }

  function makeSlug(text) {
    return slugify(text, { lower: true, strict: true, locale: 'en' }).substring(0, 200);
  }

  // 1. Get raw_video data
  const { rows: rawRows } = await query(`
    SELECT r.raw_title, r.raw_celebrities, r.raw_tags, r.raw_categories, r.raw_description
    FROM videos v
    JOIN raw_videos r ON v.raw_video_id = r.id
    WHERE v.id = $1
  `, [videoId]);

  if (!rawRows.length) throw new Error('No raw_video linked');
  const raw = rawRows[0];

  // Save donor_tags + donor_category early
  const donorTags = [...(raw.raw_tags || []), ...(raw.raw_categories || [])];
  await query(`UPDATE videos SET donor_tags = $2, donor_category = COALESCE(donor_category, $3), updated_at = NOW() WHERE id = $1`,
    [videoId, donorTags, raw.donor_category || null]);

  // 2. Parse celebrity names from raw_celebrities or raw_title
  let celebNames = (raw.raw_celebrities || []).filter(n => n && n.length > 2);
  if (celebNames.length === 0 && raw.raw_title) {
    // Try to extract "FirstName LastName" from title before any keyword
    const titleMatch = raw.raw_title.match(/^([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)+)/);
    if (titleMatch) celebNames = [titleMatch[1]];
  }

  // 3. Parse movie from title: "Name - MovieTitle (Year)" or "Name nude - Movie (2023)"
  let parsedMovieTitle = null;
  let parsedYear = null;
  if (raw.raw_title) {
    // Pattern: "... - MovieTitle (YYYY) ..."  or  "... in MovieTitle (YYYY)"
    const movieMatch = raw.raw_title.match(/(?:[-–—]|(?:\bin\b))\s+(.+?)\s*\((\d{4})\)/i);
    if (movieMatch) {
      parsedMovieTitle = movieMatch[1].trim();
      parsedYear = parseInt(movieMatch[2]);
    } else {
      // Try just year: "(YYYY)"
      const yearMatch = raw.raw_title.match(/\((\d{4})\)/);
      if (yearMatch) parsedYear = parseInt(yearMatch[1]);
    }
  }

  logger.info(`[${stepName}:${shortId}] Celebs: [${celebNames.join(', ')}], Movie: ${parsedMovieTitle || '?'} (${parsedYear || '?'})`);

  writeStepProgress(videoId, { step: 'tmdb_enrich', status: 'running', percent: 10, detail: `Searching ${celebNames.length} celebrity(s)...` });

  // ── CELEBRITY ENRICHMENT ──
  let celebrityIds = [];

  for (const celebName of celebNames) {
    try {
      let tmdbPerson = null;

      if (TMDB_KEY) {
        // Search TMDB for person
        const searchData = await tmdbGet('/search/person', { query: celebName });
        const match = searchData.results?.[0];

        if (match) {
          // Get full person details
          tmdbPerson = await tmdbGet(`/person/${match.id}`);
        }
      }

      // Create/find celebrity in DB
      const slug = makeSlug(celebName);
      const { rows: celebRows } = await query(`
        INSERT INTO celebrities (name, slug, status)
        VALUES ($1, $2, 'draft')
        ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
        RETURNING id, tmdb_id
      `, [celebName, slug]);

      const celebId = celebRows[0].id;
      celebrityIds.push(celebId);

      // Update with TMDB data if found and not already enriched
      if (tmdbPerson && !celebRows[0].tmdb_id) {
        const nationality = extractNationality(tmdbPerson.place_of_birth);
        const photoUrl = tmdbPerson.profile_path
          ? `${TMDB_IMG}/w500${tmdbPerson.profile_path}`
          : null;

        await query(`
          UPDATE celebrities SET
            tmdb_id = $2,
            photo_url = COALESCE(photo_url, $3),
            birth_date = COALESCE(birth_date, $4::date),
            nationality = COALESCE(nationality, $5),
            bio = COALESCE(bio, $6::jsonb),
            status = 'draft',
            updated_at = NOW()
          WHERE id = $1
        `, [
          celebId,
          tmdbPerson.id,
          photoUrl,
          tmdbPerson.birthday || null,
          nationality,
          tmdbPerson.biography ? JSON.stringify({ en: tmdbPerson.biography }) : null,
        ]);

        logger.info(`[${stepName}:${shortId}] Celebrity: ${celebName} → TMDB #${tmdbPerson.id}, nationality=${nationality || 'unknown'}`);
      } else if (!tmdbPerson) {
        logger.warn(`[${stepName}:${shortId}] Celebrity not found in TMDB: ${celebName}`);
      }

      // Link video ↔ celebrity
      await query(
        `INSERT INTO video_celebrities (video_id, celebrity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [videoId, celebId]
      );
    } catch (err) {
      logger.warn(`[${stepName}:${shortId}] Celebrity enrich failed for "${celebName}": ${err.message}`);
      // Non-blocking — continue with other celebs / movie
    }
  }

  writeStepProgress(videoId, { step: 'tmdb_enrich', status: 'running', percent: 50, detail: `${celebrityIds.length} celeb(s) done. Searching movie...` });

  // ── MOVIE ENRICHMENT ──
  let movieId = null;

  if (parsedMovieTitle || parsedYear) {
    try {
      let tmdbMovie = null;

      if (TMDB_KEY && parsedMovieTitle) {
        // Search TMDB for movie
        const params = { query: parsedMovieTitle };
        if (parsedYear) params.year = String(parsedYear);

        const searchData = await tmdbGet('/search/movie', params);
        let match = searchData.results?.[0];

        // If no movie result, try TV show search
        if (!match) {
          const tvData = await tmdbGet('/search/tv', params);
          match = tvData.results?.[0];
          if (match) {
            // Get TV details for production_countries
            const tvDetails = await tmdbGet(`/tv/${match.id}`);
            tmdbMovie = {
              ...match,
              title: match.name || match.title,
              release_date: match.first_air_date,
              production_countries: tvDetails.production_countries || [],
              poster_path: match.poster_path,
              id: match.id,
            };
          }
        } else {
          // Get movie details for production_countries
          const movieDetails = await tmdbGet(`/movie/${match.id}`);
          tmdbMovie = movieDetails;
        }
      }

      // Determine title and year
      const movieTitle = tmdbMovie?.title || parsedMovieTitle || raw.raw_title?.substring(0, 200) || 'Unknown';
      const movieYear = tmdbMovie?.release_date
        ? parseInt(tmdbMovie.release_date.substring(0, 4))
        : parsedYear;

      // Extract countries
      const countries = tmdbMovie?.production_countries
        ?.map(c => c.iso_3166_1)
        .filter(Boolean) || null;

      const movieSlug = makeSlug(`${movieTitle}${movieYear ? '-' + movieYear : ''}`);
      const posterUrl = tmdbMovie?.poster_path
        ? `${TMDB_IMG}/w500${tmdbMovie.poster_path}`
        : null;

      // Create/find movie
      const { rows: movieRows } = await query(`
        INSERT INTO movies (title, slug, year, status)
        VALUES ($1, $2, $3, 'draft')
        ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
        RETURNING id, tmdb_id
      `, [movieTitle, movieSlug, movieYear]);

      movieId = movieRows[0].id;

      // Update with TMDB data if not already enriched
      if (tmdbMovie && !movieRows[0].tmdb_id) {
        const genres = tmdbMovie.genres
          ? tmdbMovie.genres.map(g => g.name)
          : [];

        await query(`
          UPDATE movies SET
            tmdb_id = $2,
            poster_url = COALESCE(poster_url, $3),
            countries = COALESCE(countries, $4::varchar[]),
            genres = COALESCE(NULLIF(genres, '{}'), $5::text[]),
            description = COALESCE(description, $6::jsonb),
            status = 'draft',
            updated_at = NOW()
          WHERE id = $1
        `, [
          movieId,
          tmdbMovie.id,
          posterUrl,
          countries,
          genres,
          tmdbMovie.overview ? JSON.stringify({ en: tmdbMovie.overview }) : null,
        ]);

        logger.info(`[${stepName}:${shortId}] Movie: ${movieTitle} (${movieYear}) → TMDB #${tmdbMovie.id}, countries=[${countries?.join(',') || '?'}]`);
      } else if (!tmdbMovie) {
        logger.warn(`[${stepName}:${shortId}] Movie not found in TMDB: ${parsedMovieTitle}`);
      }

      // Link movie ↔ video
      await query(
        `INSERT INTO movie_scenes (movie_id, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [movieId, videoId]
      );

      // Link movie ↔ celebrities
      for (const celebId of celebrityIds) {
        await query(
          `INSERT INTO movie_celebrities (movie_id, celebrity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [movieId, celebId]
        );
      }
    } catch (err) {
      logger.warn(`[${stepName}:${shortId}] Movie enrich failed: ${err.message}`);
      // Non-blocking — continue pipeline
    }
  }

  writeStepProgress(videoId, { step: 'tmdb_enrich', status: 'running', percent: 100, detail: `Done: ${celebrityIds.length} celeb(s), movie=${movieId ? 'yes' : 'none'}` });
  logger.info(`[${stepName}:${shortId}] Enriched: ${celebrityIds.length} celeb(s), movie=${movieId || 'none'}, donor_tags=${donorTags.length}`);
}

async function processAiVision(videoId, stepName) {
  const shortId = videoId.substring(0, 8);
  const scriptsDir = __dirname;
  const SUBPROCESS_TIMEOUT = 300000; // 300 seconds (5 min) — File API upload can be slow

  // Helper: run a script as subprocess with timeout
  async function runScript(scriptName, args = []) {
    const scriptPath = join(scriptsDir, scriptName);
    logger.info(`[${stepName}:${shortId}] Running: node ${scriptName} ${args.join(' ')}`);

    try {
      const { stdout, stderr } = await execFileAsync(
        'node',
        [scriptPath, ...args],
        {
          cwd: scriptsDir,
          timeout: SUBPROCESS_TIMEOUT,
          killSignal: 'SIGKILL', // SIGTERM may be ignored by hung subprocesses
          maxBuffer: 10 * 1024 * 1024, // 10MB
          env: { ...process.env },
        }
      );

      if (stdout) {
        // Log last few meaningful lines
        const lines = stdout.trim().split('\n').filter(l => l.trim());
        const tail = lines.slice(-5).join('\n  ');
        logger.info(`[${stepName}:${shortId}] ${scriptName} output:\n  ${tail}`);
      }
      if (stderr) {
        logger.warn(`[${stepName}:${shortId}] ${scriptName} stderr: ${stderr.substring(0, 500)}`);
      }

      return { exitCode: 0, stdout, stderr };
    } catch (err) {
      // execFile rejects on non-zero exit or timeout
      const exitCode = err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'MAXBUF'
        : err.killed ? 'TIMEOUT'
        : err.code || 1;

      return {
        exitCode,
        stdout: err.stdout || '',
        stderr: err.stderr || '',
        error: err.message,
      };
    }
  }

  // == Step 1: AI Vision Analyze ==
  writeStepProgress(videoId, { step: 'ai_vision', status: 'running', percent: 10, detail: 'Gemini analyzing video...' });
  const visionResult = await runScript('ai-vision-analyze.js', [`--video-id=${videoId}`]);

  if (visionResult.exitCode !== 0) {
    // Check if it's a censorship fallback (still saved metadata)
    const { rows } = await query(
      `SELECT ai_vision_status FROM videos WHERE id = $1`,
      [videoId]
    );
    const status = rows[0]?.ai_vision_status;

    if (status === 'censored') {
      // Censored but fallback tags saved → continue pipeline
      logger.warn(`[${stepName}:${shortId}] AI Vision censored, using donor tag fallback`);
    } else if (status === 'completed') {
      // Completed despite non-zero exit (warnings in stderr)
      logger.info(`[${stepName}:${shortId}] AI Vision completed (with warnings)`);
    } else if (visionResult.exitCode === 'TIMEOUT') {
      // Subprocess killed (5min limit) before it could save its own fallback — handle here
      await query(
        `UPDATE videos SET ai_vision_status = 'timeout_fallback', updated_at = NOW() WHERE id = $1`,
        [videoId]
      );
      logger.warn(`[${stepName}:${shortId}] AI Vision timed out after 300s, continuing with donor tags`);
    } else {
      // Real failure → throw for retry
      throw new Error(`ai-vision-analyze.js failed (exit=${visionResult.exitCode}): ${visionResult.error || visionResult.stderr?.substring(0, 300)}`);
    }
  }

  writeStepProgress(videoId, { step: 'ai_vision', status: 'running', percent: 60, detail: 'Generating 10 languages...' });

  // ── Step 2: Generate multilang content (title, slug, review, seo in 10 languages) ──
  const mlResult = await runScript('generate-multilang.js', [`--video-id=${videoId}`]);
  if (mlResult.exitCode !== 0) {
    throw new Error(`generate-multilang.js failed (exit=${mlResult.exitCode}): ${mlResult.error || mlResult.stderr?.substring(0, 300)}`);
  }

  writeStepProgress(videoId, { step: 'ai_vision', status: 'running', percent: 90, detail: 'Verifying metadata...' });

  // Verify metadata.json was created
  const metadataPath = join(WORK_DIR, videoId, 'metadata.json');
  if (existsSync(metadataPath)) {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    logger.info(`[${stepName}:${shortId}] Vision result: nudity=${metadata.nudity_level}, scene=${metadata.scene_type}, tags=[${(metadata.all_tags || []).join(',')}]`);
  }
}

// ============================================================
// Watermark: settings loader + FFmpeg filter builders + step
// ============================================================

const WATERMARK_TEXT = 'celeb.skin';
const WATERMARK_DEFAULTS = {
  watermarkType: 'text',
  watermarkImageUrl: '',
  watermarkScale: 0.1,
  opacity: 0.3,
  fontSize: 24,
  fontColor: 'white',
  position: 'bottom-right',
  margin: 20,
  watermarkMovement: 'rotating_corners',
};

async function loadWatermarkSettings() {
  try {
    const { rows } = await query(
      `SELECT key, value FROM settings WHERE key LIKE 'watermark_%'`
    );
    const db = {};
    for (const row of rows) db[row.key] = row.value;
    return {
      ...WATERMARK_DEFAULTS,
      ...(db.watermark_type         && { watermarkType: db.watermark_type }),
      ...(db.watermark_image_url    && { watermarkImageUrl: db.watermark_image_url }),
      ...(db.watermark_scale        && { watermarkScale: parseFloat(db.watermark_scale) }),
      ...(db.watermark_opacity      && { opacity: parseFloat(db.watermark_opacity) }),
      ...(db.watermark_movement     && { watermarkMovement: db.watermark_movement }),
    };
  } catch (err) {
    logger.warn(`Could not load watermark settings: ${err.message}. Using defaults.`);
    return { ...WATERMARK_DEFAULTS };
  }
}

function buildImageOverlayFilter(margin, opacity, scale, movement) {
  const scaleFilter = `[1:v]scale=iw*${scale}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm]`;
  // Normalize SAR to 1:1 and ensure even dimensions before overlay
  const sarNorm = `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1:1[v0]`;
  if (movement === 'static') {
    return `${scaleFilter};${sarNorm};[v0][wm]overlay=x=W-w-${margin}:y=H-h-${margin}`;
  }
  const m = margin;
  const overlayExpr = [
    `overlay=`,
    `x='if(lt(mod(t\\,240)\\,60)\\,W-w-${m}\\,if(lt(mod(t\\,240)\\,120)\\,W-w-${m}\\,if(lt(mod(t\\,240)\\,180)\\,${m}\\,${m})))'`,
    `:y='if(lt(mod(t\\,240)\\,60)\\,${m}\\,if(lt(mod(t\\,240)\\,120)\\,H-h-${m}\\,if(lt(mod(t\\,240)\\,180)\\,H-h-${m}\\,${m})))'`,
  ].join('');
  return `${scaleFilter};${sarNorm};[v0][wm]${overlayExpr}`;
}

function buildTextFilter(cfg) {
  const alpha = cfg.opacity;
  const m = cfg.margin;
  if (cfg.watermarkMovement === 'static') {
    let x, y;
    switch (cfg.position) {
      case 'bottom-left': x = String(m); y = `h-th-${m}`; break;
      case 'top-right':   x = `w-tw-${m}`; y = String(m); break;
      case 'top-left':    x = String(m); y = String(m); break;
      default:            x = `w-tw-${m}`; y = `h-th-${m}`;
    }
    return [
      `drawtext=text='${WATERMARK_TEXT}'`,
      `fontsize=${cfg.fontSize}`, `fontcolor=${cfg.fontColor}@${alpha}`,
      `x=${x}`, `y=${y}`,
      `shadowcolor=black@${alpha * 0.7}`, `shadowx=1`, `shadowy=1`,
    ].join(':');
  }
  const xExpr = `'if(lt(mod(t\\,240)\\,60)\\,w-tw-${m}\\,if(lt(mod(t\\,240)\\,120)\\,w-tw-${m}\\,if(lt(mod(t\\,240)\\,180)\\,${m}\\,${m})))'`;
  const yExpr = `'if(lt(mod(t\\,240)\\,60)\\,${m}\\,if(lt(mod(t\\,240)\\,120)\\,h-th-${m}\\,if(lt(mod(t\\,240)\\,180)\\,h-th-${m}\\,${m})))'`;
  return [
    `drawtext=text='${WATERMARK_TEXT}'`,
    `fontsize=${cfg.fontSize}`, `fontcolor=${cfg.fontColor}@${alpha}`,
    `x=${xExpr}`, `y=${yExpr}`,
    `shadowcolor=black@${alpha * 0.7}`, `shadowx=1`, `shadowy=1`,
  ].join(':');
}

async function downloadWatermarkPng(url, destPath) {
  // Try CDN URL first with Referer, then Storage API fallback
  const cdnUrl = process.env.BUNNY_CDN_URL || 'https://celebskin-cdn.b-cdn.net';
  const storageZone = process.env.BUNNY_STORAGE_ZONE || 'celebskin-media';
  const storageKey = process.env.BUNNY_STORAGE_KEY;
  const storageHost = process.env.BUNNY_STORAGE_HOST || 'storage.bunnycdn.com';

  // Convert CDN URL to storage path: https://cdn/path → https://storage/zone/path
  let storageUrl = null;
  if (storageKey && url.startsWith(cdnUrl)) {
    const filePath = url.replace(cdnUrl, '');
    storageUrl = `https://${storageHost}/${storageZone}${filePath}`;
  }

  // Try with Referer first
  try {
    const resp = await axios({ method: 'get', url, responseType: 'stream', timeout: 30000,
      headers: { 'Referer': 'https://celeb.skin/' } });
    await streamPipeline(resp.data, createWriteStream(destPath));
    return;
  } catch (e) {
    if (!storageUrl) throw e;
  }

  // Fallback: Storage API with AccessKey
  const resp = await axios({ method: 'get', url: storageUrl, responseType: 'stream', timeout: 30000,
    headers: { 'AccessKey': storageKey } });
  await streamPipeline(resp.data, createWriteStream(destPath));
}

function runFFmpegWatermark(ffmpegArgs, timeoutMs, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      const str = chunk.toString();
      stderr += str;
      if (onProgress) {
        const m = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (m) {
          const sec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          onProgress(sec);
        }
      }
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-500)}`));
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`FFmpeg timeout (${Math.round(timeoutMs / 60000)}min)`));
    }, timeoutMs);
  });
}

async function processWatermark(videoId, stepName) {
  const shortId = videoId.substring(0, 8);

  // Atomic claim: try to set status=watermarking. If already watermarking/watermarking_home/published/failed — skip
  const { rowCount: claimed } = await query(
    `UPDATE videos SET status = 'watermarking', pipeline_step = 'watermark', updated_at = NOW()
     WHERE id = $1 AND status NOT IN ('watermarking', 'watermarking_home', 'watermarked', 'published', 'failed', 'needs_review')`,
    [videoId]
  );
  if (claimed === 0) {
    const { rows: [cur] } = await query('SELECT status FROM videos WHERE id = $1', [videoId]);
    logger.info(`[${stepName}:${shortId}] Already ${cur?.status || 'unknown'} — skipping watermark`);
    return '__skip__';
  }

  const workDir = join(WORK_DIR, videoId);
  const inputPath = join(workDir, 'original.mp4');
  const outputPath = join(workDir, 'watermarked.mp4');

  // Verify input exists — if missing, this is unrecoverable (don't waste retries)
  if (!existsSync(inputPath)) {
    // Mark as permanent failure — no point retrying without the file
    await query(
      `UPDATE videos SET status = 'failed', pipeline_step = 'watermark',
       pipeline_error = 'original.mp4 missing from workdir (FFmpeg crash or disk issue)',
       updated_at = NOW() WHERE id = $1`, [videoId]
    );
    throw new Error("original.mp4 not found in workdir — marked as failed (no retry)");
  }

  // Load watermark settings from DB
  const wmCfg = await loadWatermarkSettings();
  logger.info(`[${stepName}:${shortId}] Watermark type=${wmCfg.watermarkType}, opacity=${wmCfg.opacity}, movement=${wmCfg.watermarkMovement}`);

  // Build FFmpeg args
  let ffmpegArgs;
  const baseArgs = [
    '-fflags', '+genpts+discardcorrupt',
  ];
  const outputArgs = [
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-af', 'aresample=async=1:first_pts=0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-sar', '1:1',
    '-preset', 'veryfast', '-crf', '20',
    '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
    '-bf', '2', '-threads', '0',
    '-max_muxing_queue_size', '4096',
    '-movflags', '+faststart',
    '-y', outputPath,
  ];

  let useImage = wmCfg.watermarkType === 'image' && wmCfg.watermarkImageUrl;
  if (useImage) {
    // Download watermark PNG to workdir
    const wmPngPath = join(workDir, 'watermark.png');
    try {
      await downloadWatermarkPng(wmCfg.watermarkImageUrl, wmPngPath);
    } catch (err) {
      logger.warn(`[${stepName}:${shortId}] Image watermark download failed (${err.message}), falling back to text`);
      useImage = false;
    }
    if (useImage) {
      const filterComplex = buildImageOverlayFilter(
        wmCfg.margin, wmCfg.opacity, wmCfg.watermarkScale, wmCfg.watermarkMovement
      );
      ffmpegArgs = [...baseArgs, '-i', inputPath, '-i', wmPngPath, '-filter_complex', filterComplex, ...outputArgs];
    }
  }
  if (!useImage) {
    const textFilter = buildTextFilter(wmCfg);
    ffmpegArgs = [...baseArgs, '-i', inputPath, '-vf', textFilter, ...outputArgs];
  }

  // Run FFmpeg with 30 min timeout + progress tracking
  const wmDuration = await getVideoDuration(inputPath);
  logger.info(`[${stepName}:${shortId}] Running FFmpeg watermark... (duration=${wmDuration.toFixed(1)}s)`);
  writeStepProgress(videoId, { step: 'watermark', status: 'running', percent: 0, detail: 'FFmpeg starting...' });
  let lastWmProgressWrite = 0;
  await runFFmpegWatermark(ffmpegArgs, 30 * 60 * 1000, (currentSec) => {
    const now = Date.now();
    if (now - lastWmProgressWrite < 2000) return;
    lastWmProgressWrite = now;
    const pct = wmDuration > 0 ? Math.min(99, Math.round(currentSec / wmDuration * 100)) : 0;
    writeStepProgress(videoId, {
      step: 'watermark', status: 'running', percent: pct,
      detail: `FFmpeg ${pct}% (${Math.round(currentSec)}s/${Math.round(wmDuration)}s)`,
    });
  });

  // Verify output
  const outStat = await stat(outputPath);
  if (outStat.size === 0) {
    throw new Error(`watermarked.mp4 is 0 bytes`);
  }
  const inStat = await stat(inputPath);
  logger.info(`[${stepName}:${shortId}] Watermarked OK: ${(inStat.size / 1048576).toFixed(1)}MB → ${(outStat.size / 1048576).toFixed(1)}MB`);

  // Update DB
  await query(
    `UPDATE videos SET pipeline_step = 'watermarked', pipeline_error = NULL, updated_at = NOW() WHERE id = $1`,
    [videoId]
  );
  await query(
    `INSERT INTO processing_log (video_id, step, status, message, metadata)
     VALUES ($1, 'watermark', 'completed', 'Watermark applied', $2::jsonb)`,
    [videoId, JSON.stringify({
      type: useImage ? 'image' : 'text',
      opacity: wmCfg.opacity,
      movement: wmCfg.watermarkMovement,
      originalSize: inStat.size,
      watermarkedSize: outStat.size,
    })]
  );
}

// ============================================================
// Media Generate: screenshots, preview clip, preview GIF
// ============================================================

const MEDIA_DEFAULTS = {
  thumbCount: 8,
  thumbWidth: 1280,
  previewDuration: 6,
  previewWidth: 480,
  previewCrf: 28,
  gifDuration: 4,
  gifFps: 8,
  gifWidth: 480,
};

async function ffprobeValue(args, timeoutMs = 15000) {
  try {
    const { stdout } = await execFileAsync('ffprobe', args, { timeout: timeoutMs });
    return stdout.trim();
  } catch { return ''; }
}

async function getVideoDuration(videoPath) {
  const raw = await ffprobeValue(['-v','quiet','-show_entries','format=duration','-of','csv=p=0', videoPath]);
  return parseFloat(raw) || 0;
}

async function getVideoResolution(videoPath) {
  const raw = await ffprobeValue(['-v','quiet','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0', videoPath]);
  const [w, h] = raw.split(',').map(Number);
  return { width: w || 1920, height: h || 1080 };
}

function formatDuration(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  return `${mins}:${String(secs).padStart(2,'0')}`;
}

async function extractScreenshot(videoPath, timestamp, outputPath, width) {
  await execFileAsync('ffmpeg', [
    '-ss', String(timestamp), '-i', videoPath,
    '-vframes', '1', '-vf', `scale=${width}:-2`, '-q:v', '2',
    '-y', outputPath,
  ], { timeout: 30000 });
}

async function generatePreviewClip(videoPath, outputPath, startSec, duration, width, crf) {
  await execFileAsync('ffmpeg', [
    '-ss', String(Math.max(0, startSec).toFixed(2)),
    '-i', videoPath,
    '-t', String(duration),
    '-vf', `scale=${width}:-2`,
    '-an',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
    '-movflags', '+faststart',
    '-y', outputPath,
  ], { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
}

async function generatePreviewGif(videoPath, outputPath, startSec, duration, width, fps) {
  await execFileAsync('ffmpeg', [
    '-ss', String(startSec),
    '-i', videoPath,
    '-t', String(duration),
    '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
    '-loop', '0',
    '-y', outputPath,
  ], { timeout: 120000 });
}

async function processMedia(videoId, stepName) {
  const shortId = videoId.substring(0, 8);

  const workDir = join(WORK_DIR, videoId);

  // Use watermarked video as source (screenshots/preview should show watermark)
  const watermarkedPath = join(workDir, 'watermarked.mp4');
  const originalPath = join(workDir, 'original.mp4');
  const videoPath = existsSync(watermarkedPath) ? watermarkedPath : originalPath;
  if (!existsSync(videoPath)) {
    throw new Error(`No video file found in workdir (checked watermarked.mp4, original.mp4)`);
  }

  // ── Get video info ─────────────────────────────────────
  const duration = await getVideoDuration(videoPath);
  if (duration < 2) throw new Error(`Video too short: ${duration.toFixed(1)}s`);
  const resolution = await getVideoResolution(videoPath);
  const quality = resolution.height >= 1080 ? '1080p'
    : resolution.height >= 720 ? '720p'
    : resolution.height >= 480 ? '480p' : '360p';
  logger.info(`[${stepName}:${shortId}] Duration=${duration.toFixed(1)}s, ${resolution.width}x${resolution.height} (${quality})`);

  // ── Load hot_moments / AI metadata ─────────────────────
  let hotMoments = null;
  let bestThumbnailSec = null;
  let previewStartSec = null;

  // Try metadata.json first (written by ai-vision-analyze.js)
  const metadataPath = join(workDir, 'metadata.json');
  if (existsSync(metadataPath)) {
    try {
      const meta = JSON.parse(await readFile(metadataPath, 'utf8'));
      hotMoments = meta.hot_moments || meta.screenshot_timestamps || null;
      bestThumbnailSec = meta.best_thumbnail_sec ?? null;
      previewStartSec = meta.preview_start_sec ?? null;
    } catch {}
  }

  // Fallback: try DB
  if (!hotMoments) {
    try {
      const { rows } = await query(
        `SELECT hot_moments, best_thumbnail_sec, preview_start_sec FROM videos WHERE id = $1`,
        [videoId]
      );
      if (rows[0]) {
        hotMoments = rows[0].hot_moments;
        bestThumbnailSec = bestThumbnailSec ?? rows[0].best_thumbnail_sec;
        previewStartSec = previewStartSec ?? rows[0].preview_start_sec;
      }
    } catch {}
  }

  const hasAI = Array.isArray(hotMoments) && hotMoments.length >= 2;

  // ── Determine screenshot timestamps ────────────────────
  const timestamps = [];
  const thumbCount = duration > 600 ? 20 : duration > 300 ? 16 : 12; // dynamic: 12/16/20 by duration

  if (hasAI) {
    // Filter valid timestamps within duration
    const valid = hotMoments
      .map(t => typeof t === 'number' ? t : (typeof t === 'object' && t !== null ? (t.timestamp || t.sec || t.time) : null))
      .filter(t => typeof t === 'number' && t >= 0 && t < duration)
      .sort((a, b) => a - b);

    // Include best_thumbnail_sec
    if (typeof bestThumbnailSec === 'number' && bestThumbnailSec >= 0 && bestThumbnailSec < duration) {
      if (!valid.some(t => Math.abs(t - bestThumbnailSec) < 1)) {
        valid.push(bestThumbnailSec);
        valid.sort((a, b) => a - b);
      }
    }

    // Pad with uniform if too few
    const existing = new Set(valid.map(t => Math.round(t)));
    for (let i = 0; i < thumbCount && valid.length < thumbCount; i++) {
      const ts = Math.max(0.5, duration * (i + 1) / (thumbCount + 1));
      if (!existing.has(Math.round(ts))) {
        valid.push(ts);
        existing.add(Math.round(ts));
      }
    }
    valid.sort((a, b) => a - b);
    timestamps.push(...valid.slice(0, thumbCount));
    logger.info(`[${stepName}:${shortId}] AI timestamps: ${timestamps.length} (hot_moments=${hotMoments.length}, best=${bestThumbnailSec}s)`);
  } else {
    // Fallback: uniform distribution
    for (let i = 0; i < thumbCount; i++) {
      timestamps.push(Math.max(0.5, duration * (i + 1) / (thumbCount + 1)));
    }
    logger.info(`[${stepName}:${shortId}] Uniform timestamps: ${timestamps.length} (no AI data)`);
  }

  // ── Extract screenshots ────────────────────────────────
  const totalMediaOps = timestamps.length + 2; // screenshots + preview + gif
  let mediaOpsDone = 0;
  const screenshotFiles = [];
  for (let i = 0; i < timestamps.length; i++) {
    const fileName = `thumb_${String(i + 1).padStart(3, '0')}.jpg`;
    const outPath = join(workDir, fileName);
    writeStepProgress(videoId, {
      step: 'media', status: 'running',
      percent: Math.round(mediaOpsDone / totalMediaOps * 100),
      detail: `Screenshot ${i + 1}/${timestamps.length}...`,
    });
    try {
      await extractScreenshot(videoPath, timestamps[i], outPath, MEDIA_DEFAULTS.thumbWidth);
      const s = await stat(outPath);
      if (s.size > 0) screenshotFiles.push(fileName);
      mediaOpsDone++;
    } catch (err) {
      mediaOpsDone++;
      logger.warn(`[${stepName}:${shortId}] Frame ${i+1} at ${timestamps[i].toFixed(1)}s failed: ${err.message}`);
    }
  }
  if (screenshotFiles.length < 2) {
    throw new Error(`Only ${screenshotFiles.length} screenshots extracted (need ≥2)`);
  }
  logger.info(`[${stepName}:${shortId}] Screenshots: ${screenshotFiles.length}/${timestamps.length}`);

  // ── Preview clip (6s, 480p, no audio) ──────────────────
  writeStepProgress(videoId, {
    step: 'media', status: 'running',
    percent: Math.round(mediaOpsDone / totalMediaOps * 100),
    detail: 'Generating preview clip...',
  });
  let previewClipOk = false;
  const previewPath = join(workDir, 'preview.mp4');
  {
    let clipStart;
    if (typeof previewStartSec === 'number' && previewStartSec >= 0 && previewStartSec < duration - 2) {
      clipStart = Math.min(previewStartSec + 2, duration - 6); // shift 2s later (AI timestamps slightly early)
    } else {
      clipStart = duration * 0.4; // fallback: 40% of duration
    }
    const clipDur = Math.min(MEDIA_DEFAULTS.previewDuration, duration - clipStart);
    if (clipDur >= 2) {
      try {
        await generatePreviewClip(videoPath, previewPath, clipStart, clipDur,
          MEDIA_DEFAULTS.previewWidth, MEDIA_DEFAULTS.previewCrf);
        const ps = await stat(previewPath);
        if (ps.size > 0) {
          previewClipOk = true;
          logger.info(`[${stepName}:${shortId}] Preview clip: ${clipDur.toFixed(1)}s from ${clipStart.toFixed(1)}s (${(ps.size/1024).toFixed(0)}KB)`);
        }
      } catch (err) {
        logger.warn(`[${stepName}:${shortId}] Preview clip failed: ${err.message}`);
      }
    }
  }

  mediaOpsDone++;
  // ── Preview GIF (4s from best_thumbnail_sec) ───────────
  writeStepProgress(videoId, {
    step: 'media', status: 'running',
    percent: Math.round(mediaOpsDone / totalMediaOps * 100),
    detail: 'Generating preview GIF...',
  });
  let gifOk = false;
  const gifPath = join(workDir, 'preview.gif');
  {
    let gifStart;
    if (typeof bestThumbnailSec === 'number' && bestThumbnailSec > 1 && bestThumbnailSec < duration - 2) {
      gifStart = Math.max(0, bestThumbnailSec + 1); // 1s after AI timestamp (AI slightly early)
    } else {
      gifStart = duration * 0.4;
    }
    const gifDur = Math.min(MEDIA_DEFAULTS.gifDuration, duration - gifStart);
    if (gifDur >= 2) {
      try {
        await generatePreviewGif(videoPath, gifPath, gifStart, gifDur,
          MEDIA_DEFAULTS.gifWidth, MEDIA_DEFAULTS.gifFps);
        const gs = await stat(gifPath);
        if (gs.size > 0) {
          gifOk = true;
          logger.info(`[${stepName}:${shortId}] Preview GIF: ${gifDur.toFixed(1)}s from ${gifStart.toFixed(1)}s (${(gs.size/1024).toFixed(0)}KB)`);
        }
      } catch (err) {
        logger.warn(`[${stepName}:${shortId}] Preview GIF failed: ${err.message}`);
      }
    }
  }

  // ── Pick best thumbnail ────────────────────────────────
  let bestThumbFile = screenshotFiles[0];
  if (typeof bestThumbnailSec === 'number' && timestamps.length > 0) {
    let bestIdx = 0, bestDiff = Infinity;
    for (let i = 0; i < timestamps.length && i < screenshotFiles.length; i++) {
      const diff = Math.abs(timestamps[i] - bestThumbnailSec);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    bestThumbFile = screenshotFiles[bestIdx];
  }

  // ── Update DB ──────────────────────────────────────────
  const screenshotPaths = screenshotFiles.map(f => `pipeline-work/${videoId}/${f}`);

  await query(
    `UPDATE videos SET
       screenshots = $2::jsonb,
       thumbnail_url = $3,
       duration_seconds = $4,
       duration_formatted = $5,
       quality = $6,
       pipeline_step = 'media_generated',
       pipeline_error = NULL,
       updated_at = NOW()
     WHERE id = $1`,
    [
      videoId,
      JSON.stringify(screenshotPaths),
      `pipeline-work/${videoId}/${bestThumbFile}`,
      Math.round(duration),
      formatDuration(duration),
      quality,
    ]
  );

  await query(
    `INSERT INTO processing_log (video_id, step, status, message, metadata)
     VALUES ($1, 'media_generate', 'completed', 'Media generated', $2::jsonb)`,
    [videoId, JSON.stringify({
      screenshots: screenshotFiles.length,
      previewClip: previewClipOk,
      previewGif: gifOk,
      duration: Math.round(duration),
      quality,
      hasAI,
      bestThumbnailSec,
      previewStartSec,
    })]
  );

  logger.info(`[${stepName}:${shortId}] Media done: ${screenshotFiles.length} thumbs, clip=${previewClipOk}, gif=${gifOk}`);
}

async function processCdnUpload(videoId, stepName) {
  const shortId = videoId.substring(0, 8);

  const workDir = join(WORK_DIR, videoId);
  const cdnBase = getVideoPath(videoId); // "videos/{videoId}"
  const uploadOpts = { videoId, step: 'cdn_upload', maxRetries: 3, delayMs: 5000, timeout: 600000 };

  logger.info(`[${stepName}:${shortId}] Uploading to BunnyCDN → ${cdnBase}/`);

  // Count total files to upload
  const wmExists = existsSync(join(workDir, 'watermarked.mp4'));
  const previewExists = existsSync(join(workDir, 'preview.mp4'));
  const gifExists = existsSync(join(workDir, 'preview.gif'));
  const thumbFilesList = readdirSync(workDir).filter(f => f.startsWith('thumb_') && f.endsWith('.jpg'));
  const cdnTotalFiles = (wmExists ? 1 : 0) + thumbFilesList.length + (previewExists ? 1 : 0) + (gifExists ? 1 : 0);
  let cdnFilesDone = 0;

  writeStepProgress(videoId, { step: 'cdn_upload', status: 'running', percent: 0, detail: `Uploading 0/${cdnTotalFiles} files...` });

  // ── 1. Upload watermarked.mp4 ──────────────────────────
  const watermarkedPath = join(workDir, 'watermarked.mp4');
  let watermarkedCdnUrl = null;
  if (existsSync(watermarkedPath)) {
    const sz = (await stat(watermarkedPath)).size;
    logger.info(`[${stepName}:${shortId}] Uploading watermarked.mp4 (${(sz / 1048576).toFixed(1)}MB)...`);
    watermarkedCdnUrl = await uploadFile(watermarkedPath, `${cdnBase}/watermarked.mp4`, uploadOpts);
    cdnFilesDone++;
    writeStepProgress(videoId, { step: 'cdn_upload', status: 'running', percent: Math.round(cdnFilesDone / cdnTotalFiles * 100), detail: `Uploading ${cdnFilesDone}/${cdnTotalFiles} files (watermarked.mp4 done)` });
    logger.info(`[${stepName}:${shortId}] ✓ watermarked.mp4 → ${watermarkedCdnUrl}`);
  } else {
    logger.warn(`[${stepName}:${shortId}] watermarked.mp4 not found, skipping`);
  }

  // ── 2. Upload screenshots ─────────────────────────────
  const thumbFiles = readdirSync(workDir).filter(f => f.startsWith('thumb_') && f.endsWith('.jpg')).sort();
  const screenshotCdnUrls = [];
  let thumbnailCdnUrl = null;

  // Read current thumbnail_url from DB to find which thumb is the best
  let bestThumbFile = null;
  try {
    const { rows } = await query(`SELECT thumbnail_url FROM videos WHERE id = $1`, [videoId]);
    if (rows[0]?.thumbnail_url) {
      const parts = rows[0].thumbnail_url.split('/');
      bestThumbFile = parts[parts.length - 1]; // e.g. "thumb_003.jpg"
    }
  } catch {}

  const imgOpts = { ...uploadOpts, timeout: 60000 };
  for (const thumbFile of thumbFiles) {
    const localPath = join(workDir, thumbFile);
    const cdnUrl = await uploadFile(localPath, `${cdnBase}/${thumbFile}`, imgOpts);
    screenshotCdnUrls.push(cdnUrl);
    cdnFilesDone++;
    writeStepProgress(videoId, { step: 'cdn_upload', status: 'running', percent: Math.round(cdnFilesDone / cdnTotalFiles * 100), detail: `Uploading ${cdnFilesDone}/${cdnTotalFiles} files (${thumbFile})` });
    if (thumbFile === bestThumbFile) {
      thumbnailCdnUrl = cdnUrl;
    }
  }
  // Fallback: first screenshot as thumbnail
  if (!thumbnailCdnUrl && screenshotCdnUrls.length > 0) {
    thumbnailCdnUrl = screenshotCdnUrls[0];
  }
  logger.info(`[${stepName}:${shortId}] ✓ ${screenshotCdnUrls.length} screenshots uploaded`);

  // ── 3. Upload preview.mp4 ─────────────────────────────
  let previewCdnUrl = null;
  const previewPath = join(workDir, 'preview.mp4');
  if (existsSync(previewPath)) {
    previewCdnUrl = await uploadFile(previewPath, `${cdnBase}/preview.mp4`, { ...uploadOpts, timeout: 120000 });
    cdnFilesDone++;
    writeStepProgress(videoId, { step: 'cdn_upload', status: 'running', percent: Math.round(cdnFilesDone / cdnTotalFiles * 100), detail: `Uploading ${cdnFilesDone}/${cdnTotalFiles} files (preview.mp4 done)` });
    logger.info(`[${stepName}:${shortId}] ✓ preview.mp4 → ${previewCdnUrl}`);
  }

  // ── 4. Upload preview.gif ─────────────────────────────
  let gifCdnUrl = null;
  const gifPath = join(workDir, 'preview.gif');
  if (existsSync(gifPath)) {
    gifCdnUrl = await uploadFile(gifPath, `${cdnBase}/preview.gif`, { ...uploadOpts, timeout: 120000 });
    cdnFilesDone++;
    writeStepProgress(videoId, { step: 'cdn_upload', status: 'running', percent: Math.round(cdnFilesDone / cdnTotalFiles * 100), detail: `All ${cdnTotalFiles} files uploaded` });
    logger.info(`[${stepName}:${shortId}] ✓ preview.gif → ${gifCdnUrl}`);
  }

  // ── 5. Update DB with CDN URLs ─────────────────────────
  await query(
    `UPDATE videos SET
       video_url_watermarked = COALESCE($2, video_url_watermarked),
       video_url = COALESCE($2, video_url),
       thumbnail_url = COALESCE($3, thumbnail_url),
       screenshots = COALESCE($4::jsonb, screenshots),
       preview_url = COALESCE($5, preview_url),
       preview_gif_url = COALESCE($6, preview_gif_url),
       pipeline_step = 'cdn_uploaded',
       pipeline_error = NULL,
       updated_at = NOW()
     WHERE id = $1`,
    [
      videoId,
      watermarkedCdnUrl,
      thumbnailCdnUrl,
      screenshotCdnUrls.length > 0 ? JSON.stringify(screenshotCdnUrls) : null,
      previewCdnUrl,
      gifCdnUrl,
    ]
  );

  const totalFiles = (watermarkedCdnUrl ? 1 : 0) + screenshotCdnUrls.length + (previewCdnUrl ? 1 : 0) + (gifCdnUrl ? 1 : 0);
  await query(
    `INSERT INTO processing_log (video_id, step, status, message, metadata)
     VALUES ($1, 'cdn_upload', 'completed', 'CDN upload done', $2::jsonb)`,
    [videoId, JSON.stringify({
      filesUploaded: totalFiles,
      hasWatermarked: !!watermarkedCdnUrl,
      screenshots: screenshotCdnUrls.length,
      hasPreview: !!previewCdnUrl,
      hasGif: !!gifCdnUrl,
      cdnBase,
    })]
  );

  logger.info(`[${stepName}:${shortId}] CDN upload done: ${totalFiles} files`);
}

async function processPublish(videoId, stepName) {
  const shortId = videoId.substring(0, 8);

  writeStepProgress(videoId, { step: 'publish', status: 'running', percent: 0, detail: 'Verifying CDN URLs...' });

  // ── 1. Pre-flight: verify CDN URLs ─────────────────────
  const { rows: [video] } = await query(
    `SELECT video_url_watermarked, thumbnail_url, status FROM videos WHERE id = $1`,
    [videoId]
  );
  if (!video) throw new Error('Video not found in DB');

  const hasCdnVideo = video.video_url_watermarked?.includes('b-cdn.net');
  const hasCdnThumb = video.thumbnail_url?.includes('b-cdn.net');

  if (!hasCdnVideo || !hasCdnThumb) {
    // Not ready — send to review
    const missing = [];
    if (!hasCdnVideo) missing.push('video_url_watermarked');
    if (!hasCdnThumb) missing.push('thumbnail_url');
    logger.warn(`[${stepName}:${shortId}] Missing CDN URLs: ${missing.join(', ')} → needs_review`);
    await query(
      `UPDATE videos SET
         status = 'needs_review',
         pipeline_step = NULL,
         pipeline_error = $2,
         updated_at = NOW()
       WHERE id = $1`,
      [videoId, `Missing CDN: ${missing.join(', ')}`]
    );
    await query(
      `INSERT INTO processing_log (video_id, step, status, message)
       VALUES ($1, 'publish', 'skipped', $2)`,
      [videoId, `Sent to needs_review: missing ${missing.join(', ')}`]
    );
    return; // don't throw — this is a controlled skip, not a retry-worthy error
  }

  // ── 1a2. Verify CDN video is not a stub (min 500KB) ──
  try {
    const headResp = await axios.head(video.video_url_watermarked, {
      headers: { 'Referer': 'https://celeb.skin/' },
      timeout: 10000,
    });
    const cdnSize = parseInt(headResp.headers['content-length'] || '0');
    if (cdnSize < 500000) {
      logger.warn(`[${stepName}:${shortId}] CDN video too small: ${cdnSize} bytes → needs_review`);
      await query(
        `UPDATE videos SET status = 'needs_review', pipeline_step = NULL,
         pipeline_error = $2, updated_at = NOW() WHERE id = $1`,
        [videoId, `CDN video stub: ${cdnSize} bytes (min 500KB)`]
      );
      return;
    }
  } catch (headErr) {
    logger.warn(`[${stepName}:${shortId}] CDN HEAD check failed: ${headErr.message} — continuing`);
  }

  // ── 1b. Pre-flight: verify AI Vision completed (not censored fallback) ──
  const { rows: [aiCheck] } = await query(
    `SELECT ai_vision_status, ai_tags FROM videos WHERE id = $1`, [videoId]
  );
  if (aiCheck?.ai_vision_status === 'censored' || (!aiCheck?.ai_tags || aiCheck.ai_tags.length === 0)) {
    logger.warn(`[${stepName}:${shortId}] AI Vision=${aiCheck?.ai_vision_status}, tags=${aiCheck?.ai_tags?.length || 0} → needs_review`);
    await query(
      `UPDATE videos SET status = 'needs_review', pipeline_step = NULL, pipeline_error = $2, updated_at = NOW() WHERE id = $1`,
      [videoId, `AI Vision failed: status=${aiCheck?.ai_vision_status}, no tags`]
    );
    return;
  }

  // ── 1c. Pre-flight: verify translations (all 10 locales) ──
  const { rows: [trCheck] } = await query(
    `SELECT title, slug, review, seo_title, seo_description FROM videos WHERE id = $1`,
    [videoId]
  );
  const requiredLocales = ['en', 'ru', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'nl', 'tr'];
  const missingTranslations = [];
  for (const loc of requiredLocales) {
    if (!trCheck.title || !trCheck.title[loc]) missingTranslations.push(`title.${loc}`);
    if (!trCheck.slug || !trCheck.slug[loc]) missingTranslations.push(`slug.${loc}`);
  }
  if (!trCheck.review || !trCheck.review['ru']) missingTranslations.push('review.ru');
  if (!trCheck.seo_title || !trCheck.seo_title['ru']) missingTranslations.push('seo_title.ru');

  if (missingTranslations.length > 0) {
    logger.warn(`[${stepName}:${shortId}] Missing translations: ${missingTranslations.slice(0, 5).join(', ')}... (${missingTranslations.length} total) → needs_review`);
    await query(
      `UPDATE videos SET
         status = 'needs_review',
         pipeline_step = NULL,
         pipeline_error = $2,
         updated_at = NOW()
       WHERE id = $1`,
      [videoId, `Missing translations: ${missingTranslations.join(', ')}`]
    );
    return;
  }

  // ── 2. Publish video ───────────────────────────────────
  await query(
    `UPDATE videos SET
       status = 'published',
       published_at = NOW(),
       pipeline_step = NULL,
       pipeline_error = NULL,
       updated_at = NOW()
     WHERE id = $1`,
    [videoId]
  );
  writeStepProgress(videoId, { step: 'publish', status: 'running', percent: 30, detail: 'Publishing celebrities...' });
  logger.info(`[${stepName}:${shortId}] Video status → published`);

  // ── 3. Publish linked celebrities ──────────────────────
  const { rows: celebRows } = await query(
    `SELECT c.id, c.name FROM celebrities c
     JOIN video_celebrities vc ON vc.celebrity_id = c.id
     WHERE vc.video_id = $1 AND c.status != 'published'`,
    [videoId]
  );
  for (const celeb of celebRows) {
    await query(`UPDATE celebrities SET status = 'published', updated_at = NOW() WHERE id = $1`, [celeb.id]);
    logger.info(`[${stepName}:${shortId}] Celebrity "${celeb.name}" → published`);
  }

  writeStepProgress(videoId, { step: 'publish', status: 'running', percent: 50, detail: 'Publishing movies...' });
  // ── 4. Publish linked movies ───────────────────────────
  const { rows: movieRows } = await query(
    `SELECT m.id, m.title FROM movies m
     JOIN movie_scenes ms ON ms.movie_id = m.id
     WHERE ms.video_id = $1 AND m.status != 'published'`,
    [videoId]
  );
  for (const movie of movieRows) {
    await query(`UPDATE movies SET status = 'published', updated_at = NOW() WHERE id = $1`, [movie.id]);
    logger.info(`[${stepName}:${shortId}] Movie "${movie.title}" → published`);
  }

  writeStepProgress(videoId, { step: 'publish', status: 'running', percent: 70, detail: 'Creating tags...' });
  // ── 4b. Create tags + video_tags ──────────────────────
  // Priority: ai_tags (from AI Vision) > metadata.json > donor_tags (from scraper)
  const { rows: [videoForTags] } = await query(
    `SELECT ai_tags, donor_tags FROM videos WHERE id = $1`,
    [videoId]
  );

  let tagSource = 'none';
  let rawTagList = [];

  if (videoForTags?.ai_tags && videoForTags.ai_tags.length > 0) {
    // Best: AI Vision analyzed tags (already normalized)
    rawTagList = videoForTags.ai_tags;
    tagSource = 'ai_tags';
  } else {
    // Try metadata.json (written by ai-vision-analyze.js, still in workdir)
    const tagMetaPath = join(WORK_DIR, videoId, 'metadata.json');
    try {
      const tagMeta = JSON.parse(readFileSync(tagMetaPath, 'utf-8'));
      if (tagMeta.all_tags && tagMeta.all_tags.length > 0) {
        rawTagList = tagMeta.all_tags;
        tagSource = 'metadata.json';
      }
    } catch {}
    // Fallback: donor_tags from scraper
    if (rawTagList.length === 0) {
      rawTagList = mapDonorTags(videoForTags?.donor_tags || []);
      tagSource = 'donor_tags';
    }
  }
  logger.info(`[${stepName}:${shortId}] Tag source: ${tagSource} (${rawTagList.length} tags): [${rawTagList.join(', ')}]`);

  // ── 32 canonical tag slugs (ONLY these are allowed) ──
  const CANONICAL_SLUGS = new Set([
    'sexy','cleavage','bikini','lingerie','topless','butt','nude',
    'full-frontal','bush','sex-scene','explicit','oral','blowjob',
    'lesbian','masturbation','striptease','shower','skinny-dip',
    'rape-scene','gang-rape','bed-scene','romantic','rough',
    'threesome','bdsm','body-double','prosthetic',
    'movie','tv-show','music-video','on-stage','photoshoot',
  ]);

  // Normalize raw tag to slug
  function tagToSlug(raw) {
    return raw.toString().toLowerCase()
      .replace(/['']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  // Filter: only canonical slugs pass
  const seenSlugs = new Set();
  const canonicalSlugs = [];
  for (const rawTag of rawTagList) {
    const slug = tagToSlug(rawTag);
    if (CANONICAL_SLUGS.has(slug) && !seenSlugs.has(slug)) {
      seenSlugs.add(slug);
      canonicalSlugs.push(slug);
    }
  }

  // Look up tag IDs from DB (tags already exist with translations)
  const tagIds = [];
  for (const slug of canonicalSlugs) {
    const { rows } = await query(`SELECT id FROM tags WHERE slug = $1`, [slug]);
    if (rows[0]) tagIds.push(rows[0].id);
  }

  // Create video_tags links
  for (const tagId of tagIds) {
    await query(
      `INSERT INTO video_tags (video_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [videoId, tagId]
    );
  }
  logger.info(`[${stepName}:${shortId}] Tags: ${tagIds.length} canonical from ${rawTagList.length} ${tagSource} → [${canonicalSlugs.join(', ')}]`);

  // ── 4c. Auto-assign tag-based collections ──────────────
  const TAG_TO_COLLECTION = {
    'topless':     'topless-scenes',
    'sex-scene':   'sex-scenes',
    'lesbian':     'lesbian-scenes',
    'full-frontal':'full-frontal-nudity',
    'shower':      'shower-bath-scenes',
    'bed-scene':   'bed-scenes',
    'explicit':    'explicit-scenes',
  };
  for (const tagSlug of canonicalSlugs) {
    const collSlug = TAG_TO_COLLECTION[tagSlug];
    if (collSlug) {
      await query(
        `INSERT INTO collection_videos (collection_id, video_id)
         SELECT c.id, $1 FROM collections c WHERE c.slug = $2
         ON CONFLICT DO NOTHING`,
        [videoId, collSlug]
      );
    }
  }
  // Refresh videos_count for affected collections
  await query(
    `UPDATE collections c
     SET videos_count = (
       SELECT COUNT(*) FROM collection_videos cv WHERE cv.collection_id = c.id
     )
     WHERE c.slug = ANY($1::text[])`,
    [Object.values(TAG_TO_COLLECTION).filter(s => canonicalSlugs.some(t => TAG_TO_COLLECTION[t] === s))]
  );

  // Auto-update cover_url for affected collections (most-viewed video thumbnail)
  const affectedSlugs = [...new Set(canonicalSlugs.map(t => TAG_TO_COLLECTION[t]).filter(Boolean))];
  for (const cSlug of affectedSlugs) {
    await query(
      `UPDATE collections c SET cover_url = (
        SELECT v.thumbnail_url FROM collection_videos cv
        JOIN videos v ON v.id = cv.video_id
        WHERE cv.collection_id = c.id AND v.thumbnail_url IS NOT NULL
        ORDER BY v.views_count DESC NULLS LAST, v.created_at DESC
        LIMIT 1
      ) WHERE c.slug = $1`,
      [cSlug]
    );
  }

  // ── 4d. Link to donor category (collection) ──────────
  try {
    const { rows: [rawVid] } = await query(
      `SELECT rv.donor_category FROM raw_videos rv WHERE rv.id = (SELECT raw_video_id FROM videos WHERE id = $1)`,
      [videoId]
    );
    if (rawVid?.donor_category) {
      const { rowCount } = await query(
        `INSERT INTO collection_videos (collection_id, video_id)
         SELECT c.id, $1 FROM collections c WHERE c.slug = $2
         ON CONFLICT DO NOTHING`,
        [videoId, rawVid.donor_category]
      );
      if (rowCount > 0) {
        await query(
          `UPDATE collections SET videos_count = (SELECT COUNT(*) FROM collection_videos WHERE collection_id = collections.id) WHERE slug = $1`,
          [rawVid.donor_category]
        );
        logger.info(`[${stepName}:${shortId}] Linked to collection "${rawVid.donor_category}"`);
      }
    }
  } catch {}

  writeStepProgress(videoId, { step: 'publish', status: 'running', percent: 85, detail: 'Updating counts...' });
  // ── 5. Update counts ──────────────────────────────────
  // celebrities.videos_count
  await query(
    `UPDATE celebrities SET videos_count = sub.cnt
     FROM (
       SELECT vc.celebrity_id, COUNT(*) AS cnt
       FROM video_celebrities vc
       JOIN videos v ON v.id = vc.video_id AND v.status = 'published'
       GROUP BY vc.celebrity_id
     ) sub
     WHERE celebrities.id = sub.celebrity_id
       AND celebrities.id IN (
         SELECT celebrity_id FROM video_celebrities WHERE video_id = $1
       )`,
    [videoId]
  );

  // movies.scenes_count
  await query(
    `UPDATE movies SET scenes_count = sub.cnt
     FROM (
       SELECT ms.movie_id, COUNT(*) AS cnt
       FROM movie_scenes ms
       JOIN videos v ON v.id = ms.video_id AND v.status = 'published'
       GROUP BY ms.movie_id
     ) sub
     WHERE movies.id = sub.movie_id
       AND movies.id IN (
         SELECT movie_id FROM movie_scenes WHERE video_id = $1
       )`,
    [videoId]
  );

  // tags.videos_count
  await query(
    `UPDATE tags SET videos_count = sub.cnt
     FROM (
       SELECT vt.tag_id, COUNT(*) AS cnt
       FROM video_tags vt
       JOIN videos v ON v.id = vt.video_id AND v.status = 'published'
       GROUP BY vt.tag_id
     ) sub
     WHERE tags.id = sub.tag_id
       AND tags.id IN (
         SELECT tag_id FROM video_tags WHERE video_id = $1
       )`,
    [videoId]
  );

  // ── 6. Log ─────────────────────────────────────────────
  await query(
    `INSERT INTO processing_log (video_id, step, status, message, metadata)
     VALUES ($1, 'publish', 'completed', 'Published', $2::jsonb)`,
    [videoId, JSON.stringify({
      celebritiesPublished: celebRows.length,
      moviesPublished: movieRows.length,
    })]
  );

  logger.info(`[${stepName}:${shortId}] Published OK (${celebRows.length} celebs, ${movieRows.length} movies)`);
}

async function processCleanup(videoId, stepName) {
  const shortId = videoId.substring(0, 8);
  const workDir = join(WORK_DIR, videoId);

  writeStepProgress(videoId, { step: 'cleanup', status: 'running', percent: 0, detail: 'Checking status...' });

  // Only delete workdir if video was published successfully
  const { rows: [video] } = await query(
    `SELECT status FROM videos WHERE id = $1`, [videoId]
  );

  if (video?.status !== 'published' && video?.status !== 'needs_review') {
    logger.warn(`[${stepName}:${shortId}] Status="${video?.status}" (not published/needs_review) — keeping workdir for debug`);
    return;
  }

  // Published or needs_review — always clean workdir

  writeStepProgress(videoId, { step: 'cleanup', status: 'running', percent: 50, detail: 'Removing workdir...' });
  // Remove workdir
  if (existsSync(workDir)) {
    await rm(workDir, { recursive: true, force: true });
    logger.info(`[${stepName}:${shortId}] Deleted ${workDir}`);
  }

  // Mark raw_video as processed
  try {
    await query(
      `UPDATE raw_videos SET status = 'processed', updated_at = NOW()
       WHERE id = (SELECT raw_video_id FROM videos WHERE id = $1) AND raw_video_id IS NOT NULL`,
      [videoId]
    );
  } catch {}

  // Clear pipeline_step so video disappears from pipeline UI
  await query(
    `UPDATE videos SET pipeline_step = NULL, updated_at = NOW() WHERE id = $1`,
    [videoId]
  );

  logger.info(`[${stepName}:${shortId}] Cleanup done`);
}

const STEP_PROCESSORS = {
  download:     processDownload,
  tmdb_enrich:  processTmdbEnrich,
  ai_vision:    processAiVision,
  watermark:    processWatermark,
  media:        processMedia,
  cdn_upload:   processCdnUpload,
  publish:      processPublish,
  cleanup:      processCleanup,
};

// ============================================================
// Resume logic — scan workdirs to determine last completed step
// ============================================================

// Hard reset: delete ALL unpublished videos from DB, reset their raw_videos to pending
// This ensures clean re-download on next pipeline run
async function resetInProgressVideos() {
  try {
    // 1. Get all in-progress videos — DON'T DELETE, just reset status for re-processing
    const { rows: unpublished } = await query(
      `SELECT id, raw_video_id, status, pipeline_step, video_url FROM videos
       WHERE status NOT IN ('published', 'rejected', 'dmca_removed', 'needs_review', 'failed')`
    );

    if (unpublished.length === 0) {
      logger.info('No in-progress videos to reset');
      return;
    }

    logger.info(`Resetting ${unpublished.length} in-progress videos back to queue`);
    for (const v of unpublished) {
      logger.info(`  \u2022 ${v.id.substring(0,8)} status=${v.status} step=${v.pipeline_step}`);
    }

    // Reset to appropriate step based on what's already done
    // If has workdir with original.mp4 → reset to download step (will skip download if file exists)
    // Otherwise just reset status so pipeline re-queues them
    const videoIds = unpublished.map(v => v.id);

    await query(
      `UPDATE videos SET
        status = CASE
          WHEN pipeline_step IN ('watermarked', 'media', 'cdn_upload', 'publish') THEN 'watermarked'
          WHEN pipeline_step IN ('watermark', 'watermark_ready', 'watermarking_home') THEN 'watermark_ready'
          ELSE 'new'
        END,
        pipeline_step = CASE
          WHEN pipeline_step IN ('watermarked', 'media', 'cdn_upload', 'publish') THEN 'watermarked'
          WHEN pipeline_step IN ('watermark', 'watermark_ready', 'watermarking_home') THEN 'watermark_ready'
          ELSE NULL
        END,
        pipeline_error = NULL,
        updated_at = NOW()
      WHERE id = ANY($1::uuid[])`,
      [videoIds]
    );
    logger.info(`Reset ${videoIds.length} videos back to queue (preserved data)`);

    // No deletion at startup — videos will be re-queued
    // Deletion only happens in cleanupUnpublished() called from shutdown
  } catch (err) {
    logger.warn(`Failed to reset in-progress videos: ${err.message}`);
  }
}

// Full cleanup: delete ALL unpublished videos from DB + Bunny + workdir
// Called ONLY from shutdown (stop button), NEVER from startup
async function cleanupUnpublished() {
  try {
    const { rows: unpublished } = await query(
      `SELECT id, raw_video_id, video_url FROM videos
       WHERE status NOT IN ('published', 'rejected', 'dmca_removed', 'needs_review', 'failed')`
    );
    if (unpublished.length === 0) return;

    logger.info(`Cleanup: deleting ${unpublished.length} unpublished videos`);
    const videoIds = unpublished.map(v => v.id);

    // Delete relations
    for (const tbl of ['video_tags', 'video_celebrities', 'collection_videos', 'pipeline_failures', 'processing_log', 'movie_scenes']) {
      try { await query(`DELETE FROM ${tbl} WHERE video_id = ANY($1::uuid[])`, [videoIds]); } catch {}
    }

    // Delete videos
    await query(`DELETE FROM videos WHERE id = ANY($1::uuid[])`, [videoIds]);

    // Delete orphan raw_videos
    await query(
      `DELETE FROM raw_videos WHERE NOT EXISTS (SELECT 1 FROM videos WHERE videos.raw_video_id = raw_videos.id)`
    );

    // Delete from Bunny
    const storageZone = process.env.BUNNY_STORAGE_ZONE || 'celebskin-media';
    const storageKey = process.env.BUNNY_STORAGE_KEY;
    const storageHost = process.env.BUNNY_STORAGE_HOST || 'storage.bunnycdn.com';
    if (storageKey) {
      for (const v of unpublished) {
        try {
          const listResp = await axios.get(`https://${storageHost}/${storageZone}/videos/${v.id}/`, { headers: { AccessKey: storageKey }, timeout: 10000 }).catch(() => ({ data: [] }));
          for (const f of (Array.isArray(listResp.data) ? listResp.data : [])) {
            if (!f.IsDirectory && f.ObjectName) await axios.delete(`https://${storageHost}/${storageZone}/videos/${v.id}/${f.ObjectName}`, { headers: { AccessKey: storageKey }, timeout: 10000 }).catch(() => {});
          }
          await axios.delete(`https://${storageHost}/${storageZone}/videos/${v.id}/`, { headers: { AccessKey: storageKey }, timeout: 10000 }).catch(() => {});
        } catch {}
      }
    }

    // Clean workdirs
    for (const v of unpublished) {
      const dir = join(WORK_DIR, v.id);
      if (existsSync(dir)) try { await rm(dir, { recursive: true, force: true }); } catch {}
    }

    logger.info(`Cleanup done: ${unpublished.length} videos deleted from DB + Bunny + workdir`);
  } catch (err) {
    logger.warn(`Cleanup failed: ${err.message}`);
  }
}

async function resumeFromWorkdirs() {
  const resumed = { download: [], tmdb_enrich: [], ai_vision: [], watermark: [], media: [], cdn_upload: [], publish: [] };

  // Clean orphan raw_videos (not linked to any video) to unblock future scrapes
  try {
    const { rowCount } = await query(
      `DELETE FROM raw_videos WHERE id NOT IN (
        SELECT raw_video_id FROM videos WHERE raw_video_id IS NOT NULL
      )`
    );
    if (rowCount > 0) {
      logger.info(`Cleaned ${rowCount} orphan raw_videos (not linked to any video)`);
    }
  } catch (err) {
    logger.warn(`Failed to clean orphan raw_videos: ${err.message}`);
  }

  // Reset stuck processing raw_videos that have linked videos back to processed
  try {
    const { rowCount: resetCount } = await query(
      `UPDATE raw_videos SET status = processed
       WHERE status = processing
       AND id IN (SELECT raw_video_id FROM videos WHERE raw_video_id IS NOT NULL)`
    );
    if (resetCount > 0) {
      logger.info(`Reset ${resetCount} stuck processing raw_videos → processed`);
    }
  } catch (err) {
    logger.warn(`Failed to reset stuck raw_videos: ${err.message}`);
  }

  if (!existsSync(WORK_DIR)) return resumed;

  const dirs = readdirSync(WORK_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.match(/^[0-9a-f]{8}-/))
    .map(d => d.name);

  let removedEmpty = 0;

  for (const videoId of dirs) {
    const dir = join(WORK_DIR, videoId);

    // Check directory contents
    const files = readdirSync(dir);
    if (files.length === 0) {
      // Empty workdir — leftover from crash, remove
      try { await rm(dir, { recursive: true, force: true }); } catch {}
      removedEmpty++;
      continue;
    }

    const hasOriginal = existsSync(join(dir, 'original.mp4'));
    const hasMetadata = existsSync(join(dir, 'metadata.json'));
    const hasWatermarked = existsSync(join(dir, 'watermarked.mp4'));
    const hasPreview = existsSync(join(dir, 'preview.mp4'));
    const hasThumbs = files.some(f => f.startsWith('thumb_') && f.endsWith('.jpg'));

    // Check DB for CDN/publish status
    const { rows } = await query(
      `SELECT status, video_url_watermarked, thumbnail_url FROM videos WHERE id = $1`,
      [videoId]
    );
    const video = rows[0];
    if (!video) {
      // Video deleted from DB — orphan workdir, remove
      try { await rm(dir, { recursive: true, force: true }); } catch {}
      removedEmpty++;
      continue;
    }

    // Skip already finished
    if (video.status === 'published' || video.status === 'failed') {
      // Published — cleanup should handle this, but remove if somehow left
      if (video.status === 'published') {
        try { await rm(dir, { recursive: true, force: true }); } catch {}
        removedEmpty++;
      }
      continue;
    }

    const hasCdnVideo = video.video_url_watermarked?.includes('b-cdn.net');
    const hasCdnThumb = video.thumbnail_url?.includes('b-cdn.net');

    // Determine which step to resume FROM (next step to run)
    // Order: most-progressed first
    if (hasCdnVideo && hasCdnThumb) {
      resumed.publish.push(videoId);
    } else if (hasWatermarked && hasThumbs && hasPreview) {
      resumed.cdn_upload.push(videoId);
    } else if (hasWatermarked && !hasThumbs) {
      resumed.media.push(videoId);
    } else if (hasMetadata && !hasWatermarked) {
      resumed.watermark.push(videoId);
    } else if (hasOriginal && !hasMetadata) {
      // Check if TMDB enrichment was done
      const { rows: celebRows } = await query(
        `SELECT 1 FROM video_celebrities WHERE video_id = $1 LIMIT 1`,
        [videoId]
      );
      if (celebRows.length > 0) {
        resumed.ai_vision.push(videoId);
      } else {
        resumed.tmdb_enrich.push(videoId);
      }
    } else if (!hasOriginal) {
      // No original — re-download
      resumed.download.push(videoId);
    }
  }

  if (removedEmpty > 0) {
    logger.info(`Cleaned up ${removedEmpty} empty/orphan workdirs`);
  }

  return resumed;
}

// ============================================================
// Fetch pending raw_videos → seed download queue
// ============================================================

async function fetchPendingVideos(limit) {
  // Only COUNT pending raw_videos — don't claim or create video records yet
  // Videos will be created one-by-one when download worker picks them up
  const { rows } = await query(`
    SELECT id FROM raw_videos
    WHERE status = 'pending'
    ORDER BY created_at ASC
    ${limit > 0 ? `LIMIT ${limit}` : ''}
  `);

  return rows.map(r => r.id);  // raw_video IDs (not video IDs!)
}

// Create a video record from raw_video just before download starts
// Returns videoId (UUID) or null if should be skipped (duplicate)
async function claimRawVideoForDownload(rawVideoId) {
  // Atomically claim this raw_video
  const { rows: claimed } = await query(`
    UPDATE raw_videos SET status = 'processing', updated_at = NOW()
    WHERE id = $1 AND status = 'pending'
    RETURNING id, raw_title, donor_category
  `, [rawVideoId]);

  if (claimed.length === 0) return null; // already claimed by another worker

  const row = claimed[0];

  // Check if video record already exists
  const { rows: existing } = await query(
    `SELECT id, original_title FROM videos WHERE raw_video_id = $1`,
    [rawVideoId]
  );

  if (existing.length > 0) {
    // Dedup: check if original_title already published
    if (existing[0].original_title) {
      const { rows: pubDup } = await query(
        `SELECT 1 FROM videos WHERE status = 'published' AND original_title = $1 LIMIT 1`,
        [existing[0].original_title]
      );
      if (pubDup.length > 0) {
        logger.info(`[claimRaw] Skipping ${existing[0].id} — already published with same original_title`);
        await query(`UPDATE raw_videos SET status = 'processed' WHERE id = $1`, [rawVideoId]);
        return null;
      }
    }
    return existing[0].id;
  }

  // Create new video record NOW (just before download)
  const rawTitle = row.raw_title || null;
  const { rows: inserted } = await query(
    `INSERT INTO videos (raw_video_id, status, title, donor_category)
     VALUES ($1, 'new',
             CASE WHEN $2::text IS NOT NULL THEN jsonb_build_object('en', $2::text) ELSE NULL END,
             $3)
     ON CONFLICT (raw_video_id) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [rawVideoId, rawTitle, row.donor_category || null]
  );

  return inserted[0]?.id || null;
}

// ============================================================
// Progress reporter
// ============================================================

function startProgressReporter(queues, pools, stats, signal) {
  const interval = setInterval(() => {
    if (signal.stopped) {
      clearInterval(interval);
      return;
    }

    // Write step statuses
    for (const name of STEP_ORDER) {
      const q = queues[name];
      const pool = pools[name];
      if (!q || !pool) continue;

      const queueSize = q.size();
      const active = pool.activeCount;
      const done = stats.byStep[name] || 0;

      let status = 'idle';
      if (active > 0) status = 'active';
      else if (queueSize > 0) status = 'waiting';

      writeStepStatus(name, status, {
        queueSize,
        activeWorkers: active,
        completedCount: done,
      });
    }

    // Write pipeline summary
    writePipelineProgress({
      version: '2.0',
      status: signal.stopped ? 'stopping' : 'running',
      totalCompleted: stats.completed,
      totalFailed: stats.failed,
      startedAt: stats.startedAt,
      elapsedMs: Date.now() - stats.startedAtMs,
    });
  }, PROGRESS_INTERVAL_MS);

  return interval;
}

// ============================================================
// Helpers
// ============================================================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         CelebSkin Pipeline v2.0 — Orchestrator         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  if (singleStep && !STEP_ORDER.includes(singleStep)) {
    console.error(`Unknown step: ${singleStep}. Valid: ${STEP_ORDER.join(', ')}`);
    process.exit(1);
  }

  // Shared state
  const signal = { stopped: false };
  let scraperChild = null;  // track scraper subprocess for SIGTERM abort
  const stats = {
    completed: 0,
    failed: 0,
    byStep: {},
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
  };

  // Graceful shutdown — signal workers to stop, cleanup happens AFTER workers finish
  const shutdown = () => {
    if (signal.stopped) return; // prevent double
    logger.info('Shutdown signal received. Waiting for workers to finish...');
    signal.stopped = true;
    // Kill scraper subprocess immediately if running
    if (scraperChild && !scraperChild.killed) {
      try { scraperChild.kill("SIGKILL"); logger.info("Killed scraper subprocess"); } catch {}
    }
    for (const name of STEP_ORDER) {
      if (queues[name]) queues[name].wakeAll();
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Write PID file for pipeline-api.js
  writeFileSync(PID_FILE, String(process.pid));
  logger.info(`PID file: ${PID_FILE} (pid=${process.pid})`);
  const cleanupPid = () => { try { unlinkSync(PID_FILE); } catch {} };
  process.on('exit', cleanupPid);

  // Create queues
  const queues = {};
  for (const name of STEP_ORDER) {
    queues[name] = new PipelineQueue(name);
  }

  // Determine which steps to run
  const stepsToRun = singleStep ? [singleStep] : STEP_ORDER;

  // Create worker pools (each step feeds into the next)
  const pools = {};
  for (let i = 0; i < stepsToRun.length; i++) {
    const name = stepsToRun[i];
    const nextStepName = singleStep ? null : STEP_ORDER[STEP_ORDER.indexOf(name) + 1];
    const nextQueue = nextStepName ? queues[nextStepName] : null;

    pools[name] = new WorkerPool({
      name,
      concurrency: STEP_CONCURRENCY[name],
      processFn: STEP_PROCESSORS[name],
      inputQueue: queues[name],
      nextQueue,
      signal,
      stats,
    });
  }

  // Clear old progress
  clearAllProgress();

  // Start progress reporter
  const progressInterval = startProgressReporter(queues, pools, stats, signal);

  // Seed the queues
  let totalSeeded = 0;

  // Auto-resume: always scan workdirs for interrupted videos before fetching new ones
  {
    logger.info('Scanning workdirs for interrupted videos...');
    // Clear progress.json from previous run
    try {
      const progressFile = join(__dirname, 'logs', 'progress.json');
      writeFileSync(progressFile, JSON.stringify({ steps: {}, status: 'starting', startedAt: new Date().toISOString() }));
    } catch {}

    // NOTE: resetInProgressVideos is called ONLY on graceful shutdown (SIGTERM/SIGINT),
    // NOT on startup. This prevents deleting videos that are already downloaded/watermarked.

    const resumed = await resumeFromWorkdirs();
    let resumedTotal = 0;

    for (const [step, videoIds] of Object.entries(resumed)) {
      if (videoIds.length > 0 && queues[step]) {
        for (const id of videoIds) {
          queues[step].enqueue(id);
        }
        resumedTotal += videoIds.length;
        logger.info(`  Resumed ${videoIds.length} video(s) → ${step}`);
      }
    }

    if (resumedTotal > 0) {
      totalSeeded += resumedTotal;
      logger.info(`Resumed ${resumedTotal} videos total`);
    } else {
      logger.info('No interrupted videos found');
    }
  }

  if (!singleStep || singleStep === 'download') {
    // ── First: queue existing 'new' videos from DB (before scraping) ──
    // Dedup: skip videos whose original_title already exists as published
    {
      const { rows: existingNew } = await query(`
        SELECT v.id FROM videos v
        WHERE v.status = 'new'
          AND NOT EXISTS (
            SELECT 1 FROM videos p
            WHERE p.status = 'published'
              AND p.original_title IS NOT NULL
              AND p.original_title = v.original_title
          )
        ORDER BY v.created_at ASC
      `);
      if (existingNew.length > 0) {
        for (const row of existingNew) {
          queues[stepsToRun[0]].enqueue(row.id);
        }
        totalSeeded += existingNew.length;
        logger.info(`Queued ${existingNew.length} existing 'new' videos from DB`);
      }
    }


  }

  // ── START WORKERS IMMEDIATELY ──
  logger.info(`Starting workers (${totalSeeded} videos queued)`);
  logger.info(`Steps: ${stepsToRun.join(' \u2192 ')}`);

  const poolPromises = [];
  for (const name of stepsToRun) {
    poolPromises.push(pools[name].start());
  }

  // ── SCRAPER IN BACKGROUND ──
  let scraperDone = !sourceArg || (singleStep && singleStep !== 'download');

  if (!scraperDone) {
    (async () => {
      try {
        logger.info(`Scraper (bg): source=${sourceArg} limit=${limitArg}`);
        const scraperArgs = [];
        if (categoryArg) scraperArgs.push(`--category=${categoryArg}`);
        if (limitArg > 0) scraperArgs.push(`--max-videos=${limitArg}`);

        if (sourceArg === 'boobsradar') {
          scraperArgs.push('--skip-download');
          const scraperPath = join(__dirname, 'scrape-boobsradar.js');

          // Poll for new raw_videos every 10s while scraper runs
          const pollInterval = setInterval(async () => {
            try {
              const newIds = await fetchPendingVideos(limitArg > 0 ? limitArg - totalSeeded : 0);
              if (newIds.length > 0) {
                for (const id of newIds) queues[stepsToRun[0]].enqueue(id);
                totalSeeded += newIds.length;
                logger.info(`Scraper poll: ${newIds.length} new videos enqueued (total: ${totalSeeded})`);
              }
            } catch {}
          }, 10000);

          await new Promise((resolve, reject) => {
            const child = spawn('node', [scraperPath, ...scraperArgs], {
              cwd: __dirname,
              stdio: ['ignore', 'pipe', 'pipe'],
              env: { ...process.env },
            });
            scraperChild = child;
            let stdout = '';
            child.stdout.on('data', (d) => {
              const line = d.toString().trimEnd();
              stdout += line + '\n';
              for (const l of line.split('\n')) {
                if (l.trim()) logger.info(`\u2502 ${l}`);
              }
            });
            child.stderr.on('data', () => {});
            child.on('exit', (c) => c === 0 ? resolve(stdout) : reject(new Error(`exit ${c}`)));
            child.on('error', reject);
          });

          clearInterval(pollInterval);
        }

        // Final sweep: enqueue any remaining raw_videos
        const ids = await fetchPendingVideos(limitArg > 0 ? limitArg - totalSeeded : 0);
        if (ids.length > 0) {
          for (const id of ids) queues[stepsToRun[0]].enqueue(id);
          totalSeeded += ids.length;
          logger.info(`Scraper final: ${ids.length} new videos enqueued (total: ${totalSeeded})`);
        }
      } catch (e) {
        logger.error(`Scraper error: ${e.message}`);
      } finally {
        scraperDone = true;
      }
    })();
  }

  if (totalSeeded === 0 && scraperDone) {
    logger.info('No videos. Exiting.');
    signal.stopped = true;
    for (const name of STEP_ORDER) if (queues[name]) queues[name].wakeAll();
    await Promise.all(poolPromises);
    clearInterval(progressInterval);
    process.exit(0);
  }

  // Wait for pipeline to drain
  // Check periodically if all queues are empty and no workers active
  while (!signal.stopped) {
    await sleep(2000);

    const totalQueued = stepsToRun.reduce((sum, name) => sum + queues[name].size(), 0);
    const totalActive = stepsToRun.reduce((sum, name) => sum + pools[name].activeCount, 0);

    // Poll DB for watermark_ready — claim for Contabo if free slots
    if (queues.watermark && pools.watermark) {
      try {
        const wmFree = (STEP_CONCURRENCY.watermark || 2) - pools.watermark.activeCount - queues.watermark.size();
        if (wmFree > 0) {
          const { rows } = await query(
            `UPDATE videos SET pipeline_step = 'watermark', status = 'watermarking', updated_at = NOW()
             WHERE id IN (
               SELECT id FROM videos WHERE pipeline_step = 'watermark_ready'
               ORDER BY created_at ASC LIMIT ${wmFree}
               FOR UPDATE SKIP LOCKED
             ) RETURNING id`
          );
          for (const r of rows) {
            queues.watermark.enqueue(r.id);
            logger.info(`[wm-poll] ${r.id.substring(0,8)} claimed from DB`);
          }
        }
      } catch {}
    }

    // Check for home-worker completed videos → media queue
    // ONLY pick up videos that were watermarked by home worker (status was watermarking_home)
    // Contabo-watermarked videos go through nextQueue automatically
    if (queues.media) {
      try {
        const { rows } = await query(
          `SELECT id FROM videos WHERE
           (status = 'watermarking_home' AND pipeline_step = 'watermarked')
           OR (status = 'watermarked' AND pipeline_step = 'watermarking_home')
           LIMIT 10`
        );
        for (const r of rows) {
          await query(`UPDATE videos SET pipeline_step = 'media', updated_at = NOW() WHERE id = $1`, [r.id]);
          queues.media.enqueue(r.id);
          logger.info(`[home] ${r.id.substring(0,8)} watermarked by home → media`);
        }
      } catch {}
    }

    // Check DB for pending watermark work
    let dbWmPending = 0;
    try {
      const { rows: [{ count }] } = await query(
        "SELECT COUNT(*)::int AS count FROM videos WHERE pipeline_step IN ('watermark_ready','watermarking_home')"
      );
      dbWmPending = count;
    } catch {}

    // Also check DB for any in-progress videos (watermarking, downloading, etc.)
    let dbInProgress = 0;
    try {
      const { rows: [{ count: ipCount }] } = await query(
        "SELECT COUNT(*)::int AS count FROM videos WHERE status NOT IN ('published','rejected','dmca_removed','needs_review','failed') AND pipeline_step IS NOT NULL"
      );
      dbInProgress = ipCount;
    } catch {}

    if (totalQueued === 0 && totalActive === 0 && scraperDone && dbWmPending === 0 && dbInProgress === 0) {
      logger.info('Pipeline complete: all queues drained, scraper done, no pending work.');
      signal.stopped = true;
      // Wake sleeping workers
      for (const name of STEP_ORDER) {
        if (queues[name]) queues[name].wakeAll();
      }
      break;
    }
  }

  // Wait for workers to finish
  await Promise.all(poolPromises);
  clearInterval(progressInterval);

  // ── POST-SHUTDOWN CLEANUP: delete all unpublished videos from DB + Bunny ──
  logger.info('Workers finished. Running cleanup...');
  await cleanupUnpublished();
  // Clear progress.json so UI shows clean state
  try {
    const progressFile = join(__dirname, 'logs', 'progress.json');
    writeFileSync(progressFile, JSON.stringify({ steps: {}, status: 'stopped', stoppedAt: new Date().toISOString() }));
    logger.info('Cleared progress.json');
  } catch {}

  // Final summary
  const elapsed = ((Date.now() - stats.startedAtMs) / 1000).toFixed(1);
  console.log('');
  console.log('═'.repeat(58));
  console.log('Pipeline v2.0 — Summary');
  console.log('═'.repeat(58));
  console.log(`  Completed: ${stats.completed}`);
  console.log(`  Failed:    ${stats.failed}`);
  console.log(`  Time:      ${elapsed}s`);
  console.log('  Per step:');
  for (const name of STEP_ORDER) {
    if (stats.byStep[name]) {
      console.log(`    ${name}: ${stats.byStep[name]}`);
    }
  }
  console.log('═'.repeat(58));

  // Write final progress
  writePipelineProgress({
    version: '2.0',
    status: 'completed',
    totalCompleted: stats.completed,
    totalFailed: stats.failed,
    startedAt: stats.startedAt,
    elapsedMs: Date.now() - stats.startedAtMs,
  });

  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch(err => {
  logger.error(`Fatal: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
