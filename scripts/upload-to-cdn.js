#!/usr/bin/env node
/**
 * upload-to-cdn.js — CelebSkin BunnyCDN Upload
 *
 * Uploads generated media files to BunnyCDN Storage:
 *   - Watermarked video → /videos/{video_id}/watermarked.mp4
 *   - Screenshots → /videos/{video_id}/thumb_001.jpg ...
 *   - Sprite sheet → /videos/{video_id}/sprite.jpg
 *   - Preview GIF → /videos/{video_id}/preview.gif
 *   - Celebrity photos → /celebrities/{slug}/photo.jpg
 *   - Movie posters → /movies/{slug}/poster.jpg
 *
 * Updates DB with CDN URLs after upload.
 *
 * Usage:
 *   node upload-to-cdn.js                    # upload all pending
 *   node upload-to-cdn.js --limit=20         # limit to 20 items
 *   node upload-to-cdn.js --force            # re-upload existing
 *   node upload-to-cdn.js --videos-only      # only upload video media
 *   node upload-to-cdn.js --cleanup          # delete local files after upload
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rm, stat, access } from 'fs/promises';
import axios from 'axios';
import { config } from './lib/config.js';
import { query, log as dbLog } from './lib/db.js';
import logger from './lib/logger.js';
import { writeProgress, completeStep, setActiveItem, removeActiveItem } from './lib/progress.js';
import { uploadFile, uploadBuffer, getVideoPath, getCelebrityPath, getMoviePath, isCdnUrl } from './lib/bunny.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = config.pipeline.tmpDir;

async function fileExists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

// ============================================
// Upload Video Media
// ============================================

export async function uploadVideoMedia(video, force = false, cleanup = false) {
    const videoId = video.id;
    const workDir = join(TMP_DIR, videoId);

    // Special case: published video with CDN watermark but non-CDN video_url
    // Just update video_url to the existing CDN watermarked URL
    if (video.status === 'published'
        && video.video_url_watermarked
        && isCdnUrl(video.video_url_watermarked)
        && video.video_url
        && !isCdnUrl(video.video_url)) {
        logger.info(`  Fixing video_url → CDN watermarked URL`);
        await query(
            `UPDATE videos SET video_url = $2, updated_at = NOW() WHERE id = $1`,
            [videoId, video.video_url_watermarked]
        );
        return { status: 'ok', uploadCount: 0, urls: { video_url: video.video_url_watermarked }, fixOnly: true };
    }

    // Check if workDir exists — handle missing work dir gracefully
    if (!await fileExists(workDir)) {
        // If watermarked video is already on CDN, don't reset — just skip
        if (video.video_url_watermarked && isCdnUrl(video.video_url_watermarked)) {
            logger.info(`  [${videoId}] Work dir missing but CDN watermark exists — skipping (already uploaded)`);
            return { status: 'skip', reason: 'work_dir_missing_but_cdn_exists' };
        }
        // Only reset to enriched if we truly need to re-watermark
        logger.warn(`  [${videoId}] Work dir missing and no CDN watermark — resetting to enriched for re-watermark`);
        await query(
            `UPDATE videos SET status = 'enriched', video_url_watermarked = NULL, updated_at = NOW() WHERE id = $1`,
            [videoId]
        );
        return { status: 'reset', reason: 'no_work_dir — reset to enriched for re-processing' };
    }

    const vTitle = video.display_title || videoId;
    const uploadedUrls = {};
    let uploadCount = 0;

    // 1. Upload watermarked video
    setActiveItem(videoId, { label: vTitle, subStep: 'Uploading video', pct: 0 });
    const watermarkedPath = join(workDir, 'watermarked.mp4');
    if (await fileExists(watermarkedPath)) {
        try {
            logger.info(`  Uploading watermarked video...`);
            const fileInfo = await stat(watermarkedPath);
            logger.info(`    Size: ${(fileInfo.size / 1024 / 1024).toFixed(1)}MB`);
            const cdnUrl = await uploadFile(watermarkedPath, `${getVideoPath(videoId)}/watermarked.mp4`, {
                videoId, step: 'cdn-upload-video',
            });
            uploadedUrls.video_url_watermarked = cdnUrl;
            uploadCount++;
            logger.info(`    → ${cdnUrl}`);
        } catch (err) {
            logger.error(`    Upload failed: ${err.message}`);
        }
    }

    // 2. Upload original video (if exists and no watermarked yet)
    const originalPath = join(workDir, 'original.mp4');
    if (await fileExists(originalPath) && !uploadedUrls.video_url_watermarked) {
        try {
            logger.info(`  Uploading original video...`);
            const cdnUrl = await uploadFile(originalPath, `${getVideoPath(videoId)}/original.mp4`, {
                videoId, step: 'cdn-upload-original',
            });
            uploadedUrls.video_url = cdnUrl;
            uploadCount++;
        } catch (err) {
            logger.error(`    Upload failed: ${err.message}`);
        }
    }

    // 3. Upload screenshots
    setActiveItem(videoId, { label: vTitle, subStep: 'Uploading screenshots', pct: 50 });
    const screenshotUrls = [];
    for (let i = 1; i <= 20; i++) {
        const thumbName = `thumb_${String(i).padStart(3, '0')}.jpg`;
        const thumbPath = join(workDir, thumbName);
        if (await fileExists(thumbPath)) {
            try {
                const cdnUrl = await uploadFile(thumbPath, `${getVideoPath(videoId)}/${thumbName}`);
                screenshotUrls.push(cdnUrl);
                uploadCount++;
            } catch (err) {
                logger.warn(`    Thumb upload failed: ${err.message}`);
            }
        }
    }
    if (screenshotUrls.length > 0) {
        uploadedUrls.screenshots = screenshotUrls;
        uploadedUrls.thumbnail_url = screenshotUrls[0]; // First frame as thumbnail
        logger.info(`  ${screenshotUrls.length} screenshots uploaded`);
    }

    // 4. Upload sprite
    setActiveItem(videoId, { label: vTitle, subStep: 'Uploading sprite + GIF', pct: 80 });
    const spritePath = join(workDir, 'sprite.jpg');
    if (await fileExists(spritePath)) {
        try {
            const cdnUrl = await uploadFile(spritePath, `${getVideoPath(videoId)}/sprite.jpg`);
            uploadedUrls.sprite_url = cdnUrl;
            uploadCount++;
            logger.info(`  Sprite uploaded`);
        } catch (err) {
            logger.warn(`    Sprite upload failed: ${err.message}`);
        }
    }

    // 5. Upload preview GIF
    const gifPath = join(workDir, 'preview.gif');
    if (await fileExists(gifPath)) {
        try {
            const cdnUrl = await uploadFile(gifPath, `${getVideoPath(videoId)}/preview.gif`);
            uploadedUrls.preview_gif_url = cdnUrl;
            uploadCount++;
            logger.info(`  Preview GIF uploaded`);
        } catch (err) {
            logger.warn(`    GIF upload failed: ${err.message}`);
        }
    }

    if (uploadCount === 0) {
        removeActiveItem(videoId);
        await dbLog(videoId, 'cdn_upload', 'skipped', 'No files to upload');
        return { status: 'skip', reason: 'no_files_to_upload' };
    }

    setActiveItem(videoId, { label: vTitle, subStep: 'Saving to DB', pct: 95 });
    // Update DB with CDN URLs
    const updates = [];
    const values = [videoId];
    let paramIdx = 2;

    if (uploadedUrls.video_url_watermarked) {
        updates.push(`video_url_watermarked = $${paramIdx++}`);
        values.push(uploadedUrls.video_url_watermarked);
        // CRITICAL: Also update video_url to CDN watermarked version
        // so frontend plays from CDN, not from expiring source URLs
        updates.push(`video_url = $${paramIdx++}`);
        values.push(uploadedUrls.video_url_watermarked);
    }
    if (uploadedUrls.video_url && !uploadedUrls.video_url_watermarked) {
        updates.push(`video_url = $${paramIdx++}`);
        values.push(uploadedUrls.video_url);
    }
    if (uploadedUrls.thumbnail_url) {
        updates.push(`thumbnail_url = $${paramIdx++}`);
        values.push(uploadedUrls.thumbnail_url);
    }
    if (uploadedUrls.screenshots) {
        updates.push(`screenshots = $${paramIdx++}::jsonb`);
        values.push(JSON.stringify(uploadedUrls.screenshots));
    }
    if (uploadedUrls.sprite_url) {
        updates.push(`sprite_url = $${paramIdx++}`);
        values.push(uploadedUrls.sprite_url);
    }
    if (uploadedUrls.preview_gif_url) {
        updates.push(`preview_gif_url = $${paramIdx++}`);
        values.push(uploadedUrls.preview_gif_url);
    }

    updates.push(`enrichment_layers_used = array_append(COALESCE(enrichment_layers_used, '{}'), 'cdn')`);
    updates.push(`updated_at = NOW()`);

    await query(
        `UPDATE videos SET ${updates.join(', ')} WHERE id = $1`,
        values
    );

    // Log
    await query(
        `INSERT INTO processing_log (video_id, step, status, metadata)
         VALUES ($1, 'cdn_upload', 'completed', $2::jsonb)
         `,
        [videoId, JSON.stringify({ uploadCount, urls: uploadedUrls })]
    );

    // Cleanup local files if requested
    if (cleanup) {
        try {
            await rm(workDir, { recursive: true, force: true });
            logger.info(`  Cleaned up ${workDir}`);
        } catch (err) {
            logger.warn(`  Cleanup failed: ${err.message}`);
        }
    }

    removeActiveItem(videoId);
    return { status: 'ok', uploadCount, urls: uploadedUrls };
}

// ============================================
// Upload Celebrity Photos
// ============================================

async function uploadCelebrityPhotos(force = false, limit = 50) {
    logger.info('\n--- Uploading Celebrity Photos to CDN ---');

    // Find celebrities with TMDB photo URLs that need CDN upload
    const photoQuery = force
        ? `SELECT c.id, c.name, c.slug, c.photo_url FROM celebrities c WHERE c.photo_url LIKE '%tmdb.org%' LIMIT $1`
        : `SELECT c.id, c.name, c.slug, c.photo_url FROM celebrities c WHERE c.photo_url LIKE '%tmdb.org%' AND c.photo_local IS NULL LIMIT $1`;

    const { rows: celebrities } = await query(photoQuery, [limit]);
    logger.info(`Found ${celebrities.length} celebrity photos to upload`);

    let uploaded = 0;
    for (const celeb of celebrities) {
        try {
            // Download from TMDB
            const response = await axios.get(celeb.photo_url, {
                responseType: 'arraybuffer',
                timeout: 30000,
            });

            // Upload to BunnyCDN
            const remotePath = `${getCelebrityPath(celeb.slug)}/photo.jpg`;
            const cdnUrl = await uploadBuffer(response.data, remotePath, 'image/jpeg');

            // Update DB
            await query(
                `UPDATE celebrities SET photo_local = $2 WHERE id = $1`,
                [celeb.id, cdnUrl]
            );

            uploaded++;
            logger.info(`  [${uploaded}] ${celeb.name} → ${cdnUrl}`);
            await dbLog(null, 'cdn_upload_photo', 'completed', `Celebrity photo uploaded: ${celeb.name}`, {
                celebrity_id: celeb.id, cdn_url: cdnUrl,
            });
        } catch (err) {
            logger.warn(`  Failed for ${celeb.name}: ${err.message}`);
            await dbLog(null, 'cdn_upload_photo', 'error', `Celebrity photo upload failed: ${celeb.name}: ${err.message}`, {
                celebrity_id: celeb.id, photo_url: celeb.photo_url,
            });
        }
    }

    // Also upload celebrity_photos
    const { rows: extraPhotos } = await query(
        `SELECT cp.id, cp.photo_url, cp.celebrity_id, c.slug
         FROM celebrity_photos cp
         JOIN celebrities c ON c.id = cp.celebrity_id
         WHERE cp.photo_url LIKE '%tmdb.org%' AND cp.photo_local IS NULL
         LIMIT $1`,
        [limit]
    );

    for (const photo of extraPhotos) {
        try {
            const response = await axios.get(photo.photo_url, {
                responseType: 'arraybuffer',
                timeout: 30000,
            });

            const remotePath = `${getCelebrityPath(photo.slug)}/photo_${photo.id}.jpg`;
            const cdnUrl = await uploadBuffer(response.data, remotePath, 'image/jpeg');

            await query(
                `UPDATE celebrity_photos SET photo_local = $2 WHERE id = $1`,
                [photo.id, cdnUrl]
            );
            uploaded++;
        } catch (err) {
            logger.warn(`  Extra photo ${photo.id} failed: ${err.message}`);
        }
    }

    return uploaded;
}

// ============================================
// Upload Movie Posters
// ============================================

async function uploadMoviePosters(force = false, limit = 50) {
    logger.info('\n--- Uploading Movie Posters to CDN ---');

    const posterQuery = force
        ? `SELECT id, title, slug, poster_url FROM movies WHERE poster_url LIKE '%tmdb.org%' LIMIT $1`
        : `SELECT id, title, slug, poster_url FROM movies WHERE poster_url LIKE '%tmdb.org%' AND poster_local IS NULL LIMIT $1`;

    const { rows: movies } = await query(posterQuery, [limit]);
    logger.info(`Found ${movies.length} movie posters to upload`);

    let uploaded = 0;
    for (const movie of movies) {
        try {
            const response = await axios.get(movie.poster_url, {
                responseType: 'arraybuffer',
                timeout: 30000,
            });

            const remotePath = `${getMoviePath(movie.slug)}/poster.jpg`;
            const cdnUrl = await uploadBuffer(response.data, remotePath, 'image/jpeg');

            await query(
                `UPDATE movies SET poster_local = $2 WHERE id = $1`,
                [movie.id, cdnUrl]
            );

            uploaded++;
            logger.info(`  [${uploaded}] ${movie.title} → ${cdnUrl}`);
            await dbLog(null, 'cdn_upload_poster', 'completed', `Movie poster uploaded: ${movie.title}`, {
                movie_id: movie.id, cdn_url: cdnUrl,
            });
        } catch (err) {
            logger.warn(`  Failed for ${movie.title}: ${err.message}`);
            await dbLog(null, 'cdn_upload_poster', 'error', `Movie poster upload failed: ${movie.title}: ${err.message}`, {
                movie_id: movie.id, poster_url: movie.poster_url,
            });
        }
    }

    return uploaded;
}

// ============================================
// Main
// ============================================

async function main() {
    if (!config.bunny.storageKey) {
        logger.error('BUNNY_STORAGE_KEY not set. Add it to .env');
        process.exit(1);
    }

    const args = parseArgs();
    const limit = args.limit || 50;

    logger.info('='.repeat(60));
    logger.info('CelebSkin — BunnyCDN Upload');
    logger.info('='.repeat(60));
    logger.info(`Storage Zone: ${config.bunny.storageZone}`);
    logger.info(`CDN URL: ${config.bunny.cdnUrl}`);

    const CONCURRENCY = 3;
    const startedAt = Date.now();
    let videoUploads = 0;
    let photoUploads = 0;
    let posterUploads = 0;
    const _completed = [];
    const _errors = [];

    // Upload video media
    if (!args.photosOnly) {
        logger.info('\n--- Uploading Video Media ---');

        // Get videos with local files OR non-CDN URLs that need uploading
        // Includes: videos with tmp/ paths, AND published videos still pointing to source URLs
        const { rows: videos } = await query(
            `SELECT v.id, v.video_url, v.video_url_watermarked, v.status,
                    COALESCE(v.title->>'en', v.id::text) as display_title
             FROM videos v
             WHERE (
                -- Videos with local tmp paths (normal pipeline flow)
                v.video_url_watermarked LIKE 'tmp/%'
                OR v.thumbnail_url LIKE 'tmp/%'
                -- Videos where screenshots array has tmp/ paths (thumbnails generated but not yet on CDN)
                OR (v.screenshots IS NOT NULL AND v.screenshots::text LIKE '%tmp/%'
                    AND (v.sprite_url IS NULL OR v.sprite_url NOT LIKE '%b-cdn%'))
                -- Published videos that still have non-CDN video URLs (missed by earlier pipeline runs)
                OR (v.status = 'published' AND v.video_url IS NOT NULL
                    AND v.video_url NOT LIKE '%b-cdn.net%'
                    AND v.video_url_watermarked IS NOT NULL
                    AND v.video_url_watermarked LIKE '%b-cdn.net%')
             )
             AND v.status IN ('watermarked', 'published', 'needs_review')
             ORDER BY v.created_at ASC
             LIMIT $1`,
            [limit]
        );

        logger.info(`Found ${videos.length} videos with local files`);

        for (let i = 0; i < videos.length; i += CONCURRENCY) {
            const batch = videos.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (video) => {
                const _start = Date.now();
                const vTitle = video.display_title || video.id;
                writeProgress({
                    step: 'cdn-upload', stepLabel: 'CDN Upload',
                    videosTotal: videos.length, videosDone: videoUploads,
                    currentVideo: { id: video.id, title: vTitle, subStep: 'Uploading to BunnyCDN' },
                    completedVideos: _completed.slice(-10),
                    errors: _errors.slice(-10),
                    elapsedMs: Date.now() - startedAt,
                });
                logger.info(`\n[${videoUploads + 1}/${videos.length}] Video: ${video.id}`);
                const result = await uploadVideoMedia(video, args.force, args.cleanup);

                if (result.status === 'ok') {
                    videoUploads++;
                    _completed.push({ id: video.id, title: vTitle, status: 'ok', ms: Date.now() - _start });
                    logger.info(`  ✓ ${result.uploadCount} files uploaded`);
                } else {
                    logger.info(`  - ${result.reason}`);
                    _errors.push({ id: video.id, title: vTitle, error: result.reason || 'skipped' });
                }
            }));
        }
    }

    // Upload celebrity photos
    if (!args.videosOnly) {
        photoUploads = await uploadCelebrityPhotos(args.force, limit);
    }

    // Upload movie posters
    if (!args.videosOnly) {
        posterUploads = await uploadMoviePosters(args.force, limit);
    }

    // Summary
    logger.info('\n' + '='.repeat(60));
    completeStep({
        videosDone: videoUploads + photoUploads + posterUploads,
        videosTotal: videoUploads + photoUploads + posterUploads,
        elapsedMs: Date.now() - startedAt,
        completedVideos: _completed.slice(-20),
        errors: _errors.slice(-20),
    });
    logger.info('CDN UPLOAD SUMMARY');
    logger.info(`Video media uploads: ${videoUploads}`);
    logger.info(`Celebrity photos: ${photoUploads}`);
    logger.info(`Movie posters: ${posterUploads}`);
}

function parseArgs() {
    const args = { limit: null, force: false, cleanup: false, videosOnly: false, photosOnly: false };
    for (const arg of process.argv.slice(2)) {
        if (arg === '--force') args.force = true;
        if (arg === '--cleanup') args.cleanup = true;
        if (arg === '--videos-only') args.videosOnly = true;
        if (arg === '--photos-only') args.photosOnly = true;
        if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1]);
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
