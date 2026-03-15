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
import * as cheerio from 'cheerio';
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

const DEFAULTS = {
  limit: 20,
  blurWidth: 350,
  blurHeight: 35,
  blurStrength: 30,
};

// Load watermark settings from DB
async function getWatermarkConfig() {
  const { rows } = await query(`SELECT key, value FROM settings WHERE key LIKE 'watermark_%'`);
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    type: s.watermark_type || 'image',
    imageUrl: s.watermark_image_url || '',
    opacity: parseFloat(s.watermark_opacity || '0.5'),
    scale: parseFloat(s.watermark_scale || '0.1'),
    movement: s.watermark_movement || 'rotating_corners',
    margin: 20,
  };
}

// Download watermark PNG to local file
async function downloadWatermarkPng(url, destPath) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    const { writeFile } = await import('fs/promises');
    await writeFile(destPath, resp.data);
    return true;
  } catch (err) {
    logger.error(`  Failed to download watermark PNG: ${err.message}`);
    return false;
  }
}

// ============================================
// Download Video
// ============================================

// Get fresh video URL with auth token from source page
async function getFreshVideoUrl(sourceUrl) {
  try {
    const { data } = await axios.get(sourceUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 30000,
    });
    const $ = cheerio.load(data);
    // Look for tokenized URL in source tags or schema
    let tokenUrl = null;
    $('source[type="video/mp4"]').each((_, el) => {
      const src = $(el).attr('src');
      if (src && src.includes('token=')) tokenUrl = src.replace(/&#038;/g, '&');
    });
    if (!tokenUrl) {
      // Try LD+JSON
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($(el).html());
          const graph = json['@graph'] || [json];
          for (const item of graph) {
            if (item['@type'] === 'VideoObject' && item.contentUrl) {
              if (item.contentUrl.includes('token=')) tokenUrl = item.contentUrl;
            }
          }
        } catch {}
      });
    }
    return tokenUrl;
  } catch (err) {
    logger.warn(`  Failed to get fresh video URL: ${err.message}`);
    return null;
  }
}

async function downloadVideo(url, destPath) {
  try {
    const response = await axios({
      method: 'get',
      url,
      responseType: 'stream',
      timeout: 600000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://searchcelebrityhd.com/',
      },
    });
    await pipeline(response.data, createWriteStream(destPath));
    return true;
  } catch (err) {
    logger.error(`  Download failed: ${err.message}`);
    return false;
  }
}

// ============================================
// Combined: blur ALL 4 corners + add PNG watermark from settings (single FFmpeg pass)
// ============================================

