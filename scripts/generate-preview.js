#!/usr/bin/env node
/**
 * generate-preview.js — CelebSkin Hover Preview Clip Generator
 *
 * For each watermarked video without a preview_url:
 *   - Downloads watermarked video (or uses local file)
 *   - Extracts a 6-second clip from ~40% into the video
 *   - No audio, 480px wide, small file (~200-500KB)
 *   - Uploads to BunnyCDN: videos/{videoId}/preview.mp4
 *   - Updates DB: preview_url = CDN URL
 *
 * Requirements: FFmpeg installed and in PATH
 *
 * Usage:
 *   node generate-preview.js                    # process all pending
 *   node generate-preview.js --limit=20         # limit to 20 videos
 *   node generate-preview.js --force            # regenerate existing
 *   node generate-preview.js --video-id=UUID    # process specific video
 *   node generate-preview.js --duration=8       # clip duration (default 6)
 *   node generate-preview.js --width=480        # output width (default 480)
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, stat, rm, access } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { config } from './lib/config.js';
import { query, log as dbLog } from './lib/db.js';
import logger from './lib/logger.js';
import { writeProgress, completeStep, setActiveItem, removeActiveItem } from './lib/progress.js';
import { withRetry } from './lib/retry.js';
import { recordFailure } from './lib/dead-letter.js';
import { uploadFile, getVideoPath } from './lib/bunny.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = config.pipeline.tmpDir;

const DEFAULTS = {
    clipDuration: 6,
    clipWidth: 480,
    crf: 28,
    startPercent: 0.4,     // Start clip at 40% of video duration
    limit: 50,
    force: false,
    videoId: null,
};

// ============================================
// FFmpeg Utilities
// ============================================

async function getVideoDuration(videoPath) {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'quiet',
            '-show_entries', 'format=duration',
            '-of', 'csv=p=0',
            videoPath,
        ], { timeout: 15000 });
        return parseFloat(stdout.trim());
    } catch {
        return 0;
    }
}

async function generatePreviewClip(inputPath, outputPath, opts) {
    const duration = await getVideoDuration(inputPath);
    if (duration < 3) {
        throw new Error(`Video too short (${duration.toFixed(1)}s) for preview`);
    }

    // Start at opts.startPercent of video duration, clamp to avoid going past the end
    const maxStart = Math.max(0, duration - opts.clipDuration - 1);
    const startTime = Math.min(duration * opts.startPercent, maxStart);
    const clipDuration = Math.min(opts.clipDuration, duration - startTime);

    await execFileAsync('ffmpeg', [
        '-ss', String(Math.max(0, startTime).toFixed(2)),
        '-i', inputPath,
        '-t', String(clipDuration),
        '-vf', `scale=${opts.clipWidth}:-2`,
        '-an',                          // No audio
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', String(opts.crf),
        '-movflags', '+faststart',      // Web-optimized
        '-y',
        outputPath,
    ], { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }); // 2 min timeout, 10MB stderr buffer

    return { duration: clipDuration, startTime };
}

// ============================================
// Download Video
// ============================================

async function downloadVideo(url, destPath) {
    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream',
            timeout: 300000, // 5 min
            headers: { 'User-Agent': 'CelebSkin-Pipeline/1.0' },
        });
        await pipeline(response.data, createWriteStream(destPath));
        return true;
    } catch (err) {
        logger.error(`  Download failed: ${err.message}`);
        return false;
    }
}

// ============================================
// Process Single Video
// ============================================

async function processVideo(video, opts) {
    const videoId = video.id;
    const videoUrl = video.video_url_watermarked || video.video_url;
    const vTitle = video.display_title || videoId;

    if (!videoUrl) {
        return { status: 'skip', reason: 'no_video_url' };
    }

    // Skip if already has preview (unless force)
    if (!opts.force && video.preview_url) {
        return { status: 'skip', reason: 'already_done' };
    }

    // Create work directory
    const workDir = join(TMP_DIR, `preview_${videoId}`);
    await mkdir(workDir, { recursive: true });

    try {
        // Get video: use local file if available, otherwise download
        let videoPath;
        const isLocalPath = !videoUrl.startsWith('http://') && !videoUrl.startsWith('https://');

        if (isLocalPath) {
            const localPath = join(__dirname, videoUrl);
            try {
                await access(localPath);
                videoPath = localPath;
                logger.info(`  Using local file: ${videoUrl}`);
            } catch {
                logger.error(`  Local file not found: ${localPath}`);
                removeActiveItem(videoId);
                return { status: 'error', reason: 'local_file_not_found' };
            }
        } else {
            videoPath = join(workDir, 'source.mp4');
            logger.info(`  Downloading video...`);
            setActiveItem(videoId, { label: vTitle, subStep: 'Downloading', pct: 0 });
            const downloaded = await downloadVideo(videoUrl, videoPath);
            if (!downloaded) {
                removeActiveItem(videoId);
                return { status: 'error', reason: 'download_failed' };
            }
        }

        // Generate preview clip
        setActiveItem(videoId, { label: vTitle, subStep: 'Generating preview clip', pct: 30 });
        const previewPath = join(workDir, 'preview.mp4');

        const clipInfo = await withRetry(
            () => generatePreviewClip(videoPath, previewPath, opts),
            { maxRetries: 2, delayMs: 3000, label: `preview-clip:${videoId}` }
        );

        // Check file size
        const fileInfo = await stat(previewPath);
        const fileSizeKB = Math.round(fileInfo.size / 1024);
        logger.info(`  Preview clip: ${clipInfo.duration.toFixed(1)}s, ${fileSizeKB}KB (from ${clipInfo.startTime.toFixed(1)}s)`);

        // Upload to BunnyCDN
        setActiveItem(videoId, { label: vTitle, subStep: 'Uploading to CDN', pct: 70 });
        const remotePath = `${getVideoPath(videoId)}/preview.mp4`;
        const cdnUrl = await uploadFile(previewPath, remotePath, {
            videoId,
            step: 'preview-generate',
            maxRetries: 3,
            delayMs: 3000,
            timeout: 60000,  // Preview clips are small, 1 min is enough
        });

        // Update DB
        setActiveItem(videoId, { label: vTitle, subStep: 'Saving to DB', pct: 95 });
        await query(
            `UPDATE videos SET preview_url = $2, updated_at = NOW() WHERE id = $1`,
            [videoId, cdnUrl]
        );

        // Log processing step
        await query(
            `INSERT INTO processing_log (video_id, step, status, metadata)
             VALUES ($1, 'preview-generate', 'completed', $2::jsonb)`,
            [
                videoId,
                JSON.stringify({
                    clipDuration: clipInfo.duration,
                    startTime: clipInfo.startTime,
                    fileSizeKB,
                    width: opts.clipWidth,
                    crf: opts.crf,
                    cdnUrl,
                }),
            ]
        );

        removeActiveItem(videoId);

        // Cleanup work directory
        try { await rm(workDir, { recursive: true }); } catch {}

        return {
            status: 'ok',
            fileSizeKB,
            clipDuration: clipInfo.duration,
            cdnUrl,
        };
    } catch (err) {
        removeActiveItem(videoId);
        await dbLog(videoId, 'preview-generate', 'error', `Preview generation failed: ${err.message}`).catch(() => {});
        await recordFailure(videoId, 'preview-generate', err, 3).catch(() => {});

        // Cleanup work directory
        try { await rm(workDir, { recursive: true }); } catch {}

        return { status: 'error', reason: err.message };
    }
}

// ============================================
// Main
// ============================================

async function main() {
    const opts = { ...DEFAULTS, ...parseArgs() };

    logger.info('='.repeat(60));
    logger.info('CelebSkin — Hover Preview Clip Generator');
    logger.info('='.repeat(60));
    logger.info(`Duration: ${opts.clipDuration}s, Width: ${opts.clipWidth}px, CRF: ${opts.crf}, Start: ${(opts.startPercent * 100).toFixed(0)}%`);

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

    // Get videos that need preview clips
    let videos;

    if (opts.videoId) {
        // Process specific video
        const { rows } = await query(
            `SELECT id, video_url, video_url_watermarked, preview_url, duration_seconds,
                    COALESCE(title->>'en', id::text) as display_title
             FROM videos WHERE id = $1`,
            [opts.videoId]
        );
        videos = rows;
        if (videos.length === 0) {
            logger.error(`Video not found: ${opts.videoId}`);
            process.exit(1);
        }
    } else {
        // Batch mode: watermarked videos with CDN video URL but no preview
        const statusFilter = opts.force
            ? `status IN ('watermarked', 'published')`
            : `status IN ('watermarked', 'published') AND preview_url IS NULL`;

        const { rows } = await query(
            `SELECT id, video_url, video_url_watermarked, preview_url, duration_seconds,
                    COALESCE(title->>'en', id::text) as display_title
             FROM videos
             WHERE ${statusFilter}
               AND video_url_watermarked IS NOT NULL
               AND video_url_watermarked LIKE '%b-cdn.net%'
             ORDER BY created_at DESC
             LIMIT $1`,
            [opts.limit]
        );
        videos = rows;
    }

    logger.info(`Found ${videos.length} videos to process`);

    if (videos.length === 0) {
        logger.info('Nothing to do.');
        completeStep({ videosDone: 0, videosTotal: 0, elapsedMs: 0 });
        return;
    }

    const CONCURRENCY = 2;
    const startedAt = Date.now();
    let processed = 0;
    let generated = 0;
    let skipped = 0;
    let errors = 0;
    let totalSizeKB = 0;
    const _completed = [];
    const _errors = [];

    for (let i = 0; i < videos.length; i += CONCURRENCY) {
        const batch = videos.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (video) => {
            const num = ++processed;
            logger.info(`\n[${num}/${videos.length}] Video: ${video.display_title || video.id}`);
            const _start = Date.now();

            writeProgress({
                step: 'preview-generate', stepLabel: 'Preview Clip Generation',
                videosTotal: videos.length, videosDone: num - 1,
                currentVideo: { id: video.id, title: video.display_title || video.id, subStep: 'Generating preview' },
                completedVideos: _completed.slice(-10),
                errors: _errors.slice(-10),
                elapsedMs: Date.now() - startedAt,
            });

            const result = await processVideo(video, opts);

            switch (result.status) {
                case 'ok':
                    generated++;
                    totalSizeKB += result.fileSizeKB;
                    _completed.push({ id: video.id, title: video.display_title, status: 'ok', ms: Date.now() - _start });
                    logger.info(`  ✓ Preview: ${result.clipDuration.toFixed(1)}s, ${result.fileSizeKB}KB`);
                    break;
                case 'skip':
                    skipped++;
                    logger.info(`  - Skipped: ${result.reason}`);
                    break;
                case 'error':
                    errors++;
                    _errors.push({ id: video.id, title: video.display_title, error: result.reason });
                    logger.error(`  ✗ Error: ${result.reason}`);
                    break;
            }
        }));
    }

    logger.info('\n' + '='.repeat(60));
    completeStep({
        videosDone: generated,
        videosTotal: videos.length,
        elapsedMs: Date.now() - startedAt,
        completedVideos: _completed.slice(-20),
        errors: _errors.slice(-20),
        errorCount: errors,
    });
    logger.info('PREVIEW GENERATION SUMMARY');
    logger.info(`Processed: ${processed}`);
    logger.info(`Generated: ${generated}`);
    logger.info(`Skipped: ${skipped}`);
    logger.info(`Errors: ${errors}`);
    if (totalSizeKB > 0) {
        logger.info(`Total size: ${(totalSizeKB / 1024).toFixed(1)}MB (avg: ${Math.round(totalSizeKB / generated)}KB/clip)`);
    }
    if (errors > 0) {
        logger.error(`⚠️  ${errors} video(s) failed:`);
        for (const e of _errors) {
            logger.error(`  - ${e.id}: ${e.error}`);
        }
    }
}

function parseArgs() {
    const args = {};
    for (const arg of process.argv.slice(2)) {
        if (arg === '--force') args.force = true;
        if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1]);
        if (arg.startsWith('--duration=')) args.clipDuration = parseInt(arg.split('=')[1]);
        if (arg.startsWith('--width=')) args.clipWidth = parseInt(arg.split('=')[1]);
        if (arg.startsWith('--crf=')) args.crf = parseInt(arg.split('=')[1]);
        if (arg.startsWith('--video-id=')) args.videoId = arg.split('=')[1];
    }
    return args;
}

const _isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (_isMain) {
    main().catch(err => {
        logger.error('Fatal error:', err);
        process.exit(1);
    });
}
