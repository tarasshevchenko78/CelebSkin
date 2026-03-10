#!/usr/bin/env node
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

async function addWatermark(inputPath, outputPath, config) {
    // Position calculation for drawtext
    let x, y;
    switch (config.position) {
        case 'bottom-right':
            x = `w-tw-${config.margin}`;
            y = `h-th-${config.margin}`;
            break;
        case 'bottom-left':
            x = String(config.margin);
            y = `h-th-${config.margin}`;
            break;
        case 'top-right':
            x = `w-tw-${config.margin}`;
            y = String(config.margin);
            break;
        case 'top-left':
            x = String(config.margin);
            y = String(config.margin);
            break;
        default:
            x = `w-tw-${config.margin}`;
            y = `h-th-${config.margin}`;
    }

    // Build FFmpeg drawtext filter
    // Using alpha channel for opacity
    const alpha = config.opacity;
    const textFilter = [
        `drawtext=text='${WATERMARK_TEXT}'`,
        `fontsize=${config.fontSize}`,
        `fontcolor=${config.fontColor}@${alpha}`,
        `x=${x}`,
        `y=${y}`,
        `shadowcolor=black@${alpha * 0.7}`,
        `shadowx=1`,
        `shadowy=1`,
    ].join(':');

    await execFileAsync('ffmpeg', [
        '-i', inputPath,
        '-vf', textFilter,
        '-codec:a', 'copy',        // Copy audio without re-encoding
        '-c:v', 'libx264',         // H.264 video encoding
        '-preset', 'fast',         // Fast encoding (good for pipeline)
        '-crf', '23',              // Quality (18=high, 23=medium, 28=low)
        '-movflags', '+faststart', // Web-optimized MP4
        '-y',
        outputPath,
    ], { timeout: 600000 }); // 10 min timeout

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

        await withRetry(() => addWatermark(inputPath, outputPath, config), {
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

async function main() {
    const config = { ...DEFAULTS, ...parseArgs() };

    logger.info('='.repeat(60));
    logger.info('CelebSkin — Video Watermarking');
    logger.info('='.repeat(60));
    logger.info(`Text: "${WATERMARK_TEXT}", Opacity: ${config.opacity}, Position: ${config.position}`);

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
        ? `status IN ('new', 'enriched', 'auto_recognized', 'needs_review', 'watermarked')`
        : `status IN ('enriched', 'auto_recognized') AND video_url_watermarked IS NULL`;

    const { rows: videos } = await query(
        `SELECT id, video_url, video_url_watermarked, status,
                COALESCE(title->>'en', id::text) as display_title
         FROM videos
         WHERE ${statusFilter} AND video_url IS NOT NULL
         ORDER BY created_at ASC
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
                logger.info(`  ✓ Watermarked (${(result.originalSize/1024/1024).toFixed(1)}MB → ${(result.watermarkedSize/1024/1024).toFixed(1)}MB)`);
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
        logger.info(`Total: ${(totalOriginalSize/1024/1024).toFixed(1)}MB → ${(totalWatermarkedSize/1024/1024).toFixed(1)}MB`);
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