async function processVideo(videoPath, outputPath, wmConfig) {
  // Get video dimensions
  const { stdout: probeOut } = await execFileAsync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    videoPath,
  ]);
  const [vw, vh] = probeOut.trim().split(',').map(Number);
  logger.info(`  Video: ${vw}x${vh}`);

  const scale = vw / 1280;

  // Step 1: ALWAYS blur all 4 corners with heavy boxblur (SearchCelebrityHD always has watermarks)
  const bw = Math.round(DEFAULTS.blurWidth * scale);
  const bh = Math.round(DEFAULTS.blurHeight * scale);
  const bs = DEFAULTS.blurStrength;

  logger.info(`  Blurring all 4 corners with boxblur (${bw}x${bh}px, strength=${bs})`);

  // Build corner blur: crop each corner → heavy boxblur → overlay back
  // This actually destroys the text unlike delogo which just interpolates
  const cornerDefs = [
    { x: 0, y: 0 },                        // top-left
    { x: vw - bw, y: 0 },                   // top-right
    { x: 0, y: vh - bh },                   // bottom-left
    { x: vw - bw, y: vh - bh },             // bottom-right
  ];

  // Step 2: Add PNG watermark from settings (rotating corners)
  let useImageWatermark = false;
  let wmLocalPath = null;

  if (wmConfig.type === 'image' && wmConfig.imageUrl) {
    wmLocalPath = join(TMP_DIR, `watermark_${Date.now()}.png`);
    useImageWatermark = await downloadWatermarkPng(wmConfig.imageUrl, wmLocalPath);
  }

  // Build inputs: video first, then optional PNG
  const inputs = ['-fflags', '+genpts+discardcorrupt', '-y', '-i', videoPath];
  if (useImageWatermark) inputs.push('-i', wmLocalPath);

  // Build filter_complex with crop→blur→overlay for each corner
  const filterParts = [];
  let currentLabel = '0:v';

  for (let i = 0; i < cornerDefs.length; i++) {
    const c = cornerDefs[i];
    const inLabel = i === 0 ? `[${currentLabel}]` : `[v${i}]`;
    const outLabel = `[v${i + 1}]`;
    // split → crop corner → heavy boxblur → overlay back at same position
    // boxblur: luma_radius must be < min(w,h)/2, chroma_radius < min(w,h)/4 (due to YUV420)
    const lumaR = Math.min(bs, Math.floor(Math.min(bw, bh) / 2) - 1);
    const chromaR = Math.min(bs, Math.floor(Math.min(bw, bh) / 4) - 1);
    filterParts.push(
      `${inLabel}split[main${i}][copy${i}]`,
      `[copy${i}]crop=${bw}:${bh}:${c.x}:${c.y},boxblur=${lumaR}:5:${chromaR}:5[blur${i}]`,
      `[main${i}][blur${i}]overlay=${c.x}:${c.y}${outLabel}`
    );
    currentLabel = `v${i + 1}`;
  }

  // After 4 corners blurred, currentLabel = v4
  const blurredLabel = `[${currentLabel}]`;

  if (useImageWatermark) {
    const m = wmConfig.margin;
    const wmScale = wmConfig.scale;
    const wmOpacity = wmConfig.opacity;

    let overlayExpr;
    if (wmConfig.movement === 'rotating_corners') {
      overlayExpr = [
        `overlay=`,
        `x='if(lt(mod(t\\,240)\\,60)\\,W-w-${m}\\,if(lt(mod(t\\,240)\\,120)\\,W-w-${m}\\,if(lt(mod(t\\,240)\\,180)\\,${m}\\,${m})))'`,
        `:y='if(lt(mod(t\\,240)\\,60)\\,${m}\\,if(lt(mod(t\\,240)\\,120)\\,H-h-${m}\\,if(lt(mod(t\\,240)\\,180)\\,H-h-${m}\\,${m})))'`,
      ].join('');
    } else {
      overlayExpr = `overlay=x=W-w-${m}:y=H-h-${m}`;
    }

    // PNG watermark scaling
    const wmInputIdx = 1;
    filterParts.push(
      `[${wmInputIdx}:v]scale=iw*${wmScale}:-1,format=rgba,colorchannelmixer=aa=${wmOpacity}[wm]`,
      `${blurredLabel}[wm]${overlayExpr}[final]`
    );
    logger.info(`  Applying: boxblur corners + PNG watermark (${wmConfig.movement}, opacity=${wmOpacity})`);
  } else {
    const fontSize = Math.round(24 * scale);
    const margin = Math.round(20 * scale);
    const drawtext = `drawtext=text='celeb.skin':fontsize=${fontSize}:fontcolor=white@0.5:x=w-tw-${margin}:y=h-th-${margin}:shadowcolor=black@0.3:shadowx=1:shadowy=1`;
    filterParts.push(
      `${blurredLabel}${drawtext}[final]`
    );
    logger.info('  Applying: boxblur corners + text watermark (PNG not available)');
  }

  const filterStr = filterParts.join(';');

  const ffmpegArgs = [
    ...inputs,
    '-filter_complex', filterStr,
    '-map', '[final]',
    '-map', '0:a?',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-sar', '1:1',
    '-preset', 'medium', '-crf', '22',
    '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
    '-bf', '2', '-threads', '0',
    '-c:a', 'copy',
    '-max_muxing_queue_size', '4096',
    '-movflags', '+faststart',
    outputPath,
  ];

  // Run FFmpeg
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 1800000, // 30 min
    });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-500)}`));
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
           rv.extra_data, rv.source_url
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
const wmConfig = await getWatermarkConfig();
logger.info(`Limit: ${limit}, watermark: ${wmConfig.type} (${wmConfig.movement})`);

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
      // Get fresh video URL with auth token (source URLs expire)
      let downloadUrl = video.video_url;
      if (video.source_url) {
        logger.info('  Fetching fresh video URL from source page...');
        const freshUrl = await getFreshVideoUrl(video.source_url);
        if (freshUrl) {
          downloadUrl = freshUrl;
          logger.info('  Got fresh tokenized URL');
        }
      }
      logger.info('  Downloading video...');
      setActiveItem(videoId, { label: videoTitle, subStep: 'Downloading', pct: 10 });
      const ok = await downloadVideo(downloadUrl, inputPath);
      if (!ok) throw new Error('Download failed');
    } else {
      logger.info('  Using cached source video');
    }

    const inputStat = await stat(inputPath);
    logger.info(`  Source: ${(inputStat.size / 1024 / 1024).toFixed(1)}MB`);

    // 2. Process: blur 4 corners + PNG watermark
    setActiveItem(videoId, { label: videoTitle, subStep: 'Watermarking', pct: 30 });
    await processVideo(inputPath, outputPath, wmConfig);

    const outputStat = await stat(outputPath);
    logger.info(`  ✓ Processed (${(inputStat.size / 1024 / 1024).toFixed(1)}MB → ${(outputStat.size / 1024 / 1024).toFixed(1)}MB)`);

    // 3. Update DB — save local path (upload-to-cdn.js will replace with CDN URL)
    await query(
      `UPDATE videos SET
        video_url_watermarked = $2,
        status = 'watermarked',
        updated_at = NOW()
      WHERE id = $1`,
      [videoId, `tmp/${videoId}/watermarked.mp4`]
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
