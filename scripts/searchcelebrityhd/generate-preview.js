#!/usr/bin/env node
/**
 * generate-preview.js — Generate GIF preview + preview clip for searchcelebrityhd videos
 *
 * From watermarked video on CDN:
 *   1. Download watermarked video
 *   2. Generate 4s preview GIF (480px, 8fps, palette optimized)
 *   3. Generate 6s preview clip (480px MP4, no audio)
 *   4. Upload GIF + clip to BunnyCDN
 *   5. Update DB: preview_gif_url, preview_url
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, stat, access, rm } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { query } from '../lib/db.js';
import { uploadFile, getVideoPath } from '../lib/bunny.js';
import logger from '../lib/logger.js';
import { config } from '../lib/config.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = config.pipeline.tmpDir;

const DEFAULTS = {
  gifDuration: 4,
  gifFps: 8,
  gifWidth: 480,
  clipDuration: 6,
  clipWidth: 480,
  clipCrf: 28,
  startPercent: 0.4,
  limit: 20,
};

const args = process.argv.slice(2);
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || String(DEFAULTS.limit));

logger.info('=== SearchCelebrityHD Preview Generation ===');

// Get published/watermarked videos without preview
const { rows: videos } = await query(`
  SELECT v.id, v.video_url, v.preview_gif_url, v.preview_url,
         COALESCE(v.title->>'en', v.id::text) as title_en,
         v.duration_seconds
  FROM videos v
  JOIN raw_videos rv ON rv.id = v.raw_video_id
  WHERE v.video_url LIKE '%b-cdn.net%'
    AND (v.preview_gif_url IS NULL OR v.preview_gif_url = '')
    AND rv.extra_data->>'source' = 'searchcelebrityhd'
  ORDER BY v.created_at ASC
  LIMIT $1
`, [limit]);

logger.info(`Found ${videos.length} videos needing previews`);

async function getVideoDuration(videoPath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', videoPath,
  ]);
  return parseFloat(stdout.trim()) || 0;
}

let processed = 0, errors = 0;

for (const video of videos) {
  const workDir = join(TMP_DIR, video.id);
  await mkdir(workDir, { recursive: true });

  logger.info(`\n[${processed + errors + 1}/${videos.length}] ${video.title_en}`);

  try {
    // 1. Download watermarked video from CDN (or use cached)
    const videoPath = join(workDir, 'watermarked.mp4');
    let needsDownload = true;
    try {
      await access(videoPath);
      const s = await stat(videoPath);
      if (s.size > 1024) needsDownload = false;
    } catch {}

    if (needsDownload) {
      logger.info('  Downloading from CDN...');
      const resp = await axios({ method: 'get', url: video.video_url, responseType: 'stream', timeout: 300000 });
      await pipeline(resp.data, createWriteStream(videoPath));
    } else {
      logger.info('  Using cached watermarked video');
    }

    const duration = await getVideoDuration(videoPath);
    if (duration < 3) {
      logger.warn('  Video too short, skipping');
      continue;
    }

    const videoPathCdn = getVideoPath(video.id);
    const startTime = Math.max(1, duration * DEFAULTS.startPercent);

    // 2. Generate preview GIF (4s, 480px, 8fps, palette optimized)
    const gifPath = join(workDir, 'preview.gif');
    const gifDuration = Math.min(DEFAULTS.gifDuration, duration - startTime);
    logger.info(`  Generating GIF (${gifDuration}s from ${startTime.toFixed(0)}s)...`);

    await execFileAsync('ffmpeg', [
      '-ss', String(startTime),
      '-i', videoPath,
      '-t', String(gifDuration),
      '-vf', `fps=${DEFAULTS.gifFps},scale=${DEFAULTS.gifWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
      '-loop', '0',
      '-y', gifPath,
    ], { timeout: 120000 });

    const gifStat = await stat(gifPath);
    logger.info(`  GIF: ${(gifStat.size / 1024).toFixed(0)}KB`);

    // Upload GIF to CDN
    const gifUrl = await uploadFile(gifPath, `${videoPathCdn}/preview.gif`);
    logger.info(`  GIF → ${gifUrl}`);

    // 3. Generate preview clip (6s MP4, no audio, 480px)
    const clipPath = join(workDir, 'preview.mp4');
    const clipDuration = Math.min(DEFAULTS.clipDuration, duration - startTime);
    logger.info(`  Generating preview clip (${clipDuration}s)...`);

    await execFileAsync('ffmpeg', [
      '-ss', String(startTime),
      '-i', videoPath,
      '-t', String(clipDuration),
      '-vf', `scale=${DEFAULTS.clipWidth}:-2`,
      '-an',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(DEFAULTS.clipCrf),
      '-movflags', '+faststart',
      '-y', clipPath,
    ], { timeout: 120000 });

    const clipStat = await stat(clipPath);
    logger.info(`  Clip: ${(clipStat.size / 1024).toFixed(0)}KB`);

    // Upload clip to CDN
    const clipUrl = await uploadFile(clipPath, `${videoPathCdn}/preview.mp4`);
    logger.info(`  Clip → ${clipUrl}`);

    // 4. Update DB
    await query(
      `UPDATE videos SET preview_gif_url = $2, preview_url = $3, updated_at = NOW() WHERE id = $1`,
      [video.id, gifUrl, clipUrl]
    );

    logger.info('  ✓ Done');
    processed++;

    // Cleanup preview files
    try { await rm(gifPath); } catch {}
    try { await rm(clipPath); } catch {}
  } catch (err) {
    logger.error(`  ✗ ${video.title_en}: ${err.message}`);
    errors++;
  }
}

logger.info(`\n=== Preview: ${processed} generated, ${errors} errors ===`);
