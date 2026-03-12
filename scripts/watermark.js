#!/usr/bin/env node
import { spawn } from 'child_process';
/**
 * watermark.js — CelebSkin Video Watermarking
 *
 * Adds celeb.skin watermark to videos:
 *   - Text overlay: "celeb.skin" at bottom-right, 30% opacity
 *   - Processes videos from raw_videos with status 'processed'
 *   - Creates watermarked version → stores URL in videos table
 *   - Updates video status to 'watermarked'
 *
 * Requirements: FFmpeg installed and in PATH
 *
 * Usage:
 *   node watermark.js                    # process all pending
 *   node watermark.js --limit=10         # limit to 10 videos
 *   node watermark.js --force            # re-watermark existing
 *   node watermark.js --opacity=0.3      # watermark opacity (0.0-1.0)
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, stat } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { config } from './lib/config.js';
import { query } from './lib/db.js';
import logger from './lib/logger.js';
import { writeProgress, completeStep, setActiveItem, removeActiveItem } from './lib/progress.js';
import { withRetry } from './lib/retry.js';
import { recordFailure } from './lib/dead-letter.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = config.pipeline.tmpDir;

const WATERMARK_TEXT = 'celeb.skin';
const DEFAULTS = {
    opacity: 0.3,
    fontSize: 24,
    fontColor: 'white',
    position: 'bottom-right',  // bottom-right, bottom-left, top-right, top-left
    margin: 20,
    limit: 20,
    force: false,
    watermarkType: 'text',     // 'text' or 'image'
    watermarkImageUrl: '',     // CDN URL to PNG watermark
    watermarkScale: 0.1,       // Size relative to video width
    watermarkMovement: 'rotating_corners', // Position pattern
};

// ============================================
// Download Video
// ============================================

async function downloadVideo(url, destPath) {
    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream',
            timeout: 600000, // 10 min for large videos
            headers: {
                'User-Agent': 'CelebSkin-Pipeline/1.0',
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
// Watermark Video
// ============================================

/**
 * Download watermark PNG from CDN to local temp file.
 */
async function downloadWatermarkPng(url, destPath) {
    try {
        const response = await axios({
            method: 'get',
            url,
            responseType: 'stream',
            timeout: 30000,
        });
        await pipeline(response.data, createWriteStream(destPath));
        return true;
    } catch (err) {
        logger.error(`  Failed to download watermark PNG: ${err.message}`);
        return false;
    }
}

/**
 * Build FFmpeg filter for IMAGE watermark with position switching.
 * Switches corner every 60 seconds: top-right → bottom-right → bottom-left → top-left
 * Uses discrete position jumps (not smooth animation).
 *
 * @param {number} margin - Margin from edges in pixels
 * @param {number} opacity - Watermark opacity (0.0-1.0)
 * @param {number} scale - Scale relative to video width (0.05-0.20)
 * @param {string} movement - 'static' or 'rotating_corners'
 */
function buildImageOverlayFilter(margin, opacity, scale, movement) {
    // Scale watermark to a fraction of video width, then set opacity
    const scaleFilter = `[1:v]scale=iw*${scale}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm]`;

    let overlayExpr;
    if (movement === 'static') {
        // Static: bottom-right corner
        overlayExpr = `overlay=x=W-w-${margin}:y=H-h-${margin}`;
    } else {
        // rotating_corners: switch corner every 60 seconds
        // Phase 0 (0-59s): top-right, Phase 1 (60-119s): bottom-right, Phase 2: bottom-left, Phase 3: top-left
        const m = margin;
        overlayExpr = [
            `overlay=`,
            `x='if(lt(mod(t\\,240)\\,60)\\,W-w-${m}\\,if(lt(mod(t\\,240)\\,120)\\,W-w-${m}\\,if(lt(mod(t\\,240)\\,180)\\,${m}\\,${m})))'`,
            `:y='if(lt(mod(t\\,240)\\,60)\\,${m}\\,if(lt(mod(t\\,240)\\,120)\\,H-h-${m}\\,if(lt(mod(t\\,240)\\,180)\\,H-h-${m}\\,${m})))'`,
        ].join('');
    }

    return `${scaleFilter};[0:v][wm]${overlayExpr}`;
}

/**
 * Build FFmpeg drawtext filter for TEXT watermark with position switching.
 */
