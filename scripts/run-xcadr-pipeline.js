#!/usr/bin/env node
/**
 * run-xcadr-pipeline.js — XCADR Pipeline Orchestrator
 *
 * Unified pipeline for xcadr.online videos with in-memory queues and worker pools.
 * Architecture mirrors run-pipeline-v2.js but adapted for xcadr source.
 *
 * KEY DIFFERENCE: No data written to videos/celebrities/movies tables until PUBLISH step.
 * Everything lives in xcadr_imports staging table + workdir until final publish.
 *
 * Steps (worker pipeline):
 *   1. download    — download video from xcadr → workdir
 *   2. ai_vision   — Gemini analysis + multilang generation
 *   3. watermark   — FFmpeg watermark (celeb.skin overlay)
 *   4. media       — screenshots + preview clip + gif
 *   5. cdn_upload  — upload all files to BunnyCDN
 *   6. publish     — CREATE video/celebrity/movie in DB + link tags/collections
 *   7. cleanup     — remove workdir
 *
 * Pre-pipeline (runs before workers):
 *   - parse xcadr.online → xcadr_imports
 *   - translate via TMDB + Gemini
 *
 * Usage:
 *   node run-xcadr-pipeline.js --limit=10
 *   node run-xcadr-pipeline.js --limit=10 --url=https://xcadr.online/videos/123/
 *   node run-xcadr-pipeline.js --limit=10 --celeb=https://xcadr.online/celebs/actress/
 *   node run-xcadr-pipeline.js --limit=10 --collection=https://xcadr.online/collection/name/
 *   node run-xcadr-pipeline.js --limit=10 --pages=5
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { readFile, writeFile, rm, stat, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile as execFileCb, spawn } from 'child_process';
import { promisify } from 'util';
import { pipeline as streamPipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import crypto from 'crypto';
import axios from 'axios';
import slugify from 'slugify';

const execFileAsync = promisify(execFileCb);
const __dirname = dirname(fileURLToPath(import.meta.url));

import { config } from './lib/config.js';
import { query, pool } from './lib/db.js';
import { extractNationality, mapDonorTags } from './lib/tags.js';
import { uploadFile } from './lib/bunny.js';
import logger from './lib/logger.js';

// ============================================================
// Constants
// ============================================================

const WORK_DIR = '/opt/celebskin/xcadr-work';
const V2_WORK_DIR = '/opt/celebskin/pipeline-work'; // shared with home workers
const PID_FILE = join(__dirname, 'xcadr-pipeline.pid');
const RETRY_DELAYS = [5000, 15000, 45000];
const PROGRESS_INTERVAL_MS = 3000;
const SUBPROCESS_TIMEOUT = 600000;

const STEP_ORDER = ['download', 'ai_vision', 'watermark', 'media', 'cdn_upload', 'publish', 'cleanup'];

const STEP_CONCURRENCY = {
  download: 3, ai_vision: 3, watermark: 2, media: 3, cdn_upload: 3, publish: 3, cleanup: 3,
};

function writeStepProgress(xcadrId, data) {
  try {
    const dir = join(WORK_DIR, String(xcadrId));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'step-progress.json'), JSON.stringify({
      ...data, started_at: data.started_at || new Date().toISOString(), updated_at: new Date().toISOString(),
    }));
  } catch (_) {}
}

function clearStepProgress(xcadrId) {
  try { const f = join(WORK_DIR, String(xcadrId), 'step-progress.json'); if (existsSync(f)) unlinkSync(f); } catch (_) {}
}

// ============================================================
// CLI args
// ============================================================

const cliArgs = process.argv.slice(2);
function getArg(name) {
  const a = cliArgs.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : null;
}

const limitArg = parseInt(getArg('limit')) || 10;
const urlArg = getArg('url') || '';
const celebArg = getArg('celeb') || '';
const collArg = getArg('collection') || '';
const pagesArg = parseInt(getArg('pages')) || 0;

// ============================================================
// PipelineQueue + WorkerPool (same as pipeline-v2)
// ============================================================

class PipelineQueue {
  constructor(name) { this.name = name; this._items = []; this._waiters = []; }
  enqueue(id) { this._items.push(id); if (this._waiters.length > 0) this._waiters.shift()(); }
  dequeue() { return this._items.shift() || null; }
  async waitForItem(signal) {
    while (this._items.length === 0) {
      if (signal.stopped) return null;
      await new Promise(resolve => {
        this._waiters.push(resolve);
        const c = setInterval(() => { if (signal.stopped) { clearInterval(c); resolve(); } }, 500);
      });
      if (signal.stopped) return null;
    }
    return this.dequeue();
  }
  size() { return this._items.length; }
  wakeAll() { while (this._waiters.length > 0) this._waiters.shift()(); }
}

class WorkerPool {
  constructor({ name, concurrency, processFn, inputQueue, nextQueue, signal, stats }) {
    Object.assign(this, { name, concurrency, processFn, inputQueue, nextQueue, signal, stats });
    this._activeCount = 0; this._workers = [];
  }
  get activeCount() { return this._activeCount; }
  start() {
    for (let i = 0; i < this.concurrency; i++) this._workers.push(this._runWorker(i));
    logger.info(`[${this.name}] Started ${this.concurrency} worker(s)`);
    return Promise.all(this._workers);
  }
  async _runWorker(wid) {
    while (!this.signal.stopped) {
      const xcadrId = await this.inputQueue.waitForItem(this.signal);
      if (!xcadrId) break;
      this._activeCount++;
      const t0 = Date.now();
      logger.info(`[${this.name}:${xcadrId}] ▶ START worker#${wid} (active: ${this._activeCount}/${this.concurrency}, queue: ${this.inputQueue.size()})`);
      try {
        const STATUS_MAP = { download:'downloading', ai_vision:'ai_analyzing', watermark:'watermarking', media:'media_generating', cdn_upload:'cdn_uploading', publish:'publishing' };
        if (this.name !== 'cleanup') {
          await query(`UPDATE xcadr_imports SET status=$2, pipeline_step=$3, pipeline_error=NULL, updated_at=NOW() WHERE id=$1`, [xcadrId, STATUS_MAP[this.name] || 'downloading', this.name]);
        }
        let lastErr = null, ok = false;
        for (let att = 0; att <= RETRY_DELAYS.length; att++) {
          if (att > 0) { logger.warn(`[${this.name}:${xcadrId}] Retry ${att}/${RETRY_DELAYS.length}...`); await sleep(RETRY_DELAYS[att - 1]); }
          try { await this.processFn(xcadrId, this.name); ok = true; break; }
          catch (e) { lastErr = e; logger.error(`[${this.name}:${xcadrId}] Attempt ${att + 1} failed: ${e.message}`); }
        }
        if (ok) {
          this.stats.byStep[this.name] = (this.stats.byStep[this.name] || 0) + 1;
          if (this.nextQueue) this.nextQueue.enqueue(xcadrId); else this.stats.completed++;
          logger.info(`[${this.name}:${xcadrId}] ✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        } else {
          this.stats.failed++;
          const errDetail = lastErr?.message?.substring(0, 450) || 'Unknown error';
          const errMsg = `[${this.name}] ${errDetail}`;
          await query(`UPDATE xcadr_imports SET status=$2, pipeline_step=$3, pipeline_error=$4, updated_at=NOW() WHERE id=$1`, [xcadrId, 'failed', this.name, errMsg]);
          logger.error(`[${this.name}:${xcadrId}] ❌ Failed after ${RETRY_DELAYS.length + 1} attempts: ${errDetail}`);
        }
      } catch (e) {
        this.stats.failed++;
        const errMsg = `[${this.name}] Fatal: ${e.message?.substring(0, 450)}`;
        try { await query(`UPDATE xcadr_imports SET status='failed', pipeline_step=$2, pipeline_error=$3, updated_at=NOW() WHERE id=$1`, [xcadrId, this.name, errMsg]); } catch {}
        logger.error(`[${this.name}:${xcadrId}] Fatal: ${e.message}`);
      }
      finally {
        this._activeCount--; clearStepProgress(xcadrId);
        logger.info(`[${this.name}:${xcadrId}] ■ END worker#${wid} ${((Date.now() - t0) / 1000).toFixed(1)}s (active: ${this._activeCount}/${this.concurrency})`);
      }
    }
  }
}

// ============================================================
// Helpers
// ============================================================

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runScript(scriptName, scriptArgs = [], stepName = '', xcadrId = '') {
  const scriptPath = join(__dirname, scriptName);
  logger.info(`[${stepName}:${xcadrId}] Running: node ${scriptName} ${scriptArgs.join(' ')}`);
  try {
    const { stdout, stderr } = await execFileAsync('node', [scriptPath, ...scriptArgs], {
      cwd: __dirname, timeout: SUBPROCESS_TIMEOUT, killSignal: 'SIGKILL', maxBuffer: 10 * 1024 * 1024, env: { ...process.env },
    });
    if (stdout) { const lines = stdout.trim().split('\n').filter(l => l.trim()); logger.info(`[${stepName}:${xcadrId}] output:\n    ${lines.slice(-5).join('\n    ')}`); }
    if (stderr) logger.warn(`[${stepName}:${xcadrId}] stderr: ${stderr.substring(0, 500)}`);
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    return { exitCode: err.killed ? 'TIMEOUT' : err.code || 1, stdout: err.stdout || '', stderr: err.stderr || '', error: err.message };
  }
}

// ============================================================
// STEP: Download — extract video URL from xcadr page + download
// ============================================================

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' };
const AD_PATTERNS = ['bongacams','chaturbate','ads.','promo','banner','sponsor','tracker','click.','redirect','popunder','exoclick','juicyads','trafficjunky','adserver'];

function isAdUrl(url) { return AD_PATTERNS.some(p => url.toLowerCase().includes(p)); }
function getQualityScore(url) {
  const l = url.toLowerCase();
  if (l.includes('1080')) return 1080; if (l.includes('720')) return 720; if (l.includes('480')) return 480;
  const q = l.match(/[?&]q=(\d+)/); return q ? parseInt(q[1]) : 500;
}

async function processDownload(xcadrId, stepName) {
  const { rows: [item] } = await query(`SELECT * FROM xcadr_imports WHERE id = $1`, [xcadrId]);
  if (!item) throw new Error(`xcadr_imports id=${xcadrId} not found`);

  writeStepProgress(xcadrId, { step: 'download', status: 'running', percent: 10, detail: 'yt-dlp...' });
  const workDir = join(WORK_DIR, String(xcadrId));
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, 'xcadr-meta.json'), JSON.stringify(item, null, 2));

  if (!item.xcadr_url) throw new Error('No xcadr_url');
  const videoPath = join(workDir, 'original.mp4');

  // Use yt-dlp to download — handles KVS player JS, cookies, function/0/ prefix
  writeStepProgress(xcadrId, { step: 'download', status: 'running', percent: 30, detail: 'Downloading with yt-dlp...' });
  const ytdlpArgs = [
    '-f', 'best[ext=mp4]/best',
    '--no-check-certificates',
    '--no-warnings',
    '-o', videoPath,
    '--socket-timeout', '30',
    '--retries', '3',
    item.xcadr_url,
  ];
  logger.info(`[${stepName}:${xcadrId}] yt-dlp ${item.xcadr_url}`);
  const ytResult = await new Promise((resolve) => {
    const child = spawn('yt-dlp', ytdlpArgs, { timeout: 600000 });
    let stderr = '';
    child.stderr?.on('data', d => stderr += d.toString());
    child.on('close', code => resolve({ code, stderr }));
    child.on('error', err => resolve({ code: 1, stderr: err.message }));
  });
  if (ytResult.code !== 0) throw new Error(`yt-dlp failed (code ${ytResult.code}): ${ytResult.stderr.substring(0, 300)}`);

  const fstat = await stat(videoPath);
  if (fstat.size < 100000) throw new Error(`File too small (${fstat.size} bytes)`);
  logger.info(`[${stepName}:${xcadrId}] Downloaded: ${(fstat.size / 1048576).toFixed(1)}MB`);

  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v','quiet','-show_entries','format=duration','-of','csv=p=0', videoPath], { timeout: 15000 });
    const dur = Math.round(parseFloat(stdout.trim()));
    if (dur > 0) await writeFile(join(workDir, 'duration.txt'), String(dur));
  } catch (_) {}
  writeStepProgress(xcadrId, { step: 'download', status: 'done', percent: 100, detail: `${(fstat.size/1048576).toFixed(1)}MB` });
}

// ============================================================
// STEP: AI Vision — temp video record → ai-vision-analyze.js → cleanup
// ============================================================

async function processAiVision(xcadrId, stepName) {
  const workDir = join(WORK_DIR, String(xcadrId));
  const meta = JSON.parse(await readFile(join(workDir, 'xcadr-meta.json'), 'utf8'));
  writeStepProgress(xcadrId, { step: 'ai_vision', status: 'running', percent: 10, detail: 'Gemini analyzing...' });

  const tempVideoId = crypto.randomUUID();
  const origTitle = meta.title_en || meta.title_ru || '';
  await writeFile(join(workDir, 'temp-video-id.txt'), tempVideoId);
  await query(`INSERT INTO videos (id, original_title, title, donor_tags, status, pipeline_step, ai_vision_status, created_at, updated_at)
    VALUES ($1,$2,$3::jsonb,$4,'new','ai_vision','pending',NOW(),NOW())`, [tempVideoId, origTitle, JSON.stringify({en:origTitle}), meta.tags_ru||[]]);

  const v2Dir = join(V2_WORK_DIR, tempVideoId);
  await mkdir(v2Dir, { recursive: true });
  await execFileAsync('ln', ['-sf', join(workDir, 'original.mp4'), join(v2Dir, 'original.mp4')], { timeout: 5000 })
    .catch(() => execFileAsync('cp', [join(workDir, 'original.mp4'), join(v2Dir, 'original.mp4')], { timeout: 120000 }));

  const vr = await runScript('ai-vision-analyze.js', [`--video-id=${tempVideoId}`], stepName, String(xcadrId));
  const { rows: [vc] } = await query(`SELECT ai_vision_status, ai_vision_error FROM videos WHERE id=$1`, [tempVideoId]);
  const aiStatus = vc?.ai_vision_status || 'unknown';
  const aiError = vc?.ai_vision_error || vr.error?.substring(0, 300) || '';

  if (vr.exitCode !== 0) {
    // Accept: completed, timeout_fallback, censored (continues with donor tag fallback)
    if (!vc || !['completed', 'timeout_fallback', 'censored'].includes(aiStatus)) {
      // Classify error for UI display
      let errorCategory = 'unknown';
      const errLower = (aiError || '').toLowerCase();
      if (errLower.includes('429') || errLower.includes('quota') || errLower.includes('resource_exhausted') || errLower.includes('exceeded')) errorCategory = 'quota';
      else if (errLower.includes('api key') || errLower.includes('invalid key') || errLower.includes('permission') || errLower.includes('403')) errorCategory = 'key_error';
      else if (errLower.includes('timeout') || errLower.includes('etimedout') || errLower.includes('econnreset')) errorCategory = 'timeout';

      await query(`DELETE FROM videos WHERE id=$1`, [tempVideoId]);
      await rm(v2Dir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`[${errorCategory}] ${aiError || 'ai-vision failed'}`);
    }
    logger.warn(`[${stepName}:${xcadrId}] AI Vision status=${aiStatus}, continuing with fallback`);
  }

  // Save AI vision status info to step-progress for UI
  if (aiStatus === 'censored') {
    writeStepProgress(xcadrId, { step: 'ai_vision', status: 'running', percent: 55, detail: `Censored — donor tag fallback`, ai_vision_status: aiStatus });
  } else if (aiStatus === 'timeout_fallback') {
    writeStepProgress(xcadrId, { step: 'ai_vision', status: 'running', percent: 55, detail: `Timeout — donor tag fallback`, ai_vision_status: aiStatus });
  }

  writeStepProgress(xcadrId, { step: 'ai_vision', status: 'running', percent: 60, detail: 'Languages...' });
  await runScript('generate-multilang.js', [`--video-id=${tempVideoId}`], stepName, String(xcadrId));

  // Copy metadata.json to xcadr workdir
  if (existsSync(join(v2Dir, 'metadata.json')))
    await execFileAsync('cp', [join(v2Dir, 'metadata.json'), join(workDir, 'metadata.json')], { timeout: 5000 });

  // Save AI results to xcadr workdir
  const { rows: [ai] } = await query(`SELECT title, slug, review, seo_title, seo_description, ai_tags, ai_vision_status, ai_vision_error, ai_vision_model, best_thumbnail_sec, preview_start_sec, hot_moments, ai_raw_response FROM videos WHERE id=$1`, [tempVideoId]);
  if (ai) await writeFile(join(workDir, 'ai-results.json'), JSON.stringify(ai, null, 2));

  // DON'T delete temp video — mark as watermark_ready for shared DB queue (home workers + Contabo)
  // Ensure original.mp4 is a real file (not broken symlink) in pipeline-work for home worker
  const v2Original = join(v2Dir, 'original.mp4');
  try {
    const s = await stat(v2Original);
    if (s.size < 100000) throw new Error('too small');
  } catch {
    // Symlink broken or missing — copy the file
    await execFileAsync('cp', [join(workDir, 'original.mp4'), v2Original], { timeout: 120000 });
  }
  await query(`UPDATE videos SET pipeline_step = 'watermark_ready', updated_at = NOW() WHERE id = $1`, [tempVideoId]);
  logger.info(`[${stepName}:${xcadrId}] Temp video ${tempVideoId.substring(0,8)} → watermark_ready (shared DB queue)`);

  writeStepProgress(xcadrId, { step: 'ai_vision', status: 'done', percent: 100, detail: 'Done' });
}

// ============================================================
// STEP: Watermark — PNG image overlay with rotating_corners (like Pipeline v2)
// ============================================================

const WATERMARK_TEXT = 'celeb.skin';
const WATERMARK_DEFAULTS = {
  watermarkType: 'text', watermarkImageUrl: '', watermarkScale: 0.1,
  opacity: 0.3, fontSize: 24, fontColor: 'white', position: 'bottom-right',
  margin: 20, watermarkMovement: 'rotating_corners',
};

async function loadWatermarkSettings() {
  try {
    const { rows } = await query(`SELECT key, value FROM settings WHERE key LIKE 'watermark_%'`);
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
  const alpha = cfg.opacity, m = cfg.margin;
  if (cfg.watermarkMovement === 'static') {
    let x, y;
    switch (cfg.position) {
      case 'bottom-left': x = String(m); y = `h-th-${m}`; break;
      case 'top-right':   x = `w-tw-${m}`; y = String(m); break;
      case 'top-left':    x = String(m); y = String(m); break;
      default:            x = `w-tw-${m}`; y = `h-th-${m}`;
    }
    return [`drawtext=text='${WATERMARK_TEXT}'`,`fontsize=${cfg.fontSize}`,`fontcolor=${cfg.fontColor}@${alpha}`,
      `x=${x}`,`y=${y}`,`shadowcolor=black@${alpha*0.7}`,`shadowx=1`,`shadowy=1`].join(':');
  }
  const xExpr = `'if(lt(mod(t\\,240)\\,60)\\,w-tw-${m}\\,if(lt(mod(t\\,240)\\,120)\\,w-tw-${m}\\,if(lt(mod(t\\,240)\\,180)\\,${m}\\,${m})))'`;
  const yExpr = `'if(lt(mod(t\\,240)\\,60)\\,${m}\\,if(lt(mod(t\\,240)\\,120)\\,h-th-${m}\\,if(lt(mod(t\\,240)\\,180)\\,h-th-${m}\\,${m})))'`;
  return [`drawtext=text='${WATERMARK_TEXT}'`,`fontsize=${cfg.fontSize}`,`fontcolor=${cfg.fontColor}@${alpha}`,
    `x=${xExpr}`,`y=${yExpr}`,`shadowcolor=black@${alpha*0.7}`,`shadowx=1`,`shadowy=1`].join(':');
}

async function downloadWatermarkPng(url, destPath) {
  const cdnUrl = process.env.BUNNY_CDN_URL || 'https://celebskin-cdn.b-cdn.net';
  const storageZone = process.env.BUNNY_STORAGE_ZONE || 'celebskin-media';
  const storageKey = process.env.BUNNY_STORAGE_KEY;
  const storageHost = process.env.BUNNY_STORAGE_HOST || 'storage.bunnycdn.com';
  let storageUrl = null;
  if (storageKey && url.startsWith(cdnUrl)) {
    storageUrl = `https://${storageHost}/${storageZone}${url.replace(cdnUrl, '')}`;
  }
  try {
    const resp = await axios({ method: 'get', url, responseType: 'stream', timeout: 30000,
      headers: { 'Referer': 'https://celeb.skin/' } });
    await streamPipeline(resp.data, createWriteStream(destPath));
    return;
  } catch (e) { if (!storageUrl) throw e; }
  const resp = await axios({ method: 'get', url: storageUrl, responseType: 'stream', timeout: 30000,
    headers: { 'AccessKey': storageKey } });
  await streamPipeline(resp.data, createWriteStream(destPath));
}

function runFFmpegWatermark(ffmpegArgs, timeoutMs, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      const str = chunk.toString(); stderr += str;
      if (onProgress) {
        const m = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (m) onProgress(parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]));
      }
    });
    proc.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-500)}`)); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`FFmpeg timeout (${Math.round(timeoutMs / 60000)}min)`)); }, timeoutMs);
  });
}

async function getVideoDuration(videoPath) {
  try { const { stdout } = await execFileAsync('ffprobe', ['-v','quiet','-show_entries','format=duration','-of','csv=p=0', videoPath], { timeout: 15000 }); return parseFloat(stdout.trim()) || 0; }
  catch { return 0; }
}

async function processWatermark(xcadrId, stepName) {
  const workDir = join(WORK_DIR, String(xcadrId));
  const inputPath = join(workDir, 'original.mp4');
  const outputPath = join(workDir, 'watermarked.mp4');

  // Read temp video ID (created during ai_vision for shared DB queue)
  let tempVideoId = null;
  try { tempVideoId = (await readFile(join(workDir, 'temp-video-id.txt'), 'utf8')).trim(); } catch {}
  if (!tempVideoId) throw new Error('temp-video-id.txt not found — ai_vision step failed?');

  const v2Dir = join(V2_WORK_DIR, tempVideoId);

  // Atomic claim: only watermark if not already claimed by home worker
  const { rowCount } = await query(
    `UPDATE videos SET status = 'watermarking', pipeline_step = 'watermark', updated_at = NOW()
     WHERE id = $1
       AND status NOT IN ('watermarking', 'watermarking_home', 'watermarked', 'published', 'failed', 'needs_review')
       AND pipeline_step NOT IN ('watermarking_home', 'watermarked', 'media', 'cdn_upload', 'publish', 'cleanup')`,
    [tempVideoId]
  );

  if (rowCount === 0) {
    // Home worker already claimed or finished — wait for completion then copy result
    logger.info(`[${stepName}:${xcadrId}] Temp video ${tempVideoId.substring(0,8)} already claimed — waiting for home worker...`);
    writeStepProgress(xcadrId, { step: 'watermark', status: 'running', percent: 10, detail: 'Waiting for home worker...' });

    // Poll until watermarked or timeout (30 min)
    const wmTimeout = Date.now() + 30 * 60 * 1000;
    while (Date.now() < wmTimeout) {
      const { rows: [check] } = await query(
        `SELECT status, pipeline_step FROM videos WHERE id = $1`, [tempVideoId]
      );
      if (!check) throw new Error('Temp video disappeared from DB');
      const ps = check.pipeline_step, st = check.status;
      if (ps === 'watermarked' || st === 'watermarked' ||
          (st === 'watermarking_home' && ps === 'watermarked') ||
          (st === 'watermarked' && ps === 'watermarking_home')) {
        logger.info(`[${stepName}:${xcadrId}] Home worker completed watermark for ${tempVideoId.substring(0,8)}`);
        break;
      }
      if (st === 'failed') throw new Error('Home worker failed watermark');
      await sleep(5000);
    }

    // Copy watermarked.mp4 from pipeline-work to xcadr-work
    const v2Watermarked = join(v2Dir, 'watermarked.mp4');
    if (existsSync(v2Watermarked)) {
      await execFileAsync('cp', [v2Watermarked, outputPath], { timeout: 120000 });
      const s = await stat(outputPath);
      logger.info(`[${stepName}:${xcadrId}] Copied home watermark: ${(s.size/1048576).toFixed(1)}MB`);
    } else {
      throw new Error('Home worker watermarked.mp4 not found in pipeline-work');
    }

    writeStepProgress(xcadrId, { step: 'watermark', status: 'done', percent: 100, detail: 'Done (home worker)' });
    return;
  }

  // ── Local watermark on Contabo (2 slots) ──
  if (!existsSync(inputPath)) throw new Error(`original.mp4 not found in workdir`);

  const wmCfg = await loadWatermarkSettings();

  // Detect video resolution for delogo
  let vWidth = 0, vHeight = 0;
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v','quiet','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0', inputPath], { timeout: 15000 });
    const [w, h] = stdout.trim().split(',').map(Number);
    if (w && h) { vWidth = w; vHeight = h; }
  } catch {}

  // Build delogo filters for xcadr watermarks (ALL 4 corners — rotating "BETWINNER / XCADR.ONLINE")
  let delogoFilter = '';
  if (vWidth > 0 && vHeight > 0) {
    const dW = Math.round(vWidth * 0.28);
    const dH = Math.round(vHeight * 0.10);
    const m = 2; // margin
    const corners = [
      { x: vWidth - dW - m, y: m },                    // top-right
      { x: vWidth - dW - m, y: vHeight - dH - m },     // bottom-right
      { x: m, y: vHeight - dH - m },                    // bottom-left
      { x: m, y: m },                                   // top-left
    ];
    delogoFilter = corners.map(c => `delogo=x=${c.x}:y=${c.y}:w=${dW}:h=${dH}:show=0`).join(',');
    logger.info(`[${stepName}:${xcadrId}] Delogo 4 corners: ${vWidth}x${vHeight}, w=${dW} h=${dH}`);
  }

  logger.info(`[${stepName}:${xcadrId}] Watermark type=${wmCfg.watermarkType}, opacity=${wmCfg.opacity}, movement=${wmCfg.watermarkMovement}`);

  const baseArgs = ['-fflags', '+genpts+discardcorrupt'];
  const outputArgs = [
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-af', 'aresample=async=1:first_pts=0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-sar', '1:1',
    '-preset', 'veryfast', '-crf', '20',
    '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
    '-bf', '2', '-threads', '0',
    '-max_muxing_queue_size', '4096', '-movflags', '+faststart',
    '-y', outputPath,
  ];

  let ffmpegArgs;
  let useImage = wmCfg.watermarkType === 'image' && wmCfg.watermarkImageUrl;
  if (useImage) {
    const wmPngPath = join(workDir, 'watermark.png');
    try { await downloadWatermarkPng(wmCfg.watermarkImageUrl, wmPngPath); }
    catch (err) { logger.warn(`[${stepName}:${xcadrId}] Image watermark download failed (${err.message}), falling back to text`); useImage = false; }
    if (useImage) {
      const filterComplex = buildImageOverlayFilter(wmCfg.margin, wmCfg.opacity, wmCfg.watermarkScale, wmCfg.watermarkMovement);
      // Prepend delogo to filter_complex if available
      const fullFilter = delogoFilter ? `[0:v]${delogoFilter}[delogoed];${filterComplex.replace('[0:v]', '[delogoed]')}` : filterComplex;
      ffmpegArgs = [...baseArgs, '-i', inputPath, '-i', wmPngPath, '-filter_complex', fullFilter, ...outputArgs];
    }
  }
  if (!useImage) {
    const textFilter = buildTextFilter(wmCfg);
    // Prepend delogo to vf chain
    const fullVf = delogoFilter ? `${delogoFilter},${textFilter}` : textFilter;
    ffmpegArgs = [...baseArgs, '-i', inputPath, '-vf', fullVf, ...outputArgs];
  }

  const wmDuration = await getVideoDuration(inputPath);
  logger.info(`[${stepName}:${xcadrId}] Running FFmpeg watermark... (duration=${wmDuration.toFixed(1)}s)`);
  writeStepProgress(xcadrId, { step: 'watermark', status: 'running', percent: 0, detail: 'FFmpeg starting...' });
  let lastWmProgressWrite = 0;
  await runFFmpegWatermark(ffmpegArgs, 30 * 60 * 1000, (currentSec) => {
    const now = Date.now();
    if (now - lastWmProgressWrite < 2000) return;
    lastWmProgressWrite = now;
    const pct = wmDuration > 0 ? Math.min(99, Math.round(currentSec / wmDuration * 100)) : 0;
    writeStepProgress(xcadrId, { step: 'watermark', status: 'running', percent: pct,
      detail: `FFmpeg ${pct}% (${Math.round(currentSec)}s/${Math.round(wmDuration)}s)` });
  });

  const outStat = await stat(outputPath);
  if (outStat.size === 0) throw new Error('watermarked.mp4 is 0 bytes');
  const inStat = await stat(inputPath);
  logger.info(`[${stepName}:${xcadrId}] Watermarked OK: ${(inStat.size/1048576).toFixed(1)}MB → ${(outStat.size/1048576).toFixed(1)}MB`);

  // Copy watermarked.mp4 to pipeline-work for consistency, update DB
  try { await execFileAsync('cp', [outputPath, join(v2Dir, 'watermarked.mp4')], { timeout: 120000 }); } catch {}
  await query(`UPDATE videos SET pipeline_step = 'watermarked', updated_at = NOW() WHERE id = $1`, [tempVideoId]);

  writeStepProgress(xcadrId, { step: 'watermark', status: 'done', percent: 100, detail: 'Done (Contabo)' });
}

// ============================================================
// STEP: Media — screenshots at hot_moments + preview + gif (like Pipeline v2)
// ============================================================

const MEDIA_DEFAULTS = {
  thumbWidth: 1280, previewDuration: 6, previewWidth: 480, previewCrf: 28,
  gifDuration: 4, gifFps: 8, gifWidth: 480,
};

async function getVideoResolution(videoPath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v','quiet','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0', videoPath], { timeout: 15000 });
    const [w, h] = stdout.trim().split(',').map(Number);
    return { width: w || 1920, height: h || 1080 };
  } catch { return { width: 1920, height: 1080 }; }
}

function formatDuration(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  return `${mins}:${String(secs).padStart(2,'0')}`;
}

async function processMedia(xcadrId, stepName) {
  const workDir = join(WORK_DIR, String(xcadrId));
  const videoPath = join(workDir, 'watermarked.mp4');
  if (!existsSync(videoPath)) throw new Error('watermarked.mp4 not found — media step ran before watermark completed');

  const duration = await getVideoDuration(videoPath);
  if (duration < 2) throw new Error(`Video too short: ${duration.toFixed(1)}s`);
  const resolution = await getVideoResolution(videoPath);
  const quality = resolution.height >= 1080 ? '1080p' : resolution.height >= 720 ? '720p' : resolution.height >= 480 ? '480p' : '360p';
  logger.info(`[${stepName}:${xcadrId}] Duration=${duration.toFixed(1)}s, ${resolution.width}x${resolution.height} (${quality})`);

  // Load AI metadata (hot_moments, best_thumbnail_sec, preview_start_sec)
  let hotMoments = null, bestThumbnailSec = null, previewStartSec = null;
  const metadataPath = join(workDir, 'metadata.json');
  if (existsSync(metadataPath)) {
    try {
      const meta = JSON.parse(await readFile(metadataPath, 'utf8'));
      hotMoments = meta.hot_moments || meta.screenshot_timestamps || null;
      bestThumbnailSec = meta.best_thumbnail_sec ?? null;
      previewStartSec = meta.preview_start_sec ?? null;
    } catch {}
  }
  // Fallback: ai-results.json
  if (!hotMoments) {
    try {
      const aiPath = join(workDir, 'ai-results.json');
      if (existsSync(aiPath)) {
        const ai = JSON.parse(await readFile(aiPath, 'utf8'));
        hotMoments = ai.hot_moments || null;
        bestThumbnailSec = bestThumbnailSec ?? ai.best_thumbnail_sec ?? null;
        previewStartSec = previewStartSec ?? ai.preview_start_sec ?? null;
      }
    } catch {}
  }

  const hasAI = Array.isArray(hotMoments) && hotMoments.length >= 2;
  const thumbCount = duration > 600 ? 20 : duration > 300 ? 16 : 12;

  // Determine screenshot timestamps
  const timestamps = [];
  if (hasAI) {
    const valid = hotMoments
      .map(t => typeof t === 'number' ? t : (typeof t === 'object' && t !== null ? (t.timestamp || t.sec || t.time || t.timestamp_sec || t.start_sec) : null))
      .filter(t => typeof t === 'number' && t >= 0 && t < duration)
      .sort((a, b) => a - b);
    if (typeof bestThumbnailSec === 'number' && bestThumbnailSec >= 0 && bestThumbnailSec < duration) {
      if (!valid.some(t => Math.abs(t - bestThumbnailSec) < 1)) { valid.push(bestThumbnailSec); valid.sort((a, b) => a - b); }
    }
    const existing = new Set(valid.map(t => Math.round(t)));
    for (let i = 0; i < thumbCount && valid.length < thumbCount; i++) {
      const ts = Math.max(0.5, duration * (i + 1) / (thumbCount + 1));
      if (!existing.has(Math.round(ts))) { valid.push(ts); existing.add(Math.round(ts)); }
    }
    valid.sort((a, b) => a - b);
    timestamps.push(...valid.slice(0, thumbCount));
    logger.info(`[${stepName}:${xcadrId}] AI timestamps: ${timestamps.length} (hot_moments=${hotMoments.length}, best=${bestThumbnailSec}s)`);
  } else {
    for (let i = 0; i < thumbCount; i++) timestamps.push(Math.max(0.5, duration * (i + 1) / (thumbCount + 1)));
    logger.info(`[${stepName}:${xcadrId}] Uniform timestamps: ${timestamps.length} (no AI data)`);
  }

  // Extract screenshots (flat in workdir, not subdirectory)
  const totalMediaOps = timestamps.length + 2;
  let mediaOpsDone = 0;
  const screenshotFiles = [];
  for (let i = 0; i < timestamps.length; i++) {
    const fileName = `thumb_${String(i + 1).padStart(3, '0')}.jpg`;
    const outPath = join(workDir, fileName);
    writeStepProgress(xcadrId, { step: 'media', status: 'running', percent: Math.round(mediaOpsDone / totalMediaOps * 100), detail: `Screenshot ${i + 1}/${timestamps.length}...` });
    try {
      await execFileAsync('ffmpeg', ['-ss', String(timestamps[i]), '-i', videoPath, '-vframes', '1', '-vf', `scale=${MEDIA_DEFAULTS.thumbWidth}:-2`, '-q:v', '2', '-y', outPath], { timeout: 30000 });
      const s = await stat(outPath);
      if (s.size > 0) screenshotFiles.push(fileName);
    } catch (err) { logger.warn(`[${stepName}:${xcadrId}] Frame ${i+1} at ${timestamps[i].toFixed(1)}s failed: ${err.message}`); }
    mediaOpsDone++;
  }
  if (screenshotFiles.length < 2) throw new Error(`Only ${screenshotFiles.length} screenshots extracted (need >= 2)`);
  logger.info(`[${stepName}:${xcadrId}] Screenshots: ${screenshotFiles.length}/${timestamps.length}`);

  // Preview clip: preview_start_sec + 2s offset (AI timestamps slightly early)
  writeStepProgress(xcadrId, { step: 'media', status: 'running', percent: Math.round(mediaOpsDone / totalMediaOps * 100), detail: 'Generating preview clip...' });
  let previewClipOk = false;
  {
    let clipStart;
    if (typeof previewStartSec === 'number' && previewStartSec >= 0 && previewStartSec < duration - 2) {
      clipStart = Math.min(previewStartSec + 2, duration - 6);
    } else { clipStart = duration * 0.4; }
    const clipDur = Math.min(MEDIA_DEFAULTS.previewDuration, duration - clipStart);
    if (clipDur >= 2) {
      try {
        await execFileAsync('ffmpeg', ['-ss', String(Math.max(0, clipStart).toFixed(2)), '-i', videoPath, '-t', String(clipDur),
          '-vf', `scale=${MEDIA_DEFAULTS.previewWidth}:-2`, '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', String(MEDIA_DEFAULTS.previewCrf),
          '-movflags', '+faststart', '-y', join(workDir, 'preview.mp4')], { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
        const ps = await stat(join(workDir, 'preview.mp4'));
        if (ps.size > 0) { previewClipOk = true; logger.info(`[${stepName}:${xcadrId}] Preview clip: ${clipDur.toFixed(1)}s from ${clipStart.toFixed(1)}s (${(ps.size/1024).toFixed(0)}KB)`); }
      } catch (err) { logger.warn(`[${stepName}:${xcadrId}] Preview clip failed: ${err.message}`); }
    }
  }
  mediaOpsDone++;

  // Preview GIF: best_thumbnail_sec + 1s offset
  writeStepProgress(xcadrId, { step: 'media', status: 'running', percent: Math.round(mediaOpsDone / totalMediaOps * 100), detail: 'Generating preview GIF...' });
  let gifOk = false;
  {
    let gifStart;
    if (typeof bestThumbnailSec === 'number' && bestThumbnailSec > 1 && bestThumbnailSec < duration - 2) {
      gifStart = Math.max(0, bestThumbnailSec + 1);
    } else { gifStart = duration * 0.4; }
    const gifDur = Math.min(MEDIA_DEFAULTS.gifDuration, duration - gifStart);
    if (gifDur >= 2) {
      try {
        await execFileAsync('ffmpeg', ['-ss', String(gifStart), '-i', videoPath, '-t', String(gifDur),
          '-vf', `fps=${MEDIA_DEFAULTS.gifFps},scale=${MEDIA_DEFAULTS.gifWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
          '-loop', '0', '-y', join(workDir, 'preview.gif')], { timeout: 120000 });
        const gs = await stat(join(workDir, 'preview.gif'));
        if (gs.size > 0) { gifOk = true; logger.info(`[${stepName}:${xcadrId}] Preview GIF: ${gifDur.toFixed(1)}s from ${gifStart.toFixed(1)}s (${(gs.size/1024).toFixed(0)}KB)`); }
      } catch (err) { logger.warn(`[${stepName}:${xcadrId}] Preview GIF failed: ${err.message}`); }
    }
  }

  // Pick best thumbnail — closest to best_thumbnail_sec
  let bestThumbFile = screenshotFiles[0];
  if (typeof bestThumbnailSec === 'number' && timestamps.length > 0) {
    let bestIdx = 0, bestDiff = Infinity;
    for (let i = 0; i < timestamps.length && i < screenshotFiles.length; i++) {
      const diff = Math.abs(timestamps[i] - bestThumbnailSec);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    bestThumbFile = screenshotFiles[bestIdx];
  }

  // Save media metadata to workdir for CDN upload step
  await writeFile(join(workDir, 'media-results.json'), JSON.stringify({
    screenshotFiles, bestThumbFile, duration: Math.round(duration), durationFormatted: formatDuration(duration),
    quality, previewClipOk, gifOk, hasAI, bestThumbnailSec, previewStartSec,
  }, null, 2));

  writeStepProgress(xcadrId, { step: 'media', status: 'done', percent: 100, detail: `${screenshotFiles.length} thumbs, clip=${previewClipOk}, gif=${gifOk}` });
  logger.info(`[${stepName}:${xcadrId}] Media done: ${screenshotFiles.length} thumbs, clip=${previewClipOk}, gif=${gifOk}`);
}

// ============================================================
// STEP: CDN Upload — with thumbnail_url (like Pipeline v2)
// ============================================================

async function processCdnUpload(xcadrId, stepName) {
  const workDir = join(WORK_DIR, String(xcadrId));

  const videoId = crypto.randomUUID();
  await writeFile(join(workDir, 'video-id.txt'), videoId);
  const cdnBase = `videos/${videoId}`;

  // Load media results to know which thumb is best
  let bestThumbFile = null;
  try {
    const mr = JSON.parse(await readFile(join(workDir, 'media-results.json'), 'utf8'));
    bestThumbFile = mr.bestThumbFile;
  } catch {}

  // Count total files
  const wmExists = existsSync(join(workDir, 'watermarked.mp4'));
  const previewExists = existsSync(join(workDir, 'preview.mp4'));
  const gifExists = existsSync(join(workDir, 'preview.gif'));
  const thumbFiles = readdirSync(workDir).filter(f => f.startsWith('thumb_') && f.endsWith('.jpg')).sort();
  const cdnTotalFiles = (wmExists ? 1 : 0) + thumbFiles.length + (previewExists ? 1 : 0) + (gifExists ? 1 : 0);
  let cdnFilesDone = 0;

  writeStepProgress(xcadrId, { step: 'cdn_upload', status: 'running', percent: 0, detail: `Uploading 0/${cdnTotalFiles} files...` });

  const urls = { screenshots: [] };

  // 1. Upload watermarked.mp4
  if (wmExists) {
    await uploadFile(join(workDir, 'watermarked.mp4'), `${cdnBase}/watermarked.mp4`);
    urls.video_url = `${config.bunny.cdnUrl}/${cdnBase}/watermarked.mp4`;
    cdnFilesDone++;
    logger.info(`[${stepName}:${xcadrId}] ✓ watermarked.mp4 uploaded`);
    writeStepProgress(xcadrId, { step: 'cdn_upload', status: 'running', percent: Math.round(cdnFilesDone / cdnTotalFiles * 100), detail: `Uploading ${cdnFilesDone}/${cdnTotalFiles} files...` });
  }

  // 2. Upload screenshots + pick thumbnail_url
  for (const thumbFile of thumbFiles) {
    await uploadFile(join(workDir, thumbFile), `${cdnBase}/${thumbFile}`);
    const cdnUrl = `${config.bunny.cdnUrl}/${cdnBase}/${thumbFile}`;
    urls.screenshots.push(cdnUrl);
    if (thumbFile === bestThumbFile) urls.thumbnail_url = cdnUrl;
    cdnFilesDone++;
    writeStepProgress(xcadrId, { step: 'cdn_upload', status: 'running', percent: Math.round(cdnFilesDone / cdnTotalFiles * 100), detail: `Uploading ${cdnFilesDone}/${cdnTotalFiles} files (${thumbFile})` });
  }
  // Fallback: first screenshot as thumbnail
  if (!urls.thumbnail_url && urls.screenshots.length > 0) urls.thumbnail_url = urls.screenshots[0];
  logger.info(`[${stepName}:${xcadrId}] ✓ ${urls.screenshots.length} screenshots uploaded`);

  // 3. Upload preview.mp4
  if (previewExists) {
    await uploadFile(join(workDir, 'preview.mp4'), `${cdnBase}/preview.mp4`);
    urls.preview_url = `${config.bunny.cdnUrl}/${cdnBase}/preview.mp4`;
    cdnFilesDone++;
    logger.info(`[${stepName}:${xcadrId}] ✓ preview.mp4 uploaded`);
  }

  // 4. Upload preview.gif
  if (gifExists) {
    await uploadFile(join(workDir, 'preview.gif'), `${cdnBase}/preview.gif`);
    urls.preview_gif_url = `${config.bunny.cdnUrl}/${cdnBase}/preview.gif`;
    cdnFilesDone++;
    logger.info(`[${stepName}:${xcadrId}] ✓ preview.gif uploaded`);
  }

  writeStepProgress(xcadrId, { step: 'cdn_upload', status: 'running', percent: 100, detail: `All ${cdnTotalFiles} files uploaded` });
  await writeFile(join(workDir, 'cdn-urls.json'), JSON.stringify(urls, null, 2));
  writeStepProgress(xcadrId, { step: 'cdn_upload', status: 'done', percent: 100, detail: 'Done' });
  logger.info(`[${stepName}:${xcadrId}] CDN upload done: ${cdnFilesDone} files`);
}

// ============================================================
// STEP: Publish — create records in DB only here (like Pipeline v2)
// ============================================================

async function processPublish(xcadrId, stepName) {
  const workDir = join(WORK_DIR, String(xcadrId));
  writeStepProgress(xcadrId, { step:'publish', status:'running', percent:5, detail:'Loading data...' });

  const meta = JSON.parse(await readFile(join(workDir,'xcadr-meta.json'),'utf8'));
  const cdnUrls = JSON.parse(await readFile(join(workDir,'cdn-urls.json'),'utf8'));
  const videoId = (await readFile(join(workDir,'video-id.txt'),'utf8')).trim();
  let aiRes=null; try{aiRes=JSON.parse(await readFile(join(workDir,'ai-results.json'),'utf8'));}catch(_){}
  let aiMeta=null; try{aiMeta=JSON.parse(await readFile(join(workDir,'metadata.json'),'utf8'));}catch(_){}
  let mediaRes=null; try{mediaRes=JSON.parse(await readFile(join(workDir,'media-results.json'),'utf8'));}catch(_){}

  // Pre-flight: verify CDN video exists
  if(!cdnUrls.video_url) throw new Error('No video_url in cdn-urls.json');
  // CDN file was just uploaded in cdn_upload step — skip size check, trust the upload

  writeStepProgress(xcadrId, { step:'publish', status:'running', percent:15, detail:'Celebrity...' });

  // Celebrity — find or create with TMDB enrichment
  let celebId=null; const cn=meta.celebrity_name_en||meta.celebrity_name_ru||'';
  if(cn){
    const{rows:ex}=await query(`SELECT id FROM celebrities WHERE LOWER(name)=LOWER($1) LIMIT 1`,[cn]);
    if(ex.length>0){celebId=ex[0].id;}
    else{
      const cs=slugify(cn,{lower:true,strict:true}).substring(0,200);
      const{rows:[nc]}=await query(`INSERT INTO celebrities(name,slug,status,created_at,updated_at)VALUES($1,$2,'draft',NOW(),NOW())ON CONFLICT(slug)DO UPDATE SET updated_at=NOW()RETURNING id`,[cn,cs]);
      celebId=nc.id;
      try{await enrichCelebTMDB(celebId,cn);}catch(_){}
    }
  }

  writeStepProgress(xcadrId, { step:'publish', status:'running', percent:25, detail:'Movie...' });

  // Movie — find or create with TMDB enrichment
  let movieId=null; const mt=meta.movie_title_en||meta.movie_title_ru||'', my=meta.year||meta.movie_year||null;
  if(mt){
    const mq=my?await query(`SELECT id FROM movies WHERE LOWER(title)=LOWER($1)AND year=$2 LIMIT 1`,[mt,my]):await query(`SELECT id FROM movies WHERE LOWER(title)=LOWER($1)LIMIT 1`,[mt]);
    if(mq.rows.length>0){movieId=mq.rows[0].id;}
    else{
      const ms=slugify(mt+(my?'-'+my:''),{lower:true,strict:true}).substring(0,200);
      const{rows:[nm]}=await query(`INSERT INTO movies(title,slug,year,status,created_at,updated_at)VALUES($1,$2,$3,'draft',NOW(),NOW())ON CONFLICT(slug)DO UPDATE SET updated_at=NOW()RETURNING id`,[mt,ms,my]);
      movieId=nm.id;
      try{await enrichMovieTMDB(movieId,mt,my);}catch(_){}
    }
  }

  writeStepProgress(xcadrId, { step:'publish', status:'running', percent:40, detail:'Video record...' });

  // Build video fields
  const title=aiRes?.title||JSON.stringify({en:meta.title_en||meta.title_ru||''});
  const slug=aiRes?.slug||JSON.stringify({en:slugify(meta.title_en||meta.title_ru||'untitled',{lower:true,strict:true})});
  const review=aiRes?.review||'{}', seoT=aiRes?.seo_title||'{}', seoD=aiRes?.seo_description||'{}';
  const aiTags=aiRes?.ai_tags||[], donorTags=meta.tags_ru||[];
  const dur = mediaRes?.duration || null;
  const durFormatted = mediaRes?.durationFormatted || null;
  const quality = mediaRes?.quality || 'unknown';
  const hotMoments = aiMeta?.hot_moments || aiRes?.hot_moments || null;
  const aiRawResponse = aiRes?.ai_raw_response || aiMeta?.ai_raw_response || null;

  // Determine publish status: require russian translations
  const tObj=typeof title==='string'?JSON.parse(title):title;
  const hasRuTranslation = tObj.ru && tObj.ru.length > 3;
  const status = hasRuTranslation ? 'published' : 'needs_review';

  await query(`INSERT INTO videos(id,original_title,title,slug,review,seo_title,seo_description,
    video_url,thumbnail_url,screenshots,preview_url,preview_gif_url,
    duration_seconds,duration_formatted,quality,
    ai_tags,donor_tags,ai_vision_status,ai_vision_model,
    best_thumbnail_sec,preview_start_sec,hot_moments,ai_raw_response,
    status,pipeline_step,published_at,created_at,updated_at)
    VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,
    $8,$9,$10::jsonb,$11,$12,
    $13,$14,$15,
    $16,$17,'completed',$18,
    $19,$20,$21::jsonb,$22,
    $23,NULL,$24,NOW(),NOW())`,
    [videoId, meta.title_en||meta.title_ru||'',
     typeof title==='string'?title:JSON.stringify(title),
     typeof slug==='string'?slug:JSON.stringify(slug),
     typeof review==='string'?review:JSON.stringify(review),
     typeof seoT==='string'?seoT:JSON.stringify(seoT),
     typeof seoD==='string'?seoD:JSON.stringify(seoD),
     cdnUrls.video_url, cdnUrls.thumbnail_url||null,
     JSON.stringify(cdnUrls.screenshots||[]),
     cdnUrls.preview_url||null, cdnUrls.preview_gif_url||null,
     dur, durFormatted, quality,
     aiTags, donorTags, aiMeta?.model_used||null,
     aiMeta?.best_thumbnail_sec||null, aiMeta?.preview_start_sec||null,
     hotMoments ? JSON.stringify(hotMoments) : null, aiRawResponse||null,
     status, status === 'published' ? new Date().toISOString() : null]);

  writeStepProgress(xcadrId, { step:'publish', status:'running', percent:60, detail:'Linking...' });

  // Link celebrity + movie
  if(celebId) await query(`INSERT INTO video_celebrities(video_id,celebrity_id)VALUES($1,$2)ON CONFLICT DO NOTHING`,[videoId,celebId]);
  if(movieId) await query(`INSERT INTO movie_scenes(video_id,movie_id)VALUES($1,$2)ON CONFLICT DO NOTHING`,[videoId,movieId]);

  // Publish linked celebrities and movies (like Pipeline v2)
  if(celebId) await query(`UPDATE celebrities SET status='published',updated_at=NOW()WHERE id=$1 AND status!='published'`,[celebId]);
  if(movieId) await query(`UPDATE movies SET status='published',updated_at=NOW()WHERE id=$1 AND status!='published'`,[movieId]);

  writeStepProgress(xcadrId, { step:'publish', status:'running', percent:80, detail:'Tags...' });

  // Tags: ai_tags priority, then donor tag mapping
  const normTags=aiTags.length>0?aiTags:mapDonorTags(donorTags);
  for(const ts of normTags){try{const{rows:[t]}=await query(`SELECT id FROM tags WHERE slug=$1`,[ts]);if(t)await query(`INSERT INTO video_tags(video_id,tag_id)VALUES($1,$2)ON CONFLICT DO NOTHING`,[videoId,t.id]);}catch(_){}}

  // Collection mapping
  for(const cn of(meta.collections_ru||[])){try{const{rows:[cm]}=await query(`SELECT our_collection_id FROM xcadr_collection_mapping WHERE xcadr_collection_ru=$1`,[cn]);if(cm?.our_collection_id)await query(`INSERT INTO collection_videos(collection_id,video_id)VALUES($1,$2)ON CONFLICT DO NOTHING`,[cm.our_collection_id,videoId]);}catch(_){}}

  // Tag mapping (xcadr tags → our tags)
  for(const tr of(meta.tags_ru||[])){try{const{rows:[tm]}=await query(`SELECT our_tag_slug FROM xcadr_tag_mapping WHERE xcadr_tag_ru=$1`,[tr]);if(tm?.our_tag_slug){const{rows:[t]}=await query(`SELECT id FROM tags WHERE slug=$1`,[tm.our_tag_slug]);if(t)await query(`INSERT INTO video_tags(video_id,tag_id)VALUES($1,$2)ON CONFLICT DO NOTHING`,[videoId,t.id]);}}catch(_){}}

  // Update xcadr_imports
  await query(`UPDATE xcadr_imports SET status='published',matched_video_id=$2,pipeline_step='published',updated_at=NOW()WHERE id=$1`,[xcadrId,videoId]);

  // Flush cache
  try{const r=(await import('./lib/cache.js')).default;if(r?.flushAll)await r.flushAll();}catch(_){}

  writeStepProgress(xcadrId, { step:'publish', status:'done', percent:100, detail:status });
  logger.info(`[${stepName}:${xcadrId}] Published ${videoId} (${status})`);
}

async function enrichCelebTMDB(id,name){
  const k=config.ai.tmdbApiKey;if(!k)return;
  const r=await axios.get('https://api.themoviedb.org/3/search/person',{params:{query:name,language:'en-US'},headers:{Authorization:`Bearer ${k}`},timeout:10000});
  const p=r.data?.results?.[0];if(!p)return;
  const d=await axios.get(`https://api.themoviedb.org/3/person/${p.id}`,{headers:{Authorization:`Bearer ${k}`},timeout:10000});
  const det=d.data;
  await query(`UPDATE celebrities SET tmdb_id=$2,nationality=$3,photo_url=$4,birth_date=$5,status='published',updated_at=NOW()WHERE id=$1`,
    [id,p.id,extractNationality(det.place_of_birth),det.profile_path?`https://image.tmdb.org/t/p/w500${det.profile_path}`:null,det.birthday]);
}

async function enrichMovieTMDB(id,title,year){
  const k=config.ai.tmdbApiKey;if(!k)return;
  let r=await axios.get('https://api.themoviedb.org/3/search/movie',{params:{query:title,year,language:'en-US'},headers:{Authorization:`Bearer ${k}`},timeout:10000});
  let m=r.data?.results?.[0];
  if(!m){r=await axios.get('https://api.themoviedb.org/3/search/tv',{params:{query:title,first_air_date_year:year,language:'en-US'},headers:{Authorization:`Bearer ${k}`},timeout:10000});m=r.data?.results?.[0];}
  if(!m)return;
  await query(`UPDATE movies SET tmdb_id=$2,poster_url=$3,status='published',updated_at=NOW()WHERE id=$1`,
    [id,m.id,m.poster_path?`https://image.tmdb.org/t/p/w500${m.poster_path}`:null]);
}

// ============================================================
// STEP: Cleanup
// ============================================================

async function processCleanup(xcadrId){
  const workDir=join(WORK_DIR,String(xcadrId));
  const{rows:[item]}=await query(`SELECT status FROM xcadr_imports WHERE id=$1`,[xcadrId]);
  if(item?.status!=='published'){logger.warn(`[cleanup:${xcadrId}] Not published — keeping`);return;}

  // Delete temp video record from videos table + pipeline-work dir
  try {
    const tvId = (await readFile(join(workDir, 'temp-video-id.txt'), 'utf8')).trim();
    if (tvId) {
      await query(`DELETE FROM videos WHERE id=$1`, [tvId]);
      await rm(join(V2_WORK_DIR, tvId), {recursive:true,force:true});
      logger.info(`[cleanup:${xcadrId}] Deleted temp video ${tvId.substring(0,8)} + pipeline-work`);
    }
  } catch {}

  await rm(workDir,{recursive:true,force:true});
  logger.info(`[cleanup:${xcadrId}] Cleaned up xcadr-work`);
}

// ============================================================
// Step processors + Progress
// ============================================================

const STEP_PROCESSORS = { download:processDownload, ai_vision:processAiVision, watermark:processWatermark, media:processMedia, cdn_upload:processCdnUpload, publish:processPublish, cleanup:processCleanup };

function startProgressReporter(queues,pools,stats,signal){
  const pf=join(__dirname,'logs','xcadr-progress.json');
  return setInterval(()=>{
    if(signal.stopped)return;
    const steps={};for(const n of STEP_ORDER)steps[n]={queued:queues[n]?.size()||0,active:pools[n]?.activeCount||0,completed:stats.byStep[n]||0};
    try{writeFileSync(pf,JSON.stringify({status:'running',steps,completed:stats.completed,failed:stats.failed,startedAt:stats.startedAt,elapsed:Math.round((Date.now()-stats.startedAtMs)/1000)}));}catch(_){}
  },PROGRESS_INTERVAL_MS);
}

// ============================================================
// Pre-pipeline: Parse + Translate
// ============================================================

async function runParseAndTranslate(){
  logger.info('Phase 1: Parsing xcadr.online...');
  const pa=[]; if(urlArg)pa.push(`--url=${urlArg}`); else if(celebArg)pa.push(`--celeb=${celebArg}`); else if(collArg)pa.push(`--collection=${collArg}`); else if(pagesArg>0)pa.push(`--pages=${pagesArg}`); else pa.push('--pages=3');
  if(limitArg>0)pa.push(`--limit=${limitArg}`);
  const pr=await runScript('xcadr/parse-xcadr.js',pa,'parse','');
  if(pr.exitCode!==0){logger.error(`Parse failed: ${pr.error}`);return[];}

  logger.info('Phase 2: Translating...');
  await runScript('xcadr/translate-xcadr.js',[`--limit=${limitArg}`],'translate','');

  const{rows}=await query(`SELECT id FROM xcadr_imports WHERE status IN('translated','matched')AND xcadr_url IS NOT NULL ORDER BY id DESC LIMIT $1`,[limitArg]);
  return rows.map(r=>r.id);
}

// ============================================================
// Main
// ============================================================

async function main(){
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       CelebSkin XCADR Pipeline — Orchestrator          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const signal={stopped:false};
  const stats={completed:0,failed:0,byStep:{},startedAt:new Date().toISOString(),startedAtMs:Date.now()};

  // Add pipeline columns if missing
  try{await query(`ALTER TABLE xcadr_imports ADD COLUMN IF NOT EXISTS pipeline_step TEXT`);await query(`ALTER TABLE xcadr_imports ADD COLUMN IF NOT EXISTS pipeline_error TEXT`);}catch(_){}

  // Cleanup on start: delete orphan temp videos from previous sessions
  logger.info('Cleanup: removing orphan temp videos from previous sessions...');
  try {
    // Reset stuck + failed xcadr_imports back to translated (retry on next run)
    const { rowCount: resetCount } = await query(
      `UPDATE xcadr_imports SET status = 'translated', pipeline_step = NULL, pipeline_error = NULL, updated_at = NOW()
       WHERE (
         (status NOT IN ('published', 'parsed', 'translated', 'matched', 'imported', 'no_match', 'duplicate') AND pipeline_step IS NOT NULL)
         OR status = 'failed'
       )`
    );
    if (resetCount > 0) logger.info(`Cleanup: reset ${resetCount} stuck/failed xcadr_imports → translated`);

    // Delete orphan temp video records (from ai_vision watermark queue) — not published/failed/needs_review
    const { rows: orphanVideos } = await query(
      `SELECT id FROM videos WHERE pipeline_step IN ('watermark_ready','watermark','watermarking_home','watermarked','ai_vision')
       AND status NOT IN ('published', 'failed', 'needs_review')`
    );
    for (const v of orphanVideos) {
      try { await query(`DELETE FROM video_celebrities WHERE video_id = $1`, [v.id]); } catch {}
      try { await query(`DELETE FROM movie_scenes WHERE video_id = $1`, [v.id]); } catch {}
      try { await query(`DELETE FROM video_tags WHERE video_id = $1`, [v.id]); } catch {}
      try { await query(`DELETE FROM collection_videos WHERE video_id = $1`, [v.id]); } catch {}
      try { await query(`DELETE FROM videos WHERE id = $1`, [v.id]); } catch {}
      try { await rm(join(V2_WORK_DIR, v.id), { recursive: true, force: true }); } catch {}
    }
    if (orphanVideos.length > 0) logger.info(`Cleanup: deleted ${orphanVideos.length} orphan temp videos`);

    // Clean xcadr-work dirs for non-published items
    if (existsSync(WORK_DIR)) {
      const dirs = readdirSync(WORK_DIR).filter(d => /^\d+$/.test(d));
      let cleaned = 0;
      for (const d of dirs) {
        const xcadrId = parseInt(d);
        const { rows: [item] } = await query(`SELECT status FROM xcadr_imports WHERE id = $1`, [xcadrId]);
        if (!item || (item.status !== 'published')) {
          await rm(join(WORK_DIR, d), { recursive: true, force: true });
          cleaned++;
        }
      }
      if (cleaned > 0) logger.info(`Cleanup: removed ${cleaned} xcadr-work dirs`);
    }
  } catch (e) { logger.warn(`Cleanup error: ${e.message}`); }

  const queues={};for(const n of STEP_ORDER)queues[n]=new PipelineQueue(n);
  const pools={};for(let i=0;i<STEP_ORDER.length;i++){const name=STEP_ORDER[i];pools[name]=new WorkerPool({name,concurrency:STEP_CONCURRENCY[name],processFn:STEP_PROCESSORS[name],inputQueue:queues[name],nextQueue:i<STEP_ORDER.length-1?queues[STEP_ORDER[i+1]]:null,signal,stats});}

  const shutdown=()=>{if(signal.stopped)return;logger.info('Shutdown...');signal.stopped=true;for(const n of STEP_ORDER)queues[n].wakeAll();setTimeout(()=>{process.exit(1);},30000).unref();};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);

  writeFileSync(PID_FILE,String(process.pid));process.on('exit',()=>{try{unlinkSync(PID_FILE);}catch{}});
  if(!existsSync(WORK_DIR))mkdirSync(WORK_DIR,{recursive:true});

  const progressInterval=startProgressReporter(queues,pools,stats,signal);
  logger.info(`Steps: ${STEP_ORDER.join(' → ')}`);
  const poolPromises=[];for(const n of STEP_ORDER)poolPromises.push(pools[n].start());

  const xcadrIds=await runParseAndTranslate();
  logger.info(`Seeding ${xcadrIds.length} videos`);
  for(const id of xcadrIds)queues.download.enqueue(id);

  // Main loop: monitor progress + poll DB for home worker completed watermarks
  while(!signal.stopped){
    const ta=STEP_ORDER.reduce((s,n)=>s+(pools[n]?.activeCount||0),0);
    const tq=STEP_ORDER.reduce((s,n)=>s+(queues[n]?.size()||0),0);

    // Check DB for pending watermarks (waiting in shared queue or being processed by home worker)
    let dbWmPending = 0;
    try {
      const { rows: [{ count }] } = await query(
        "SELECT COUNT(*)::int AS count FROM videos WHERE pipeline_step IN ('watermark_ready','watermarking_home')"
      );
      dbWmPending = count;
    } catch {}

    // Poll for home-worker completed watermarks that belong to xcadr pipeline
    // Home worker sets: status='watermarking_home', pipeline_step='watermarked' (or vice versa)
    try {
      const { rows: homeCompleted } = await query(
        `SELECT id FROM videos WHERE
         (status = 'watermarking_home' AND pipeline_step = 'watermarked')
         OR (status = 'watermarked' AND pipeline_step = 'watermarking_home')
         LIMIT 10`
      );
      for (const r of homeCompleted) {
        // Find which xcadr_import owns this temp video
        const tempVideoId = r.id;
        // Search xcadr-work dirs for matching temp-video-id.txt
        try {
          const xcadrDirs = readdirSync(WORK_DIR).filter(d => /^\d+$/.test(d));
          for (const d of xcadrDirs) {
            const tvFile = join(WORK_DIR, d, 'temp-video-id.txt');
            if (existsSync(tvFile)) {
              const tvId = (await readFile(tvFile, 'utf8')).trim();
              if (tvId === tempVideoId) {
                const xcadrId = parseInt(d);
                const v2Wm = join(V2_WORK_DIR, tempVideoId, 'watermarked.mp4');
                const xcadrWm = join(WORK_DIR, d, 'watermarked.mp4');
                if (existsSync(v2Wm) && !existsSync(xcadrWm)) {
                  await execFileAsync('cp', [v2Wm, xcadrWm], { timeout: 120000 });
                  logger.info(`[home-poll] xcadr:${xcadrId} ← home watermark ${tempVideoId.substring(0,8)}`);
                }
                // Mark in DB so we don't re-process
                await query(`UPDATE videos SET pipeline_step = 'watermarked', status = 'watermarked', updated_at = NOW() WHERE id = $1`, [tempVideoId]);
                // If this xcadr item is stuck in watermark queue waiting, the worker will see
                // the watermarked.mp4 and finish. No need to re-enqueue.
                break;
              }
            }
          }
        } catch (e) { logger.warn(`[home-poll] Error scanning for ${tempVideoId.substring(0,8)}: ${e.message}`); }
      }
    } catch {}

    if(ta===0&&tq===0&&dbWmPending===0&&(stats.completed+stats.failed)>=xcadrIds.length)break;
    await sleep(3000);
  }

  signal.stopped=true;for(const n of STEP_ORDER)queues[n].wakeAll();clearInterval(progressInterval);
  try{writeFileSync(join(__dirname,'logs','xcadr-progress.json'),JSON.stringify({status:'completed',completed:stats.completed,failed:stats.failed,byStep:stats.byStep,elapsed:Math.round((Date.now()-stats.startedAtMs)/1000)}));}catch(_){}
  logger.info(`\nDone: ${stats.completed} published, ${stats.failed} failed`);
  await Promise.allSettled(poolPromises);await pool.end();process.exit(0);
}

main().catch(e=>{logger.error(`Fatal: ${e.message}`);process.exit(1);});
