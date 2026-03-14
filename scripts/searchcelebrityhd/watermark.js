#!/usr/bin/env node
/**
 * watermark.js — SearchCelebrityHD Video Watermarking
 *
 * Two-step process:
 *   1. BLUR source watermarks (SearchCelebrityHD.com text in corners)
 *   2. ADD our celeb.skin watermark
 *
 * Combined into a single FFmpeg pass for efficiency.
 *
 * Usage:
 *   node watermark.js                    # process all enriched videos
 *   node watermark.js --limit=5          # limit
 *   node watermark.js --detect           # use AI to detect watermark size
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, stat, access } from 'fs/promises';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { config } from '../lib/config.js';
import { query } from '../lib/db.js';
import logger from '../lib/logger.js';
import { writeProgress, completeStep, setActiveItem, removeActiveItem } from '../lib/progress.js';
import { detectWatermark, buildCornerBlurFilter } from './remove-watermark.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = config.pipeline.tmpDir;

const WATERMARK_TEXT = 'celeb.skin';
const DEFAULTS = {
  opacity: 0.5,
  fontSize: 24,
  position: 'bottom-right',
  margin: 20,
  limit: 20,
  blurWidth: 300,
  blurHeight: 45,
  blurStrength: 20,
};

// ============================================
// Download Video
// ============================================

async function downloadVideo(url, destPath) {
  try {
    const response = await axios({
      method: 'get',
      url,
      responseType: 'stream',
      timeout: 600000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    await pipeline(response.data, createWriteStream(destPath));
    return true;
  } catch (err) {
    logger.error(`  Download failed: ${err.message}`);
    return false;
  }
}

// ============================================
// Combined: blur corners + add celeb.skin watermark (single FFmpeg pass)
// ============================================

async function processVideo(videoPath, outputPath, opts = {}) {
  // Get video dimensions
  const { stdout: probeOut } = await execFileAsync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    videoPath,
  ]);
  const [vw, vh] = probeOut.trim().split(',').map(Number);
  logger.info(`  Video: ${vw}x${vh}`);

  // Step 1: Always detect watermark via AI (one frame check)
  const detection = await detectWatermark(videoPath);
  const hasSourceWatermark = detection?.has_watermark === true;

  const scale = vw / 1280;
  const filters = [];
  let prevLabel = '0:v';

  // Step 2: Blur corners ONLY if source watermark detected
  if (hasSourceWatermark) {
    const blurW = Math.max((detection.width_px || 250) + 40, DEFAULTS.blurWidth);
    const blurH = Math.max((detection.height_px || 35) + 20, DEFAULTS.blurHeight);
    const bw = Math.round(blurW * scale);
    const bh = Math.round(blurH * scale);
    const bm = Math.round(5 * scale);
    const bs = Math.max(10, Math.round(DEFAULTS.blurStrength * scale));

    logger.info(`  Source watermark "${detection.text}" detected → blurring 4 corners (${bw}x${bh}px)`);

    const corners = [
      { name: 'tl', x: bm, y: bm },
      { name: 'tr', x: vw - bw - bm, y: bm },
      { name: 'bl', x: bm, y: vh - bh - bm },
      { name: 'br', x: vw - bw - bm, y: vh - bh - bm },
    ];

    for (const c of corners) {
      const crop = `${c.name}_c`;
      const blur = `${c.name}_b`;
      const out = `${c.name}_o`;
      filters.push(`[${prevLabel}]crop=${bw}:${bh}:${c.x}:${c.y}[${crop}]`);
      filters.push(`[${crop}]boxblur=${bs}:${bs}[${blur}]`);
      filters.push(`[${prevLabel}][${blur}]overlay=${c.x}:${c.y}[${out}]`);
      prevLabel = out;
    }
  } else {
    logger.info('  No source watermark detected → skipping corner blur');
  }

  // Step 3: Add celeb.skin text watermark on top
  const fontSize = Math.round(DEFAULTS.fontSize * scale);
  const margin = Math.round(DEFAULTS.margin * scale);
  const opacity = DEFAULTS.opacity;
  const drawtext = `drawtext=text='${WATERMARK_TEXT}':fontsize=${fontSize}:fontcolor=white@${opacity}:x=w-tw-${margin}:y=h-th-${margin}:shadowcolor=black@0.3:shadowx=1:shadowy=1`;
  filters.push(`[${prevLabel}]${drawtext}[final]`);

  const filterStr = filters.join(';');

  logger.info(`  Applying: ${hasSourceWatermark ? 'blur corners + ' : ''}celeb.skin watermark`);

  // Run FFmpeg
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', videoPath,
      '-filter_complex', filterStr,
      '-map', '[final]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      outputPath,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 1200000, // 20 min
    });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) resolve({ hasSourceWatermark });
      else reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-300)}`));
    });
    proc.on('error', reject);
  });
}

// ============================================
// Get pending videos
// ============================================

async function getWatermarkPending(limit) {
  const { rows } = await query(`
    SELECT v.id, v.title->>'en' as title_en, v.video_url, v.status,
           rv.extra_data
    FROM videos v
    JOIN raw_videos rv ON rv.id = v.raw_video_id
    WHERE v.status IN ('enriched', 'auto_recognized')
      AND v.video_url IS NOT NULL AND v.video_url != ''
      AND (v.video_url_watermarked IS NULL OR v.video_url_watermarked = '')
      AND rv.extra_data->>'source' = 'searchcelebrityhd'
    ORDER BY v.created_at ASC
    LIMIT $1
  `, [limit]);
  return rows;
}

// ============================================
// Main
// ============================================

const args = process.argv.slice(2);
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || String(DEFAULTS.limit));
const useDetect = args.includes('--detect');

logger.info('=== SearchCelebrityHD Watermarking ===');
logger.info(`Limit: ${limit}, AI detection: ${useDetect}`);

const pending = await getWatermarkPending(limit);
logger.info(`Found ${pending.length} videos to watermark`);

let processed = 0, errors = 0;

for (const video of pending) {
  const videoId = video.id;
  const workDir = join(TMP_DIR, videoId);
  await mkdir(workDir, { recursive: true });

  const videoTitle = video.title_en || videoId.slice(0, 8);
  logger.info(`\n[${processed + errors + 1}/${pending.length}] ${videoTitle}`);
  setActiveItem(videoId, { label: videoTitle, subStep: 'Downloading', pct: 0 });

  try {
    // 1. Download video
    const inputPath = join(workDir, 'source.mp4');
    const outputPath = join(workDir, 'watermarked.mp4');

    // Check if already downloaded
    let needsDownload = true;
    try {
      await access(inputPath);
      const s = await stat(inputPath);
      if (s.size > 1024) needsDownload = false;
    } catch {}

    if (needsDownload) {
      logger.info('  Downloading video...');
      setActiveItem(videoId, { label: videoTitle, subStep: 'Downloading', pct: 10 });
      const ok = await downloadVideo(video.video_url, inputPath);
      if (!ok) throw new Error('Download failed');
    } else {
      logger.info('  Using cached source video');
    }

    const inputStat = await stat(inputPath);
    logger.info(`  Source: ${(inputStat.size / 1024 / 1024).toFixed(1)}MB`);

    // 2. Process: AI detects watermark → blur if found → add celeb.skin
    setActiveItem(videoId, { label: videoTitle, subStep: 'Detecting watermark', pct: 30 });
    await processVideo(inputPath, outputPath);

    const outputStat = await stat(outputPath);
    logger.info(`  ✓ Processed (${(inputStat.size / 1024 / 1024).toFixed(1)}MB → ${(outputStat.size / 1024 / 1024).toFixed(1)}MB)`);

    // 3. Update DB — save local path (upload-to-cdn.js will replace with CDN URL)
    await query(
      `UPDATE videos SET
        video_url_watermarked = $2,
        status = 'watermarked',
        updated_at = NOW()
      WHERE id = $1`,
      [videoId, join(workDir, 'watermarked.mp4')]
    );

    removeActiveItem(videoId);
    processed++;
  } catch (err) {
    removeActiveItem(videoId);
    logger.error(`  ✗ ${videoTitle}: ${err.message}`);
    await query(
      `UPDATE videos SET status = 'needs_review', updated_at = NOW() WHERE id = $1`,
      [videoId]
    );
    errors++;
  }
}

completeStep({
  videosDone: processed,
  videosTotal: pending.length,
  errorCount: errors,
});

logger.info(`\n=== Watermark Summary: ${processed} processed, ${errors} errors ===`);
