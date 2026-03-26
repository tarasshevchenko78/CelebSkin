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

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs';
import { readFile, writeFile, rm, stat, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile as execFileCb, spawn } from 'child_process';
import { promisify } from 'util';
import { pipeline as streamPipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import crypto from 'crypto';
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
const xcadrAgent = new SocksProxyAgent('socks5h://127.0.0.1:40000');

// Ignore EPIPE errors (parent process restarted, pipe broken)
process.stdout.on('error', (e) => { if (e.code !== 'EPIPE') throw e; });
process.stderr.on('error', (e) => { if (e.code !== 'EPIPE') throw e; });

// --- WARP auto-recovery ---
let warpReconnecting = false;
async function ensureWarpAlive() {
  try {
    const resp = await axios.get('https://xcadr.online/', {
      httpAgent: xcadrAgent, httpsAgent: xcadrAgent,
      timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' },
      validateStatus: () => true
    });
    return true;
  } catch (e) {
    if (warpReconnecting) {
      for (let w = 0; w < 12; w++) { await sleep(5000); if (!warpReconnecting) return true; }
      return false;
    }
    warpReconnecting = true;
    logger.warn('[WARP] Connection failed, auto-reconnecting...');
    try {
      await execFileAsync('warp-cli', ['--accept-tos', 'disconnect'], { timeout: 10000 }).catch(() => {});
      await sleep(2000);
      await execFileAsync('warp-cli', ['--accept-tos', 'connect'], { timeout: 10000 });
      for (let i = 0; i < 12; i++) {
        await sleep(5000);
        try {
          const { stdout } = await execFileAsync('warp-cli', ['--accept-tos', 'status'], { timeout: 5000 });
          if (stdout.includes('Connected')) {
            logger.info('[WARP] Reconnected successfully');
            warpReconnecting = false;
            return true;
          }
        } catch (_) {}
      }
      logger.error('[WARP] Failed to reconnect after 60s');
      warpReconnecting = false;
      return false;
    } catch (e2) {
      logger.error('[WARP] Reconnect error: ' + e2.message);
      warpReconnecting = false;
      return false;
    }
  }
}
import * as cheerio from 'cheerio';
// ── Cyrillic → Latin transliteration for celebrity/movie names ──
const TRANSLIT_MAP = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i',
  'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
  'у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y',
  'ь':'','э':'e','ю':'yu','я':'ya',
  'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'Yo','Ж':'Zh','З':'Z','И':'I',
  'Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T',
  'У':'U','Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch','Ъ':'','Ы':'Y',
  'Ь':'','Э':'E','Ю':'Yu','Я':'Ya'
};
function transliterate(str) {
  if (!str) return str;
  return str.split('').map(c => TRANSLIT_MAP[c] !== undefined ? TRANSLIT_MAP[c] : c).join('');
}

// ── Russian country name → ISO 3166-1 alpha-2 ──
const COUNTRY_RU_TO_ISO = {
  'россия':'RU','сша':'US','франция':'FR','германия':'DE','великобритания':'GB','англия':'GB',
  'италия':'IT','испания':'ES','канада':'CA','австралия':'AU','япония':'JP','китай':'CN',
  'южная корея':'KR','индия':'IN','бразилия':'BR','мексика':'MX','аргентина':'AR',
  'швеция':'SE','норвегия':'NO','дания':'DK','финляндия':'FI','нидерланды':'NL','голландия':'NL',
  'бельгия':'BE','швейцария':'CH','австрия':'AT','польша':'PL','чехия':'CZ','венгрия':'HU',
  'румыния':'RO','болгария':'BG','сербия':'RS','хорватия':'HR','греция':'GR','турция':'TR',
  'португалия':'PT','ирландия':'IE','новая зеландия':'NZ','таиланд':'TH','вьетнам':'VN',
  'индонезия':'ID','филиппины':'PH','колумбия':'CO','чили':'CL','перу':'PE','украина':'UA',
  'беларусь':'BY','казахстан':'KZ','грузия':'GE','армения':'AM','израиль':'IL','иран':'IR',
  'egypt':'EG','south africa':'ZA','nigeria':'NG','kenya':'KE','morocco':'MA',
  'russia':'RU','usa':'US','france':'FR','germany':'DE','uk':'GB','italy':'IT','spain':'ES',
  'canada':'CA','australia':'AU','japan':'JP','china':'CN','south korea':'KR','india':'IN',
  'brazil':'BR','mexico':'MX','argentina':'AR','sweden':'SE','norway':'NO','denmark':'DK',
  'finland':'FI','netherlands':'NL','belgium':'BE','switzerland':'CH','austria':'AT',
  'poland':'PL','czech republic':'CZ','czechia':'CZ','hungary':'HU','romania':'RO',
  'portugal':'PT','ireland':'IE','new zealand':'NZ','thailand':'TH','turkey':'TR',
  'israel':'IL','greece':'GR','croatia':'HR','serbia':'RS','bulgaria':'BG',
  'ukraine':'UA','belarus':'BY','georgia':'GE','taiwan':'TW','singapore':'SG',
  'hong kong':'HK','luxembourg':'LU','iceland':'IS','estonia':'EE','latvia':'LV','lithuania':'LT',
};
function countriesToISO(str) {
  if (!str) return null;
  const codes = str.split(',').map(s => {
    const key = s.trim().toLowerCase();
    return COUNTRY_RU_TO_ISO[key] || (key.length === 2 ? key.toUpperCase() : null);
  }).filter(Boolean);
  return codes.length > 0 ? codes : null;
}

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
const RETRY_DELAYS = [10000, 30000, 60000, 120000];
const LOCALES = ["en", "ru", "de", "fr", "es", "pt", "it", "pl", "nl", "tr"];const GEMINI_API_KEYS = (config.ai.geminiApiKey || "").split(",").map(k => k.trim()).filter(Boolean);let _geminiKeyIdx = 0;function getGeminiKey() { return GEMINI_API_KEYS[_geminiKeyIdx++ % GEMINI_API_KEYS.length] || ""; }const GEMINI_MODEL = "gemini-3-flash-preview";
const PROGRESS_INTERVAL_MS = 3000;
const SUBPROCESS_TIMEOUT = 600000;

const STEP_ORDER = ['download', 'ai_vision', 'watermark', 'media', 'cdn_upload', 'publish', 'cleanup'];