function buildTextFilter(config) {
    const alpha = config.opacity;
    const m = config.margin;

    if (config.watermarkMovement === 'static') {
        // Static position
        let x, y;
        switch (config.position) {
            case 'bottom-left': x = String(m); y = `h-th-${m}`; break;
            case 'top-right': x = `w-tw-${m}`; y = String(m); break;
            case 'top-left': x = String(m); y = String(m); break;
            default: x = `w-tw-${m}`; y = `h-th-${m}`;
        }
        return [
            `drawtext=text='${WATERMARK_TEXT}'`,
            `fontsize=${config.fontSize}`,
            `fontcolor=${config.fontColor}@${alpha}`,
            `x=${x}`, `y=${y}`,
            `shadowcolor=black@${alpha * 0.7}`, `shadowx=1`, `shadowy=1`,
        ].join(':');
    }

    // rotating_corners: switch corner every 60 seconds
    const xExpr = `'if(lt(mod(t\\,240)\\,60)\\,w-tw-${m}\\,if(lt(mod(t\\,240)\\,120)\\,w-tw-${m}\\,if(lt(mod(t\\,240)\\,180)\\,${m}\\,${m})))'`;
    const yExpr = `'if(lt(mod(t\\,240)\\,60)\\,${m}\\,if(lt(mod(t\\,240)\\,120)\\,h-th-${m}\\,if(lt(mod(t\\,240)\\,180)\\,h-th-${m}\\,${m})))'`;

    return [
        `drawtext=text='${WATERMARK_TEXT}'`,
        `fontsize=${config.fontSize}`,
        `fontcolor=${config.fontColor}@${alpha}`,
        `x=${xExpr}`, `y=${yExpr}`,
        `shadowcolor=black@${alpha * 0.7}`, `shadowx=1`, `shadowy=1`,
    ].join(':');
}

