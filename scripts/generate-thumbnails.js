#!/usr/bin/env node
/**
 * generate-thumbnails.js — CelebSkin Thumbnail, Sprite & Preview GIF Generator
 *
 * For each video in DB (status = 'watermarked' or 'enriched'):
 *   - Downloads video to tmp/
 *   - Extracts 8 screenshots (thumb_001.jpg ... thumb_008.jpg)
 *   - Creates sprite sheet (sprite.jpg) for hover preview
 *   - Creates 4-second preview GIF (preview.gif)
 *   - Stores paths in DB (screenshots, sprite_data, preview_gif_url)
 *
 * Requirements: FFmpeg installed and in PATH
 *
 * Usage:
 *   node generate-thumbnails.js                    # process all pending
 *   node generate-thumbnails.js --limit=20         # limit to 20 videos
 *   node generate-thumbnails.js --force            # regenerate existing
 *   node generate-thumbnails.js --thumbs=6         # 6 screenshots instead of 8
 *   node generate-thumbnails.js --width=320        # frame width (default 320)
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, rm, readdir, access } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { config } from './lib/config.js';
import { query } from './lib/db.js';
import logger from './lib/logger.js'; dbLog } from './lib/db.js';
import logger from './lib/logger.js';
import { writeProgress, completeStep, setActiveItem, removeActiveItem } from './lib/progress.js';
import { withRetry } from './lib/retry.js';
import { recordFailure } from './lib/dead-letter.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = config.pipeline.tmpDir;

export const DEFAULTS = {
    thumbCount: 20,
    thumbWidth: 1280,
    gifDuration: 4,
    gifFps: 8,
    gifWidth: 480,
    limit: 50,
    force: false,
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

async function getVideoResolution(videoPath) {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'quiet',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height',
            '-of', 'csv=p=0',
            videoPath,
        ], { timeout: 15000 });
        const [width, height] = stdout.trim().split(',').map(Number);
        return { width, height };
    } catch {
        return { width: 1920, height: 1080 };
    }
}

async function extractFrame(videoPath, timestamp, outputPath, width) {
    await execFileAsync('ffmpeg', [
        '-ss', String(timestamp),
        '-i', videoPath,
        '-vframes', '1',
        '-vf', `scale=${width}:-2`,
        '-q:v', '2',
        '-y',
        outputPath,
    ], { timeout: 30000 });
}

async function createSpriteSheet(framePaths, outputPath) {
    const inputs = [];
    const filterParts = [];

    for (let i = 0; i < framePaths.length; i++) {
        inputs.push('-i', framePaths[i]);
        filterParts.push(`[${i}:v]`);
    }

    const filter = `${filterParts.join('')}hstack=inputs=${framePaths.length}`;

    await execFileAsync('ffmpeg', [
        ...inputs,
        '-filter_complex', filter,
        '-q:v', '3',
        '-y',
        outputPath,
    ], { timeout: 60000 });
}

async function createPreviewGif(videoPath, outputPath, config) {
    const duration = await getVideoDuration(videoPath);
    if (duration < 3) return false;

    // Start from 15% into the video for more interesting content
    const startTime = Math.max(1, duration * 0.15);
    const gifDuration = Math.min(config.gifDuration, duration - startTime);

    await execFileAsync('ffmpeg', [
        '-ss', String(startTime),
        '-i', videoPath,
        '-t', String(gifDuration),
        '-vf', `fps=${config.gifFps},scale=${config.gifWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
        '-loop', '0',
        '-y',
        outputPath,
    ], { timeout: 120000 });

    return true;
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
// Process Single Video
// ============================================

export async function processVideo(video, config) {
    const videoId = video.id;
    const videoUrl = video.video_url_watermarked || video.video_url;
    const vTitle = video.display_title || videoId;

    if (!videoUrl) {
        return { status: 'skip', reason: 'no_video_url' };
    }

    // Skip if already has screenshots (unless force)
    if (!config.force && video.screenshots && video.screenshots.length > 0) {
        return { status: 'skip', reason: 'already_done' };
    }

    // Create work directory
    const workDir = join(TMP_DIR, videoId);
    await mkdir(workDir, { recursive: true });

    try {
        // Get video: use local file if available, otherwise download
        let videoPath;
        const isLocalPath = !videoUrl.startsWith("http://") && !videoUrl.startsWith("https://");
        if (isLocalPath) {
            const localPath = join(__dirname, videoUrl);
            try {
                await access(localPath);
                videoPath = localPath;
                logger.info(`  Using local file: ${videoUrl}`);
            } catch {
                // Local file missing — try fallback to video_url or video_url_watermarked (CDN)
                const fallbackUrl = video.video_url_watermarked || video.video_url;
                if (fallbackUrl && (fallbackUrl.startsWith('http://') || fallbackUrl.startsWith('https://'))) {
                    logger.warn(`  Local file not found: ${localPath}, falling back to download: ${fallbackUrl.substring(0, 80)}`);
                    videoPath = join(workDir, 'video.mp4');
                    setActiveItem(videoId, { label: vTitle, subStep: 'Downloading (fallback)', pct: 0 });
                    const downloaded = await downloadVideo(fallbackUrl, videoPath);
                    if (!downloaded) {
                        removeActiveItem(videoId);
                        return { status: 'error', reason: 'fallback_download_failed' };
                    }
                } else {
                    logger.error(`  Local file not found and no HTTP fallback: ${localPath}`);
                    removeActiveItem(videoId);
                    return { status: 'error', reason: 'local_file_not_found' };
                }
            }
        } else {
            videoPath = join(workDir, 'video.mp4');
            logger.info(`  Downloading video...`);
            setActiveItem(videoId, { label: vTitle, subStep: 'Downloading', pct: 0 });
            const downloaded = await downloadVideo(videoUrl, videoPath);
            if (!downloaded) {
                removeActiveItem(videoId);
                return { status: 'error', reason: 'download_failed' };
            }
        }

        // Get video info
        const duration = await getVideoDuration(videoPath);
        if (duration < 2) {
            return { status: 'skip', reason: 'too_short' };
        }

        const resolution = await getVideoResolution(videoPath);
        logger.info(`  Duration: ${duration.toFixed(1)}s, Resolution: ${resolution.width}x${resolution.height}`);

        // Format duration
        const durationFormatted = formatDuration(duration);

        // Update DB with actual duration (scraped duration is often the full movie length)
        try {
            await query(
                `UPDATE videos SET duration_seconds = $2, duration_formatted = $3 WHERE id = $1`,
                [videoId, Math.round(duration), durationFormatted]
            );
            logger.info(`  Updated DB duration to actual: ${durationFormatted} (${Math.round(duration)}s)`);
        } catch (err) {
            logger.warn(`  Failed to update DB duration: ${err.message}`);
        }

        setActiveItem(videoId, { label: vTitle, subStep: 'Extracting frames', pct: 10 });
        // Extract frames at evenly spaced intervals
        const thumbCount = config.thumbCount;
        const width = config.thumbWidth;
        const timestamps = [];
        const framePaths = [];
        const screenshotFiles = [];

        for (let i = 0; i < thumbCount; i++) {
            const percent = (i + 1) / (thumbCount + 1);
            const ts = Math.max(0.5, duration * percent);
            timestamps.push(ts);
        }

        for (let i = 0; i < timestamps.length; i++) {
            const fileName = `thumb_${String(i + 1).padStart(3, '0')}.jpg`;
            const framePath = join(workDir, fileName);
            try {
                await withRetry(() => extractFrame(videoPath, timestamps[i], framePath, width), {
                    maxRetries: 2, delayMs: 3000, label: `extractFrame:${videoId}:${i + 1}`,
                });
                framePaths.push(framePath);
                screenshotFiles.push(fileName);
            } catch (err) {
                logger.warn(`  Frame ${i + 1} extraction failed: ${err.message}`);
            }
        }

        if (framePaths.length < 2) {
            removeActiveItem(videoId);
            return { status: 'error', reason: 'not_enough_frames' };
        }

        logger.info(`  ${framePaths.length} screenshots extracted`);
        setActiveItem(videoId, { label: vTitle, subStep: 'Creating sprite', pct: 50 });

        // Create sprite sheet
        const spritePath = join(workDir, 'sprite.jpg');
        try {
            await withRetry(() => createSpriteSheet(framePaths, spritePath), {
                maxRetries: 2, delayMs: 3000, label: `spriteSheet:${videoId}`,
            });
            logger.info(`  Sprite sheet created`);
        } catch (err) {
            logger.warn(`  Sprite creation failed: ${err.message}`);
        }

        // Create preview GIF
        setActiveItem(videoId, { label: vTitle, subStep: 'Creating GIF', pct: 75 });
        const gifPath = join(workDir, 'preview.gif');
        let hasGif = false;
        try {
            hasGif = await createPreviewGif(videoPath, gifPath, config);
            if (hasGif) logger.info(`  Preview GIF created`);
        } catch (err) {
            logger.warn(`  GIF creation failed: ${err.message}`);
        }

        // Get frame height for sprite data
        let frameHeight;
        try {
            const { stdout } = await execFileAsync('ffprobe', [
                '-v', 'quiet',
                '-select_streams', 'v:0',
                '-show_entries', 'stream=height',
                '-of', 'csv=p=0',
                framePaths[0],
            ], { timeout: 10000 });
            frameHeight = parseInt(stdout.trim()) || Math.round(width * 9 / 16);
        } catch {
            frameHeight = Math.round(width * 9 / 16);
        }

        // Build sprite_data JSON
        const spriteData = {
            frames: framePaths.length,
            frameWidth: width,
            frameHeight,
            timestamps: timestamps.slice(0, framePaths.length),
            duration,
        };

        // Determine quality from resolution
        const quality = resolution.height >= 1080 ? '1080p'
            : resolution.height >= 720 ? '720p'
                : resolution.height >= 480 ? '480p'
                    : '360p';

        setActiveItem(videoId, { label: vTitle, subStep: 'Saving to DB', pct: 95 });
        // Update DB — store local paths (will be updated to CDN URLs by upload-to-cdn.js)
        // Screenshots stored as relative paths in work dir
        const screenshotPaths = screenshotFiles.map(f => `tmp/${videoId}/${f}`);

        await query(
            `UPDATE videos SET
                screenshots = $2::jsonb,
                sprite_data = $3::jsonb,
                thumbnail_url = $4,
                duration_seconds = COALESCE(duration_seconds, $5),
                duration_formatted = COALESCE(duration_formatted, $6),
                quality = COALESCE(quality, $7),
                updated_at = NOW()
            WHERE id = $1`,
            [
                videoId,
                JSON.stringify(screenshotPaths),
                JSON.stringify(spriteData),
                `tmp/${videoId}/${screenshotFiles[0]}`, // first frame as thumbnail
                Math.round(duration),
                durationFormatted,
                quality,
            ]
        );

        // Store working dir path in processing_log for later CDN upload
        await query(
            `INSERT INTO processing_log (video_id, step, status, metadata)
             VALUES ($1, 'thumbnails', 'completed', $2::jsonb)
             `,
            [
                videoId,
                JSON.stringify({
                    workDir,
                    screenshotFiles,
                    hasSprite: true,
                    hasGif,
                    frameCount: framePaths.length,
                    duration,
                    quality,
                }),
            ]
        );

        removeActiveItem(videoId);
        return {
            status: 'ok',
            frames: framePaths.length,
            hasGif,
            workDir,
        };
    } catch (err) {
        removeActiveItem(videoId);
        await dbLog(videoId, 'thumbnails', 'error', `Thumbnail generation failed: ${err.message}`);
        await recordFailure(videoId, 'thumbnails', err, 3);
        return { status: 'error', reason: err.message };
    }
    // NOTE: Don't clean up workDir yet — upload-to-cdn.js needs the files
}

// ============================================
// Helpers
// ============================================

function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
        return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ============================================
// Main
// ============================================

async function main() {
    const config = { ...DEFAULTS, ...parseArgs() };

    logger.info('='.repeat(60));
    logger.info('CelebSkin — Thumbnail & Sprite Generator');
    logger.info('='.repeat(60));
    logger.info(`Frames: ${config.thumbCount}, Width: ${config.thumbWidth}px, GIF: ${config.gifDuration}s`);

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

    // Get videos that need thumbnails
    // STRICT: Only process watermarked videos (completed watermark step)
    const statusFilter = config.force
        ? `status IN ('watermarked', 'needs_review', 'published')`
        : `status = 'watermarked' AND (screenshots IS NULL OR screenshots = '[]'::jsonb)`;

    const { rows: videos } = await query(
        `SELECT v.id, v.video_url, v.video_url_watermarked, v.screenshots, v.duration_seconds,
                COALESCE(v.title->>'en', v.id::text) as display_title
         FROM videos v
         WHERE ${statusFilter} AND (v.video_url IS NOT NULL OR v.video_url_watermarked IS NOT NULL)
         ORDER BY v.created_at DESC
         LIMIT $1`,
        [config.limit]
    );

    logger.info(`Found ${videos.length} videos to process`);

    const CONCURRENCY = 2;
    const startedAt = Date.now();
    let processed = 0;
    let generated = 0;
    let skipped = 0;
    let errors = 0;
    const _completed = [];
    const _errors = [];

    for (let i = 0; i < videos.length; i += CONCURRENCY) {
        const batch = videos.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (video) => {
            const num = ++processed;
            logger.info(`\n[${num}/${videos.length}] Video: ${video.id}`);
            const _start = Date.now();
            const vTitle = video.display_title || video.id;
            writeProgress({
                step: 'thumbnails', stepLabel: 'Thumbnail Generation',
                videosTotal: videos.length, videosDone: num - 1,
                currentVideo: { id: video.id, title: vTitle, subStep: 'Generating thumbnails + sprites' },
                completedVideos: _completed.slice(-10),
                errors: _errors.slice(-10),
                elapsedMs: Date.now() - startedAt,
            });

            const result = await processVideo(video, config);

            switch (result.status) {
                case 'ok':
                    generated++;
                    _completed.push({ id: video.id, title: vTitle, status: 'ok', ms: Date.now() - _start });
                    logger.info(`  ✓ ${result.frames} frames${result.hasGif ? ' + GIF' : ''}`);
                    break;
                case 'skip':
                    skipped++;
                    logger.info(`  - Skipped: ${result.reason}`);
                    break;
                case 'error':
                    errors++;
                    _errors.push({ id: video.id, title: vTitle, error: result.reason });
                    logger.error(`  ✗ Error: ${result.reason}`);
                    break;
            }
        }));
    }

    logger.info('\n' + '='.repeat(60));
    completeStep({
        videosDone: generated + skipped,
        videosTotal: videos.length,
        elapsedMs: Date.now() - startedAt,
        completedVideos: _completed.slice(-20),
        errors: _errors.slice(-20),
    });
    logger.info('THUMBNAIL GENERATION SUMMARY');
    logger.info(`Processed: ${processed}`);
    logger.info(`Generated: ${generated}`);
    logger.info(`Skipped: ${skipped}`);
    logger.info(`Errors: ${errors}`);
}

function parseArgs() {
    const args = {};
    for (const arg of process.argv.slice(2)) {
        if (arg === '--force') args.force = true;
        if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1]);
        if (arg.startsWith('--thumbs=')) args.thumbCount = parseInt(arg.split('=')[1]);
        if (arg.startsWith('--width=')) args.thumbWidth = parseInt(arg.split('=')[1]);
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