let STEP_CONCURRENCY = {
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
const downloadThreads = parseInt(getArg("download-threads")) || 0;
if (downloadThreads > 0) { for (const k of Object.keys(STEP_CONCURRENCY)) STEP_CONCURRENCY[k] = downloadThreads; }

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
          catch (e) {
            lastErr = e;
            logger.error(`[${this.name}:${xcadrId}] Attempt ${att + 1} failed: ${e.message}`);
            if (e.message && (e.message.includes('Socks') || e.message.includes('ECONNREFUSED') || e.message.includes('Connection refused'))) {
              logger.warn(`[${this.name}:${xcadrId}] Proxy error detected, attempting WARP recovery...`);
              await ensureWarpAlive();
            }
          }
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

  // Check WARP proxy before download
  await ensureWarpAlive();
  // Use yt-dlp to download — handles KVS player JS, cookies, function/0/ prefix
  writeStepProgress(xcadrId, { step: 'download', status: 'running', percent: 30, detail: 'Downloading with yt-dlp...' });
  const ytdlpArgs = [
    '-f', 'best[ext=mp4]/best',
    '--no-check-certificates',
    '--no-warnings',
    '-o', videoPath,
    '--socket-timeout', '30',
    '--retries', '3',
    '--proxy', 'socks5://127.0.0.1:40000',
    '--limit-rate', '2M',
    '--sleep-requests', '2',
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
    '-preset', 'fast', '-crf', '19',
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
  // Try xcadr og:image as primary thumbnail (better quality than generated)
  try {
    const xcadrMeta = JSON.parse(await readFile(join(workDir, "xcadr-meta.json"), "utf8"));
    const xcadrThumbUrl = xcadrMeta.thumbnail_url;
    if (xcadrThumbUrl) {
      const thumbPath = join(workDir, 'xcadr_thumb.jpg');
      // Download via AbeloHost (Contabo IP blocked by xcadr)
      const { execSync: execSyncChild } = await import('child_process');
      const sshCmd = 'ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@185.224.82.214';
      const curlCmd = "curl -s -o /tmp/xcadr_thumb_" + xcadrId + ".jpg -L '" + xcadrThumbUrl + "' -H 'User-Agent: Mozilla/5.0'";
      const scpCmd = 'scp -o StrictHostKeyChecking=no root@185.224.82.214:/tmp/xcadr_thumb_' + xcadrId + '.jpg ' + thumbPath;
      const rmCmd = 'rm -f /tmp/xcadr_thumb_' + xcadrId + '.jpg';
      execSyncChild(sshCmd + ' "' + curlCmd + '" && ' + scpCmd + ' && ' + sshCmd + ' "' + rmCmd + '"', { timeout: 30000 });
      const cdnThumb = await uploadFile(thumbPath, `videos/${xcadrId}/thumbnail.jpg`);
      if (cdnThumb) {
        urls.thumbnail_url = cdnThumb;
        logger.info(`[cdn_upload] Using xcadr thumbnail: ${xcadrThumbUrl}`);
      }
    }
  } catch (e) { logger.info(`[cdn_upload] xcadr thumbnail fallback failed: ${e.message}`); }
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
  let celebId=null;
  const cnEn = meta.celebrity_name_en || '';
  const cnRu = meta.celebrity_name_ru || '';
  if(cnEn || cnRu){
    // 1. Search by English name
    if(cnEn){
      const{rows}=await query(`SELECT id FROM celebrities WHERE LOWER(name_localized->>'ru')=LOWER($1) OR LOWER(name)=LOWER($1) LIMIT 1`,[cnEn]);
      if(rows.length>0) celebId=rows[0].id;
    }
    // 2. Search by Russian name
    if(!celebId && cnRu){
      const{rows}=await query(`SELECT id FROM celebrities WHERE LOWER(name_localized->>'ru')=LOWER($1) OR LOWER(name)=LOWER($1) LIMIT 1`,[cnRu]);
      if(rows.length>0) celebId=rows[0].id;
    }
    // 3. Search via TMDB by Russian name → get English name → search DB
    let tmdbCelebNameEn = '';
    if(!celebId && cnRu){
      try{
        const k=config.ai.tmdbApiKey;
        if(k){
          const tr=await axios.get('https://api.themoviedb.org/3/search/person',{params:{query:cnRu,language:'en-US'},headers:{Authorization:`Bearer ${k}`},timeout:10000});
          const tp=tr.data?.results?.[0];
          if(tp){
            tmdbCelebNameEn = tp.name || '';
            // Search by TMDB ID first
            const{rows:byTmdb}=await query(`SELECT id FROM celebrities WHERE tmdb_id=$1 LIMIT 1`,[tp.id]);
            if(byTmdb.length>0){celebId=byTmdb[0].id;}
            else{
              // Search by English name from TMDB
              const{rows:byName}=await query(`SELECT id FROM celebrities WHERE LOWER(name_localized->>'ru')=LOWER($1) OR LOWER(name)=LOWER($1) LIMIT 1`,[tp.name]);
              if(byName.length>0){celebId=byName[0].id;}
            }
          }
        }
      }catch(_){}
    }
    // 3b. Also try TMDB with English name if available
    if(!celebId && cnEn && !tmdbCelebNameEn){
      try{
        const k=config.ai.tmdbApiKey;
        if(k){
          const tr=await axios.get('https://api.themoviedb.org/3/search/person',{params:{query:cnEn,language:'en-US'},headers:{Authorization:`Bearer ${k}`},timeout:10000});
          const tp=tr.data?.results?.[0];
          if(tp) tmdbCelebNameEn = tp.name || '';
        }
      }catch(_){}
    }
    // 4. Create new with English name (TMDB English > cnEn > cnRu)
    if(!celebId){
      let name = tmdbCelebNameEn || cnEn || transliterate(cnRu) || cnRu;
      let nameLocalized = {};
      // If no TMDB/EN name and we have Russian, translate via Gemini
      if (!tmdbCelebNameEn && !cnEn && cnRu) {
        try {
          const geminiResp = await translateWithGemini(
            `This is a celebrity/actress name in Russian: "${cnRu}"
Find the correct international (English/Latin) spelling of this person's name.
Return ONLY valid JSON:
{
  "name_en": "Correct Latin spelling of the name",
  "name_localized": {"en":"...","ru":"${cnRu}","de":"...","fr":"...","es":"...","pt":"...","it":"...","pl":"...","nl":"...","tr":"..."}
}`
          );
          if (geminiResp) {
            const parsed = typeof geminiResp === 'string' ? JSON.parse(geminiResp) : geminiResp;
            if (parsed.name_en) name = parsed.name_en;
            if (parsed.name_localized) nameLocalized = parsed.name_localized;
            if (!nameLocalized.ru) nameLocalized.ru = cnRu;
          }
        } catch(e) { logger.warn('[publish] Gemini celeb translate failed: ' + e.message); }
        if (!nameLocalized.ru) nameLocalized.ru = cnRu;
      }
      const cs=slugify(name,{lower:true,strict:true}).substring(0,200);
      const{rows:[nc]}=await query(`INSERT INTO celebrities(name,slug,name_localized,status,created_at,updated_at)VALUES($1,$2,$3::jsonb,'draft',NOW(),NOW())ON CONFLICT(slug)DO UPDATE SET name_localized=CASE WHEN celebrities.name_localized IS NULL OR celebrities.name_localized='{}' THEN $3::jsonb ELSE celebrities.name_localized END,updated_at=NOW()RETURNING id`,[name,cs,JSON.stringify(nameLocalized)]);
      celebId=nc.id;
      logger.info(`[publish] Created celebrity: ${name} (tmdbEn=${tmdbCelebNameEn||'none'}, cnEn=${cnEn||'none'}, cnRu=${cnRu||'none'})`);
      try{await enrichCelebTMDB(celebId,name,meta);}catch(_){}
    }
  }
  writeStepProgress(xcadrId, { step:'publish', status:'running', percent:25, detail:'Movie...' });

  // Movie — find or create with TMDB enrichment
  let movieId=null;
  const mtEn = meta.movie_title_en || '';
  const mtRu = meta.movie_title_ru || '';
  const my = meta.year || meta.movie_year || null;
  if(mtEn || mtRu){
    // 1. Search by English title
    if(mtEn){
      const mq=my?await query(`SELECT id FROM movies WHERE LOWER(title)=LOWER($1)AND year=$2 LIMIT 1`,[mtEn,my]):await query(`SELECT id FROM movies WHERE LOWER(title)=LOWER($1)LIMIT 1`,[mtEn]);
      if(mq.rows.length>0) movieId=mq.rows[0].id;
    }
    // 2. Search by Russian title in title_localized->>'ru' AND by title
    if(!movieId && mtRu){
      const mq=my
        ?await query(`SELECT id FROM movies WHERE (LOWER(title_localized->>'ru')=LOWER($1) OR LOWER(title)=LOWER($1)) AND year=$2 LIMIT 1`,[mtRu,my])
        :await query(`SELECT id FROM movies WHERE LOWER(title_localized->>'ru')=LOWER($1) OR LOWER(title)=LOWER($1) LIMIT 1`,[mtRu]);
      if(mq.rows.length>0) movieId=mq.rows[0].id;
    }
    // 3. Search via TMDB by Russian title → get English title → search DB
    let tmdbMovieTitleEn = '';
    if(!movieId && mtRu){
      try{
        const k=config.ai.tmdbApiKey;
        if(k){
          // Try movie search first
          const tr=await axios.get('https://api.themoviedb.org/3/search/movie',{params:{query:mtRu,year:my,language:'en-US'},headers:{Authorization:`Bearer ${k}`},timeout:10000});
          let tp=tr.data?.results?.[0];
          // Fallback: TV show search (xcadr often has series)
          if(!tp){
            const tvr=await axios.get('https://api.themoviedb.org/3/search/tv',{params:{query:mtRu,first_air_date_year:my,language:'en-US'},headers:{Authorization:`Bearer ${k}`},timeout:10000});
            tp=tvr.data?.results?.[0];
            if(tp) tp.title=tp.name; // TV uses 'name' instead of 'title'
          }
          if(tp){
            tmdbMovieTitleEn = tp.title || '';
            const{rows:byTmdb}=await query(`SELECT id FROM movies WHERE tmdb_id=$1 LIMIT 1`,[tp.id]);
            if(byTmdb.length>0){movieId=byTmdb[0].id;}
            else{
              const{rows:byTitle}=await query(`SELECT id FROM movies WHERE LOWER(title)=LOWER($1)LIMIT 1`,[tp.title]);
              if(byTitle.length>0){movieId=byTitle[0].id;}
            }
          }
        }
      }catch(_){}
    }
    // 3b. Also try TMDB with English title
    if(!movieId && mtEn && !tmdbMovieTitleEn){
      try{
        const k=config.ai.tmdbApiKey;
        if(k){
          const tr=await axios.get('https://api.themoviedb.org/3/search/movie',{params:{query:mtEn,year:my,language:'en-US'},headers:{Authorization:`Bearer ${k}`},timeout:10000});
          const tp=tr.data?.results?.[0];
          if(tp) tmdbMovieTitleEn = tp.title || '';
          if(!tp){
            const tvr=await axios.get('https://api.themoviedb.org/3/search/tv',{params:{query:mtEn,first_air_date_year:my,language:'en-US'},headers:{Authorization:`Bearer ${k}`},timeout:10000});
            const tvp=tvr.data?.results?.[0];
            if(tvp) tmdbMovieTitleEn = tvp.name || '';
          }
        }
      }catch(_){}
    }
    // 4. Create new with English title (TMDB English > mtEn > mtRu)
    if(!movieId){
      let title = tmdbMovieTitleEn || mtEn || transliterate(mtRu) || mtRu;
      // If no TMDB English title and we have Russian, translate via Gemini
      let titleLocalized = {};
      let descLocalized = {};
      if (!tmdbMovieTitleEn && mtRu) {
        try {
          const geminiResp = await translateWithGemini(
            `Translate from Russian to English and other languages.
Russian movie title: "${mtRu}"
Year: ${my || 'unknown'}

Return ONLY valid JSON:
{
  "title_en": "English title of the movie (find the real international title if possible)",
  "title_localized": {"en":"...","ru":"${mtRu}","de":"...","fr":"...","es":"...","pt":"...","it":"...","pl":"...","nl":"...","tr":"..."}
}`
          );
          if (geminiResp) {
            const parsed = typeof geminiResp === 'string' ? JSON.parse(geminiResp) : geminiResp;
            if (parsed.title_en) title = parsed.title_en;
            if (parsed.title_localized) titleLocalized = parsed.title_localized;
            if (!titleLocalized.ru) titleLocalized.ru = mtRu;
          }
        } catch(e) { logger.warn('[publish] Gemini movie translate failed: ' + e.message); }
        if (!titleLocalized.ru) titleLocalized.ru = mtRu;
      }
      const ms=slugify(title+(my?'-'+my:''),{lower:true,strict:true}).substring(0,200);
      const{rows:[nm]}=await query(`INSERT INTO movies(title,slug,year,title_localized,status,created_at,updated_at)VALUES($1,$2,$3,$4::jsonb,'draft',NOW(),NOW())ON CONFLICT(slug)DO UPDATE SET title_localized=CASE WHEN movies.title_localized IS NULL OR movies.title_localized='{}' THEN $4::jsonb ELSE movies.title_localized END,updated_at=NOW()RETURNING id`,[title,ms,my,JSON.stringify(titleLocalized)]);
      movieId=nm.id;
      logger.info(`[publish] Created movie: ${title} (tmdbEn=${tmdbMovieTitleEn||'none'}, mtEn=${mtEn||'none'}, mtRu=${mtRu||'none'})`);
      try{await enrichMovieTMDB(movieId,title,my,meta);}catch(_){}
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
  // Duplicate check: source_url + xcadr video ID + xcadr_imports
  const sourceUrl = meta.xcadr_url || item.xcadr_url || '';
  if(sourceUrl){
    const{rows:dup}=await query(`SELECT id FROM videos WHERE source_url=$1 LIMIT 1`,[sourceUrl]);
    if(dup.length>0){
      logger.info(`[publish] Skip duplicate: source_url already published as ${dup[0].id}`);
      await query(`UPDATE xcadr_imports SET status='duplicate', updated_at=NOW() WHERE id=$1`,[xcadrId]);
      return;
    }
    const xcadrVidId = sourceUrl.match(/\/videos\/(\d+)\//)?.[1];
    if(xcadrVidId){
      const{rows:dup2}=await query(`SELECT id FROM videos WHERE source_url LIKE $1 LIMIT 1`,[`%/videos/${xcadrVidId}/%`]);
      if(dup2.length>0){
        logger.info(`[publish] Skip duplicate: xcadr ID ${xcadrVidId} already as ${dup2[0].id}`);
        await query(`UPDATE xcadr_imports SET status='duplicate', updated_at=NOW() WHERE id=$1`,[xcadrId]);
        return;
      }
    }
    const{rows:dup3}=await query(`SELECT id FROM xcadr_imports WHERE xcadr_url=$1 AND status='published' AND id!=$2 LIMIT 1`,[sourceUrl,xcadrId]);
    if(dup3.length>0){
      logger.info(`[publish] Skip duplicate: import #${dup3[0].id} already published`);
      await query(`UPDATE xcadr_imports SET status='duplicate', updated_at=NOW() WHERE id=$1`,[xcadrId]);
      return;
    }
  }
  await query(`INSERT INTO videos(id,original_title,title,slug,review,seo_title,seo_description,
    video_url,thumbnail_url,screenshots,preview_url,preview_gif_url,
    duration_seconds,duration_formatted,quality,
    ai_tags,donor_tags,ai_vision_status,ai_vision_model,
    best_thumbnail_sec,preview_start_sec,hot_moments,ai_raw_response,
    status,pipeline_step,published_at,source_url,created_at,updated_at)
    VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,
    $8,$9,$10::jsonb,$11,$12,
    $13,$14,$15,
    $16,$17,'completed',$18,
    $19,$20,$21::jsonb,$22,
    $23,NULL,$24,$25,NOW(),NOW())`,
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
     status, status === 'published' ? new Date().toISOString() : null, sourceUrl||null]);

  writeStepProgress(xcadrId, { step:'publish', status:'running', percent:60, detail:'Linking...' });

  // Link celebrity + movie
  if(celebId) await query(`INSERT INTO video_celebrities(video_id,celebrity_id)VALUES($1,$2)ON CONFLICT DO NOTHING`,[videoId,celebId]);
  if(movieId) await query(`INSERT INTO movie_scenes(video_id,movie_id)VALUES($1,$2)ON CONFLICT DO NOTHING`,[videoId,movieId]);
  // Link celebrity to movie
  if(celebId && movieId) await query(`INSERT INTO movie_celebrities(movie_id,celebrity_id)VALUES($1,$2)ON CONFLICT DO NOTHING`,[movieId,celebId]);

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


async function translateWithGemini(prompt) {
  const key = getGeminiKey();
  if (!key) return null;
  try {
    const resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 4096 } },
      { timeout: 30000 }
    );
    const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (e) {
    logger.warn(`[gemini-translate] Error: ${e.message}`);
    return null;
  }
}

async function enrichCelebTMDB(id, name, xcadrMeta) {
  const k = config.ai.tmdbApiKey; if (!k) return;
  const r = await axios.get("https://api.themoviedb.org/3/search/person", { params: { query: name, language: "en-US" }, headers: { Authorization: `Bearer ${k}` }, timeout: 10000 });
  const p = r.data?.results?.[0];
  if (!p) {
    // FALLBACK: try xcadr celeb page for photo
    const slug = xcadrMeta?.celeb_xcadr_slug;
    if (slug) {
      try {
        const resp = await axios.get(`https://xcadr.online/celebs/${slug}/`, {
          httpAgent: xcadrAgent, httpsAgent: xcadrAgent,
          timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        const $ = cheerio.load(resp.data);

        // Parse birth date from <meta itemprop="birthDate"> or <li>Дата рождения:
        let birthDate = null;
        const bdMeta = $('meta[itemprop="birthDate"]').attr('content');
        if (bdMeta) birthDate = bdMeta;

        // Parse nationality/country from <li>Место рождения:
        let nationality = null;
        $('ul.model-list li').each(function() {
          const text = $(this).text();
          if (text.includes('Место рождения')) {
            const span = $(this).find('span').text().trim();
            // Extract country (first part before comma usually)
            if (span) nationality = span.split(',')[0].trim();
          }
        });

        // Parse photo
        let photoUrl = null;
        $('img[src*="/contents/models/"]').each(function() { if (!photoUrl) photoUrl = $(this).attr('src'); });

        let cdnPhotoUrl = null;
        if (photoUrl) {
          if (!photoUrl.startsWith('http')) photoUrl = 'https://xcadr.online' + photoUrl;
          try {
            const photoResp = await axios.get(photoUrl, { responseType: 'arraybuffer', timeout: 15000, httpAgent: xcadrAgent, httpsAgent: xcadrAgent, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://xcadr.online/' } });
            const photoPath = '/tmp/celeb_photo_' + id + '.jpg';
            writeFileSync(photoPath, photoResp.data);
            cdnPhotoUrl = await uploadFile(photoPath, 'celebrities/' + id + '/photo.jpg');
            try { unlinkSync(photoPath); } catch(_){}
          } catch(pe) { logger.warn('[enrich-celeb] Photo CDN upload failed: ' + pe.message); cdnPhotoUrl = photoUrl; }
        }

        // Update celebrity with all parsed data
        const updates = [];
        const params = [id];
        let pi = 2;
        if (cdnPhotoUrl) { updates.push('photo_url=COALESCE(photo_url,$' + pi + ')'); params.push(cdnPhotoUrl); pi++; }
        if (birthDate) { updates.push('birth_date=COALESCE(birth_date,$' + pi + ')'); params.push(birthDate); pi++; }
        if (nationality) { updates.push('nationality=COALESCE(nationality,$' + pi + ')'); params.push(nationality); pi++; }
        if (updates.length > 0) {
          await query('UPDATE celebrities SET ' + updates.join(',') + ', updated_at=NOW() WHERE id=$1', params);
          logger.info('[enrich-celeb] ' + name + ' (xcadr): photo=' + (cdnPhotoUrl ? 'yes' : 'no') + ', birth=' + (birthDate || 'no') + ', country=' + (nationality || 'no'));
        }
      } catch(e) { logger.warn(`[enrich-celeb] XCADR fallback failed for ${name}: ${e.message}`); }
    }
    return;
  }
  const d = await axios.get(`https://api.themoviedb.org/3/person/${p.id}`, { headers: { Authorization: `Bearer ${k}` }, timeout: 10000 });
  const det = d.data;
  const bioEn = det.biography || "";

  // Translate name and bio to 10 languages
  let nameLocalized = {}, bio = {};
  if (bioEn || name) {
    const prompt = `Translate the following celebrity information to these languages: ${LOCALES.join(", ")}.
Celebrity name (English): "${name}"
Biography (English): "${bioEn.substring(0, 2000)}"

Return ONLY valid JSON object with two fields:
- "name_localized": object with language codes as keys and translated/transliterated name as values (for Latin-script languages keep original English name, for ru/pl/tr etc transliterate appropriately)
- "bio": object with language codes as keys and translated biography as values (2-3 sentences each, keep factual)

Example: {"name_localized":{"en":"...","ru":"..."},"bio":{"en":"...","ru":"..."}}`;
    const translated = await translateWithGemini(prompt);
    if (translated) {
      nameLocalized = translated.name_localized || {};
      bio = translated.bio || {};
    }
  }
  // Ensure English values
  if (!nameLocalized.en) nameLocalized.en = name;
  if (!bio.en) bio.en = bioEn;

  let celebPhotoUrl = det.profile_path ? `https://image.tmdb.org/t/p/w500${det.profile_path}` : null;

  // If TMDB has no photo, try xcadr fallback for photo only
  if (!celebPhotoUrl && xcadrMeta?.celeb_xcadr_slug) {
    try {
      const xcResp = await axios.get(`https://xcadr.online/celebs/${xcadrMeta.celeb_xcadr_slug}/`, {
        httpAgent: xcadrAgent, httpsAgent: xcadrAgent, timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      const $x = cheerio.load(xcResp.data);
      let xcPhoto = null;
      $x('img[src*="/contents/models/"]').each(function() { if (!xcPhoto) xcPhoto = $x(this).attr('src'); });
      if (xcPhoto) {
        if (!xcPhoto.startsWith('http')) xcPhoto = 'https://xcadr.online' + xcPhoto;
        const photoResp = await axios.get(xcPhoto, { responseType: 'arraybuffer', timeout: 15000, httpAgent: xcadrAgent, httpsAgent: xcadrAgent, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://xcadr.online/' } });
        const pPath = '/tmp/celeb_photo_' + id + '.jpg';
        writeFileSync(pPath, photoResp.data);
        celebPhotoUrl = await uploadFile(pPath, 'celebrities/' + id + '/photo.jpg');
        try { unlinkSync(pPath); } catch(_){}
        logger.info(`[enrich-celeb] ${name}: TMDB found but no photo, got from xcadr`);
      }
    } catch(pe) { logger.warn(`[enrich-celeb] xcadr photo fallback for ${name}: ${pe.message}`); }
  }

  await query(`UPDATE celebrities SET tmdb_id=$2, nationality=$3, photo_url=$4, birth_date=$5, 
    name_localized=$6::jsonb, bio=$7::jsonb, status='published', updated_at=NOW() WHERE id=$1`,
    [id, p.id, extractNationality(det.place_of_birth),
     celebPhotoUrl,
     det.birthday,
     JSON.stringify(nameLocalized), JSON.stringify(bio)]);
  logger.info(`[enrich-celeb] ${name} (id=${id}): tmdb=${p.id}, photo=${celebPhotoUrl ? 'yes' : 'no'}, bio=${Object.keys(bio).length} langs`);
}

async function enrichMovieTMDB(id, title, year, xcadrMeta) {
  const k = config.ai.tmdbApiKey; if (!k) return;
  let r = await axios.get("https://api.themoviedb.org/3/search/movie", { params: { query: title, year, language: "en-US" }, headers: { Authorization: `Bearer ${k}` }, timeout: 10000 });
  let m = r.data?.results?.[0];
  let isTV = false;
  if (!m) {
    r = await axios.get("https://api.themoviedb.org/3/search/tv", { params: { query: title, first_air_date_year: year, language: "en-US" }, headers: { Authorization: `Bearer ${k}` }, timeout: 10000 });
    m = r.data?.results?.[0];
    isTV = !!m;
  }
  if (!m) {
    // FALLBACK: try xcadr movie page for poster
    const slug = xcadrMeta?.movie_xcadr_slug;
    if (slug) {
      try {
        const resp = await axios.get(`https://xcadr.online/movies/${slug}/`, {
          httpAgent: xcadrAgent, httpsAgent: xcadrAgent,
          timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        const $ = cheerio.load(resp.data);

        // Parse movie metadata from xcadr page
        let xcadrCountry = null, xcadrGenre = null, xcadrDesc = null, xcadrYear = null;
        $('li').each(function() {
          const text = $(this).text().trim();
          const span = $(this).find('span').text().trim();
          if (text.startsWith('Год:') && span) xcadrYear = parseInt(span) || null;
          if (text.startsWith('Страна:') && span) xcadrCountry = span;
          if (text.startsWith('Жанр:') && span) xcadrGenre = span;
        });
        xcadrDesc = $('div.desc').text().trim() || null;

        // Parse poster
        let posterUrl = null;
        $('img[src*="/contents/categories/"]').each(function() { if (!posterUrl) posterUrl = $(this).attr('src'); });
        let cdnPosterUrl = null;
        if (posterUrl) {
          if (!posterUrl.startsWith('http')) posterUrl = 'https://xcadr.online' + posterUrl;
          try {
            const posterResp = await axios.get(posterUrl, { responseType: 'arraybuffer', timeout: 15000, httpAgent: xcadrAgent, httpsAgent: xcadrAgent, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://xcadr.online/' } });
            const posterPath = '/tmp/movie_poster_' + id + '.jpg';
            writeFileSync(posterPath, posterResp.data);
            cdnPosterUrl = await uploadFile(posterPath, 'movies/' + id + '/poster.jpg');
            try { unlinkSync(posterPath); } catch(_){}
          } catch(pe) { logger.warn('[enrich-movie] Poster CDN upload failed: ' + pe.message); cdnPosterUrl = posterUrl; }
        }

        // Translate description from Russian via Gemini
        let descLocalized = {};
        if (xcadrDesc) {
          try {
            const translated = await translateWithGemini(
              'Translate this movie description to these languages: ' + LOCALES.join(', ') + '.\n' +
              'Russian description: "' + xcadrDesc.substring(0, 2000) + '"\n' +
              'Return ONLY valid JSON: {"en": "...", "ru": "...", "de": "...", ...}'
            );
            if (translated) descLocalized = translated;
          } catch(_) {}
          if (!descLocalized.ru) descLocalized.ru = xcadrDesc;
        }

        // Update movie with all parsed data
        const updates = [];
        const params = [id];
        let pi = 2;
        if (cdnPosterUrl) { updates.push('poster_url=COALESCE(poster_url,$' + pi + ')'); params.push(cdnPosterUrl); pi++; }
        const isoCodes = countriesToISO(xcadrCountry);
        if (isoCodes) { updates.push('countries=$' + pi); params.push(isoCodes); pi++; }
        if (xcadrYear) { updates.push('year=COALESCE(year,$' + pi + ')'); params.push(xcadrYear); pi++; }
        if (Object.keys(descLocalized).length > 0) {
          updates.push('description=CASE WHEN description IS NULL OR description = \'{}\'::jsonb THEN $' + pi + '::jsonb ELSE description END');
          params.push(JSON.stringify(descLocalized));
          pi++;
        }
        if (updates.length > 0) {
          await query('UPDATE movies SET ' + updates.join(',') + ', updated_at=NOW() WHERE id=$1', params);
          logger.info('[enrich-movie] ' + title + ' (xcadr): poster=' + (cdnPosterUrl ? 'yes' : 'no') + ', country=' + (xcadrCountry || 'no') + ', desc=' + (xcadrDesc ? xcadrDesc.substring(0, 50) : 'no'));
        }
      } catch(e) { logger.warn(`[enrich-movie] XCADR fallback failed for ${title}: ${e.message}`); }
    }
    return;
  }

  // Fetch full details
  const detailUrl = isTV ? `https://api.themoviedb.org/3/tv/${m.id}` : `https://api.themoviedb.org/3/movie/${m.id}`;
  const det = await axios.get(detailUrl, { headers: { Authorization: `Bearer ${k}` }, timeout: 10000 });
  const descEn = det.data?.overview || m.overview || "";
  const genres = (det.data?.genres || []).map(g => g.name);
  const director = null; // Could fetch credits but keep it simple
  const studio = isTV ? (det.data?.networks?.[0]?.name || null) : (det.data?.production_companies?.[0]?.name || null);

  // Translate title and description to 10 languages
  let titleLocalized = {}, description = {};
  if (descEn || title) {
    const prompt = `Translate the following movie/TV show information to these languages: ${LOCALES.join(", ")}.
Title (English): "${title}"
Description (English): "${descEn.substring(0, 2000)}"
Year: ${year || "unknown"}

Return ONLY valid JSON object with two fields:
- "title_localized": object with language codes as keys and translated title as values (keep original English title for Latin-script languages if well-known)
- "description": object with language codes as keys and translated description as values (2-3 sentences)

Example: {"title_localized":{"en":"...","ru":"..."},"description":{"en":"...","ru":"..."}}`;
    const translated = await translateWithGemini(prompt);
    if (translated) {
      titleLocalized = translated.title_localized || {};
      description = translated.description || {};
    }
  }
  if (!titleLocalized.en) titleLocalized.en = title;
  if (!description.en) description.en = descEn;

  // Extract countries from TMDB
  const tmdbCountries = (det.data?.production_countries || det.data?.origin_country || [])
    .map(c => typeof c === 'string' ? c : c.iso_3166_1)
    .filter(c => c && c.length === 2);

  await query(`UPDATE movies SET tmdb_id=$2, poster_url=$3, title_localized=$4::jsonb, description=$5::jsonb,
    genres=$6, studio=$7, year=COALESCE($8,year), countries=COALESCE($9,countries), status='published', updated_at=NOW() WHERE id=$1`,
    [id, m.id, m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
     JSON.stringify(titleLocalized), JSON.stringify(description),
     genres, studio, year || (isTV ? parseInt(det.data?.first_air_date?.substring(0,4)) : parseInt(det.data?.release_date?.substring(0,4))) || null,
     tmdbCountries.length > 0 ? tmdbCountries : null]);
  // If TMDB has no poster, try xcadr fallback
  const tmdbPosterUrl = m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null;
  let finalPosterUrl = tmdbPosterUrl;
  if (!finalPosterUrl && xcadrMeta?.movie_xcadr_slug) {
    try {
      const xcResp = await axios.get(`https://xcadr.online/movies/${xcadrMeta.movie_xcadr_slug}/`, {
        httpAgent: xcadrAgent, httpsAgent: xcadrAgent, timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      const $x = cheerio.load(xcResp.data);
      let xcPoster = null;
      $x('img[src*="/contents/categories/"]').each(function() { if (!xcPoster) xcPoster = $x(this).attr('src'); });
      if (xcPoster) {
        if (!xcPoster.startsWith('http')) xcPoster = 'https://xcadr.online' + xcPoster;
        const posterResp = await axios.get(xcPoster, { responseType: 'arraybuffer', timeout: 15000, httpAgent: xcadrAgent, httpsAgent: xcadrAgent, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://xcadr.online/' } });
        const ppPath = '/tmp/movie_poster_' + id + '.jpg';
        writeFileSync(ppPath, posterResp.data);
        finalPosterUrl = await uploadFile(ppPath, 'movies/' + id + '/poster.jpg');
        try { unlinkSync(ppPath); } catch(_){}
        logger.info(`[enrich-movie] ${title}: TMDB found but no poster, got from xcadr`);
      }
    } catch(pe) { logger.warn(`[enrich-movie] xcadr poster fallback for ${title}: ${pe.message}`); }
  }

  // Also get countries from xcadr if TMDB didn't provide them
  if (tmdbCountries.length === 0 && xcadrMeta?.movie_xcadr_slug) {
    try {
      const xcResp2 = await axios.get(`https://xcadr.online/movies/${xcadrMeta.movie_xcadr_slug}/`, {
        httpAgent: xcadrAgent, httpsAgent: xcadrAgent, timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      const $x2 = cheerio.load(xcResp2.data);
      $x2('li').each(function() {
        const text = $x2(this).text().trim();
        const span = $x2(this).find('span').text().trim();
        if (text.startsWith('Страна:') && span) {
          const iso = countriesToISO(span);
          if (iso && iso.length > 0) {
            tmdbCountries.push(...iso);
            logger.info(`[enrich-movie] ${title}: got countries from xcadr: ${iso.join(',')}`);
          }
        }
      });
    } catch(_) {}
  }

  // Re-update with poster and countries if we got them from xcadr fallback
  if (finalPosterUrl !== tmdbPosterUrl || tmdbCountries.length > 0) {
    const extraUpdates = [];
    const extraParams = [id];
    let epi = 2;
    if (finalPosterUrl && finalPosterUrl !== tmdbPosterUrl) { extraUpdates.push('poster_url=$' + epi); extraParams.push(finalPosterUrl); epi++; }
    if (tmdbCountries.length > 0) { extraUpdates.push('countries=$' + epi); extraParams.push(tmdbCountries); epi++; }
    if (extraUpdates.length > 0) {
      await query('UPDATE movies SET ' + extraUpdates.join(',') + ', updated_at=NOW() WHERE id=$1', extraParams);
    }
  }

  logger.info(`[enrich-movie] ${title} (id=${id}): tmdb=${m.id}, poster=${finalPosterUrl ? 'yes' : 'no'}, countries=${tmdbCountries.join(',') || 'none'}, desc=${Object.keys(description).length} langs`);
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

async function startParserBackground() {
  logger.info('Phase 1: Starting parser in background...');
  const pa = [];
  if (urlArg) pa.push(`--url=${urlArg}`);
  else if (celebArg) pa.push(`--celeb=${celebArg}`);
  else if (collArg) pa.push(`--collection=${collArg}`);
  else if (pagesArg > 0) pa.push(`--pages=${pagesArg}`);
  else pa.push('--pages=1900');
  if (limitArg > 0) pa.push(`--limit=${limitArg}`);

  // Run parser as background child process (don't await)
  const scriptPath = join(__dirname, 'xcadr/parse-xcadr.js');
  const child = spawn('node', [scriptPath, ...pa], {
    cwd: __dirname, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let parserDone = false;
  child.stdout.on('data', d => {
    const lines = d.toString().trim().split('\n');
    for (const line of lines) {
      if (line.startsWith('XCADR_PROGRESS:')) {
        // Optionally handle progress
      } else if (line.includes('Parsed ')) {
        logger.info(`[parser] ${line.trim().substring(0, 120)}`);
      }
    }
  });
  child.stderr.on('data', d => {
    const msg = d.toString().trim();
    if (msg && !msg.includes('dotenv')) logger.warn(`[parser:stderr] ${msg.substring(0, 200)}`);
  });
  child.on('close', code => { parserDone = true; logger.info(`[parser] Finished (exit=${code})`); });
  return { child, isDone: () => parserDone };
}

async function feedPipelineFromDb(queues, signal, limitArg) {
  // Poll DB for new parsed items, translate them, and feed to download queue
  const fed = new Set();
  let totalFed = 0;
  const maxFeed = limitArg > 0 ? limitArg : 9999;

  while (!signal.stopped && totalFed < maxFeed) {
    // Auto-reset SOCKS/proxy-failed downloads back to translated
    try {
      const { rowCount: resetCount } = await query(
        "UPDATE xcadr_imports SET status='translated', pipeline_error=NULL WHERE status='failed' AND pipeline_step='download' AND (pipeline_error LIKE '%Socks%' OR pipeline_error LIKE '%ECONNREFUSED%' OR pipeline_error LIKE '%Connection refused%') AND updated_at > NOW() - INTERVAL '10 minutes'"
      );
      if (resetCount > 0) logger.info('[feeder] Auto-reset ' + resetCount + ' SOCKS-failed downloads back to translated');
    } catch(_) {}

    // Find new parsed items that haven't been fed yet
    const { rows: parsed } = await query(
      `SELECT id FROM xcadr_imports WHERE status = 'parsed' AND xcadr_url IS NOT NULL ORDER BY id LIMIT 20`
    );

    if (parsed.length > 0) {
      // Translate batch
      logger.info(`[feeder] Found ${parsed.length} new parsed items, translating...`);
      await runScript('xcadr/translate-xcadr.js', [`--limit=20`], 'translate', '');
      await runScript('xcadr/map-tags.js', [], 'map-tags', '');

      // Now pick up translated/matched items
      const { rows: ready } = await query(
        `SELECT id FROM xcadr_imports WHERE status IN ('translated','matched') AND xcadr_url IS NOT NULL AND id NOT IN (SELECT unnest($1::int[])) ORDER BY id LIMIT $2`,
        [Array.from(fed).length > 0 ? Array.from(fed) : [0], maxFeed - totalFed]
      );

      for (const r of ready) {
        if (!fed.has(r.id)) {
          fed.add(r.id);
          queues.download.enqueue(r.id);
          totalFed++;
          logger.info(`[feeder] Queued xcadr_import #${r.id} for download (total: ${totalFed}/${maxFeed})`);
          if (totalFed >= maxFeed) break;
        }
      }
    }

    // Check if parser is done and no more items
    if (signal.parserDone && parsed.length === 0) {
      // One final check
      const { rows: final } = await query(
        `SELECT id FROM xcadr_imports WHERE status IN ('translated','matched') AND xcadr_url IS NOT NULL ORDER BY id`
      );
      for (const r of final) {
        if (!fed.has(r.id) && totalFed < maxFeed) {
          fed.add(r.id);
          queues.download.enqueue(r.id);
          totalFed++;
        }
      }
      break;
    }

    // Wait before polling again
    await new Promise(r => setTimeout(r, 5000));
  }
  logger.info(`[feeder] Done feeding. Total: ${totalFed} videos`);
  return totalFed;
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
  try{await query(`ALTER TABLE xcadr_imports ADD COLUMN IF NOT EXISTS pipeline_step TEXT`);
  await query(`ALTER TABLE xcadr_imports ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`);
  await query(`ALTER TABLE xcadr_imports ADD COLUMN IF NOT EXISTS celeb_xcadr_slug TEXT`);
  await query(`ALTER TABLE xcadr_imports ADD COLUMN IF NOT EXISTS movie_xcadr_slug TEXT`);await query(`ALTER TABLE xcadr_imports ADD COLUMN IF NOT EXISTS pipeline_error TEXT`);}catch(_){}

  // Cleanup on start: delete orphan temp videos from previous sessions
  logger.info('Cleanup: removing orphan temp videos from previous sessions...');
  try {
    // Delete non-published xcadr_imports so parser can re-discover failed videos
    const { rowCount: cleanedCount } = await query(
      `UPDATE xcadr_imports SET status='failed' WHERE status NOT IN ('published', 'duplicate', 'matched', 'translated', 'downloaded', 'parsed', 'failed') AND created_at < NOW() - INTERVAL '24 hours'`
    );
    if (cleanedCount > 0) logger.info(`Cleanup: removed ${cleanedCount} non-published from xcadr_imports`);
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

  const shutdown=(sig)=>{
    // If parent (pipeline-api) was restarted, we get SIGTERM but should continue
    // Only stop if explicitly requested (via /stop endpoint which sets PID file to 'stop')
    if(signal.stopped)return;
    const pidFileContent = (() => { try { return readFileSync(PID_FILE,'utf8').trim(); } catch(_) { return ''; } })();
    if (pidFileContent === 'stop') {
      logger.info('Shutdown requested via stop endpoint...');
      signal.stopped=true;for(const n of STEP_ORDER)queues[n].wakeAll();setTimeout(()=>{process.exit(1);},30000).unref();
    } else {
      logger.warn('Received ' + sig + ' but pipeline is running — ignoring (may be parent restart). Send again to force stop.');
      // On second signal, actually stop
      const forceShutdown = () => { logger.info('Force shutdown...'); signal.stopped=true;for(const n of STEP_ORDER)queues[n].wakeAll();setTimeout(()=>{process.exit(1);},30000).unref(); };
      process.removeAllListeners('SIGTERM'); process.removeAllListeners('SIGINT');
      process.on('SIGINT', forceShutdown); process.on('SIGTERM', forceShutdown);
    }
  };
  process.on('SIGINT',()=>shutdown('SIGINT'));process.on('SIGTERM',()=>shutdown('SIGTERM'));

  writeFileSync(PID_FILE,String(process.pid));process.on('exit',()=>{try{unlinkSync(PID_FILE);}catch{}});
  if(!existsSync(WORK_DIR))mkdirSync(WORK_DIR,{recursive:true});

  const progressInterval=startProgressReporter(queues,pools,stats,signal);
  logger.info(`Steps: ${STEP_ORDER.join(' → ')}`);
  const poolPromises=[];for(const n of STEP_ORDER)poolPromises.push(pools[n].start());

  // Start parser in background and feed items as they come
  const parser = await startParserBackground();
  signal.parserDone = false;
  parser.child.on('close', () => { signal.parserDone = true; });

  // Feed pipeline from DB in background (runs alongside worker pools)
  signal.feederDone = false;
  const feederPromise = feedPipelineFromDb(queues, signal, limitArg).then(() => { signal.feederDone = true; });
  logger.info('Pipeline running — parser feeds items as they are found');

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

    if(ta===0&&tq===0&&dbWmPending===0&&signal.parserDone&&signal.feederDone)break;
    await sleep(3000);
  }

  signal.stopped=true;for(const n of STEP_ORDER)queues[n].wakeAll();clearInterval(progressInterval);
  try{writeFileSync(join(__dirname,'logs','xcadr-progress.json'),JSON.stringify({status:'completed',completed:stats.completed,failed:stats.failed,byStep:stats.byStep,elapsed:Math.round((Date.now()-stats.startedAtMs)/1000)}));}catch(_){}
  logger.info(`\nDone: ${stats.completed} published, ${stats.failed} failed`);
  // Cleanup: remove non-published from xcadr_imports so parser can re-discover them
  try{const{rowCount}=await query(`UPDATE xcadr_imports SET status='failed' WHERE status NOT IN ('published', 'duplicate', 'matched', 'translated', 'downloaded', 'parsed', 'failed') AND created_at < NOW() - INTERVAL '24 hours'`);if(rowCount>0)logger.info(`Cleanup: removed ${rowCount} non-published records from xcadr_imports`);}catch(_){}
  await Promise.allSettled(poolPromises);await pool.end();process.exit(0);
}

main().catch(e=>{logger.error(`Fatal: ${e.message}`);process.exit(1);});