async function addWatermark(inputPath, outputPath, config, onProgress) {
    // Get video duration for progress calculation
    let durationSec = 0;
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'quiet', '-show_entries', 'format=duration',
            '-of', 'csv=p=0', inputPath,
        ], { timeout: 30000 });
        durationSec = parseFloat(stdout.trim()) || 0;
    } catch { /* ignore */ }

    function runFFmpeg(ffmpegArgs) {
        return new Promise((resolve, reject) => {
            const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';

            proc.stdout.on('data', (chunk) => {
                const lines = chunk.toString().split('\n');
                for (const line of lines) {
                    // FFmpeg -progress outputs: out_time_us=12345678
                    const match = line.match(/out_time_us=(\d+)/);
                    if (match && durationSec > 0 && onProgress) {
                        const currentSec = parseInt(match[1]) / 1000000;
                        const pct = Math.min(99, Math.round((currentSec / durationSec) * 100));
                        onProgress(pct);
                    }
                }
            });

            proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-500)}`));
            });

            // Timeout
            const timer = setTimeout(() => {
                proc.kill('SIGKILL');
                reject(new Error('FFmpeg timeout (30min)'));
            }, 1800000);
            proc.on('close', () => clearTimeout(timer));
        });
    }

    if (config.watermarkType === 'image' && config.watermarkImageUrl) {
        const wmPath = join(TMP_DIR, `watermark_${Date.now()}.png`);
        const downloaded = await downloadWatermarkPng(config.watermarkImageUrl, wmPath);
        if (!downloaded) {
            logger.warn('  Image watermark download failed, falling back to text watermark');
        } else {
            const filterComplex = buildImageOverlayFilter(
                config.margin, config.opacity, config.watermarkScale, config.watermarkMovement
            );

            await runFFmpeg([
                '-i', inputPath, '-i', wmPath,
                '-filter_complex', filterComplex,
                '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-preset', 'veryfast', '-crf', '20',
                '-g', '48', '-bf', '2', '-threads', '0',
                '-movflags', '+faststart',
                '-progress', 'pipe:1',
                '-y', outputPath,
            ]);

            return true;
        }
    }

    const textFilter = buildTextFilter(config);

    await runFFmpeg([
        '-i', inputPath, '-vf', textFilter,
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-preset', 'veryfast', '-crf', '20',
        '-g', '48', '-bf', '2', '-threads', '0',
        '-movflags', '+faststart',
        '-progress', 'pipe:1',
        '-y', outputPath,
    ]);

    return true;
}

// ============================================
// Process Single Video
// ============================================

async function processVideo(video, config) {
    const videoId = video.id;
    const videoUrl = video.video_url;

    if (!videoUrl) {
        return { status: 'skip', reason: 'no_video_url' };
    }

    // Skip if already watermarked (unless force)
    if (!config.force && video.video_url_watermarked) {
        return { status: 'skip', reason: 'already_watermarked' };
    }

    // Create work directory
    const workDir = join(TMP_DIR, videoId);
    await mkdir(workDir, { recursive: true });

    try {
        // Download original video
        const inputPath = join(workDir, 'original.mp4');
        logger.info(`  Downloading video...`);
        setActiveItem(videoId, { label: video.display_title || videoId, subStep: 'Downloading', pct: 0 });

        const downloaded = await downloadVideo(videoUrl, inputPath);
        if (!downloaded) {
            removeActiveItem(videoId);
            return { status: 'error', reason: 'download_failed' };
        }

        // Get file size
        const fileInfo = await stat(inputPath);
        logger.info(`  Original: ${(fileInfo.size / 1024 / 1024).toFixed(1)}MB`);
        setActiveItem(videoId, { label: video.display_title || videoId, subStep: 'Watermarking', pct: 40 });

        // Apply watermark
        const outputPath = join(workDir, 'watermarked.mp4');
        logger.info(`  Applying watermark "${WATERMARK_TEXT}" (opacity: ${config.opacity})...`);

        const onProgress = (pct) => {
            // Map FFmpeg 0-100 → UI 40-95 range (0-40 = download, 95-100 = save)
            const uiPct = 40 + Math.round(pct * 0.55);
            setActiveItem(videoId, { label: video.display_title || videoId, subStep: `Encoding ${pct}%`, pct: uiPct });
        };
        await withRetry(() => addWatermark(inputPath, outputPath, config, onProgress), {
            maxRetries: 2, delayMs: 5000, label: `watermark:${videoId}`,
        });

        // Get output file size
        const outInfo = await stat(outputPath);
        logger.info(`  Watermarked: ${(outInfo.size / 1024 / 1024).toFixed(1)}MB`);
        setActiveItem(videoId, { label: video.display_title || videoId, subStep: 'Saving to DB', pct: 95 });

        // Update DB — store local path (will be updated by upload-to-cdn.js)
        const watermarkedLocalPath = `tmp/${videoId}/watermarked.mp4`;
        await query(
            `UPDATE videos SET
                video_url_watermarked = $2,
                status = 'watermarked',
                updated_at = NOW()
            WHERE id = $1`,
            [videoId, watermarkedLocalPath]
        );

        // Log processing step
        await query(
            `INSERT INTO processing_log (video_id, step, status, metadata)
             VALUES ($1, 'watermark', 'completed', $2::jsonb)
             `,
            [
                videoId,
                JSON.stringify({
                    workDir,
                    originalSize: fileInfo.size,
                    watermarkedSize: outInfo.size,
                    opacity: config.opacity,
                    position: config.position,
                }),
            ]
        );

        removeActiveItem(videoId);
        return {
            status: 'ok',
            originalSize: fileInfo.size,
            watermarkedSize: outInfo.size,
            workDir,
        };
    } catch (err) {
        removeActiveItem(videoId);
        // Update status to failed
        await query(
            `INSERT INTO processing_log (video_id, step, status, metadata)
             VALUES ($1, 'watermark', 'failed', $2::jsonb)
             `,
            [videoId, JSON.stringify({ error: err.message })]
        );
        await recordFailure(videoId, 'watermark', err, 3);
        return { status: 'error', reason: err.message };
    }
}

// ============================================
// Main
// ============================================

async function loadWatermarkSettings() {
    try {
        const { rows } = await query(
            `SELECT key, value FROM settings WHERE key LIKE 'watermark_%'`
        );
        const dbSettings = {};
        for (const row of rows) {
            dbSettings[row.key] = row.value;
        }
        return {
            watermarkType: dbSettings.watermark_type || 'text',
            watermarkImageUrl: dbSettings.watermark_image_url || '',
            watermarkScale: parseFloat(dbSettings.watermark_scale) || 0.1,
            opacity: parseFloat(dbSettings.watermark_opacity) || 0.3,
            watermarkMovement: dbSettings.watermark_movement || 'rotating_corners',
        };
    } catch (err) {
        logger.warn(`Could not load watermark settings from DB: ${err.message}. Using defaults.`);
        return {};
    }
}

async function main() {
    const dbSettings = await loadWatermarkSettings();
    const config = { ...DEFAULTS, ...dbSettings, ...parseArgs() };

    logger.info('='.repeat(60));
    logger.info('CelebSkin — Video Watermarking');
    logger.info('='.repeat(60));
    logger.info(`Type: ${config.watermarkType}, Opacity: ${config.opacity}, Movement: ${config.watermarkMovement}`);
    if (config.watermarkType === 'image' && config.watermarkImageUrl) {
        logger.info(`Image URL: ${config.watermarkImageUrl}`);
    } else {
        logger.info(`Text: "${WATERMARK_TEXT}", Position: ${config.position}`);
    }

    // Check FFmpeg
    try {
        await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
        logger.info('FFmpeg: OK');
    } catch {
        logger.error('FFmpeg not found! Install with: apt install ffmpeg');
        process.exit(1);
    }

    // Ensure tmp directory
    await mkdir(TMP_DIR, { recursive: true });

    // Get videos that need watermarking
    // Videos go through: new → enriched/auto_recognized → watermarked → thumbnails → CDN → published
    const statusFilter = config.force
        ? `v.status IN ('new', 'enriched', 'auto_recognized', 'needs_review', 'watermarked')`
        : `v.status IN ('enriched', 'auto_recognized') AND v.video_url_watermarked IS NULL`;

    const { rows: videos } = await query(
        `SELECT v.id, COALESCE(v.video_url, rv.video_file_url) as video_url,
                v.video_url_watermarked, v.status,
                COALESCE(v.title->>'en', v.id::text) as display_title
         FROM videos v
         LEFT JOIN raw_videos rv ON rv.id = v.raw_video_id
         WHERE ${statusFilter}
           AND (v.video_url IS NOT NULL OR rv.video_file_url IS NOT NULL)
         ORDER BY v.created_at ASC
         LIMIT $1`,
        [config.limit]
    );

    logger.info(`Found ${videos.length} videos to watermark`);

    const CONCURRENCY = 2;
    const startedAt = Date.now();
    let processed = 0;
    let watermarked = 0;
    let skipped = 0;
    let errors = 0;
    let totalOriginalSize = 0;
    let totalWatermarkedSize = 0;
    const _completed = [];
    const _errors = [];

    for (let i = 0; i < videos.length; i += CONCURRENCY) {
        const batch = videos.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (video) => {
            const num = ++processed;
            logger.info(`\n[${num}/${videos.length}] Video: ${video.id}`);
            const _start = Date.now();
            writeProgress({
                step: 'watermark', stepLabel: 'Video Watermarking',
                videosTotal: videos.length, videosDone: num - 1,
                currentVideo: { id: video.id, title: video.id, subStep: 'Downloading + Watermarking' },
                completedVideos: _completed.slice(-10),
                errors: _errors.slice(-10),
                elapsedMs: Date.now() - startedAt,
            });

            const result = await processVideo(video, config);

            switch (result.status) {
                case 'ok':
                    watermarked++;
                    _completed.push({ id: video.id, title: video.id, status: 'ok', ms: Date.now() - _start });
                    totalOriginalSize += result.originalSize;
                    totalWatermarkedSize += result.watermarkedSize;
                    logger.info(`  ✓ Watermarked (${(result.originalSize / 1024 / 1024).toFixed(1)}MB → ${(result.watermarkedSize / 1024 / 1024).toFixed(1)}MB)`);
                    break;
                case 'skip':
                    skipped++;
                    logger.info(`  - Skipped: ${result.reason}`);
                    break;
                case 'error':
                    errors++;
                    _errors.push({ id: video.id, title: video.id, error: result.reason });
                    logger.error(`  ✗ Error: ${result.reason}`);
                    break;
            }
        }));
    }

    logger.info('\n' + '='.repeat(60));
    const elapsedMs = Date.now() - startedAt;
    completeStep({
        videosDone: watermarked,
        videosTotal: processed,
        elapsedMs,
        completedVideos: _completed.slice(-20),
        errors: _errors.slice(-20),
        errorCount: errors,
    });
    logger.info('WATERMARK SUMMARY');
    logger.info(`Processed: ${processed}`);
    logger.info(`Watermarked: ${watermarked}`);
    logger.info(`Skipped: ${skipped}`);
    logger.info(`Errors: ${errors}`);
    if (errors > 0) {
        logger.error(`⚠️  ${errors} video(s) failed watermarking:`);
        for (const e of _errors) {
            logger.error(`  - ${e.id}: ${e.error}`);
        }
    }
    if (totalOriginalSize > 0) {
        logger.info(`Total: ${(totalOriginalSize / 1024 / 1024).toFixed(1)}MB → ${(totalWatermarkedSize / 1024 / 1024).toFixed(1)}MB`);
    }
}

function parseArgs() {
    const args = {};
    for (const arg of process.argv.slice(2)) {
        if (arg === '--force') args.force = true;
        if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1]);
        if (arg.startsWith('--opacity=')) args.opacity = parseFloat(arg.split('=')[1]);
        if (arg.startsWith('--position=')) args.position = arg.split('=')[1];
    }
    return args;
}

main().catch(err => {
    logger.error('Fatal error:', err);
    process.exit(1);
});
