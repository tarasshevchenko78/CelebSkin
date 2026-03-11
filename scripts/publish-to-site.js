#!/usr/bin/env node
/**
 * publish-to-site.js — CelebSkin Video Publishing
 *
 * Publishes approved/enriched videos to the site:
 *   - Sets status = 'published' + published_at = NOW()
 *   - Generates slugs for all 10 languages
 *   - Updates video/celebrity/tag/category counts
 *   - Generates scene entries in movie_scenes table
 *
 * Usage:
 *   node publish-to-site.js                    # publish all ready videos
 *   node publish-to-site.js --limit=10         # limit to 10 videos
 *   node publish-to-site.js --dry-run          # preview without changes
 *   node publish-to-site.js --auto             # auto-publish high confidence (>=0.8)
 */

import { fileURLToPath } from 'url';
import slugify from 'slugify';
import { config } from './lib/config.js';
import { query } from './lib/db.js';
import logger from './lib/logger.js';
import { writeProgress, completeStep, setActiveItem, removeActiveItem } from './lib/progress.js';
import { validatePrePublish, validateTransition } from './lib/state-machine.js';
import { isCdnUrl } from './lib/bunny.js';

const LANGS = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];
const SITE_URL = config.siteUrl;

// ============================================
// Slug Generation
// ============================================

function makeSlug(text, id) {
    if (!text) return id.split('-')[0];
    const base = slugify(text, {
        lower: true,
        strict: true,
        locale: 'en',
        remove: /[*+~.()'"!:@]/g,
    });
    const shortId = id.split('-')[0];
    return base ? `${base}-${shortId}` : shortId;
}

function generateMultilingualSlugs(titleJsonb, videoId) {
    const slugs = {};
    let titles = {};

    // Parse title JSONB if string
    if (typeof titleJsonb === 'string') {
        try { titles = JSON.parse(titleJsonb); } catch { titles = {}; }
    } else {
        titles = titleJsonb || {};
    }

    for (const lang of LANGS) {
        const title = titles[lang] || titles.en || '';
        slugs[lang] = makeSlug(title, videoId);
    }

    return slugs;
}

// ============================================
// Update Counts
// ============================================

export async function updateAllCounts() {
    logger.info('  Updating counts...');

    // Celebrity video counts
    await query(`
        UPDATE celebrities c SET
            videos_count = COALESCE((
                SELECT COUNT(DISTINCT vc.video_id) FROM video_celebrities vc
                JOIN videos v ON v.id = vc.video_id
                WHERE vc.celebrity_id = c.id AND v.status = 'published'
            ), 0),
            total_views = COALESCE((
                SELECT SUM(v.views_count) FROM videos v
                JOIN video_celebrities vc ON vc.video_id = v.id
                WHERE vc.celebrity_id = c.id AND v.status = 'published'
            ), 0),
            movies_count = COALESCE((
                SELECT COUNT(DISTINCT mc.movie_id) FROM movie_celebrities mc
                WHERE mc.celebrity_id = c.id
            ), 0)
    `);

    // Tag video counts
    await query(`
        UPDATE tags t SET
            videos_count = COALESCE((
                SELECT COUNT(DISTINCT vt.video_id) FROM video_tags vt
                JOIN videos v ON v.id = vt.video_id
                WHERE vt.tag_id = t.id AND v.status = 'published'
            ), 0)
    `);

    // Category video counts
    await query(`
        UPDATE categories c SET
            videos_count = COALESCE((
                SELECT COUNT(DISTINCT vc.video_id) FROM video_categories vc
                JOIN videos v ON v.id = vc.video_id
                WHERE vc.category_id = c.id AND v.status = 'published'
            ), 0)
    `);

    // Movie scene counts
    await query(`
        UPDATE movies m SET
            scenes_count = COALESCE((
                SELECT COUNT(DISTINCT ms.video_id) FROM movie_scenes ms
                JOIN videos v ON v.id = ms.video_id
                WHERE ms.movie_id = m.id AND v.status = 'published'
            ), 0),
            total_views = COALESCE((
                SELECT SUM(v.views_count) FROM videos v
                JOIN movie_scenes ms ON ms.video_id = v.id
                WHERE ms.movie_id = m.id AND v.status = 'published'
            ), 0)
    `);

    logger.info('  Counts updated');
}

// ============================================
// Create Movie Scene Entries
// ============================================

async function linkMovieScenes(videoId) {
    // Find movies connected to this video's celebrities
    const { rows: movieLinks } = await query(`
        SELECT DISTINCT m.id as movie_id
        FROM movies m
        JOIN movie_celebrities mc ON mc.movie_id = m.id
        JOIN video_celebrities vc ON vc.celebrity_id = mc.celebrity_id
        WHERE vc.video_id = $1
    `, [videoId]);

    for (const link of movieLinks) {
        await query(`
            INSERT INTO movie_scenes (movie_id, video_id)
            VALUES ($1, $2) ON CONFLICT DO NOTHING
            
        `, [link.movie_id, videoId]);
    }

    return movieLinks.length;
}

// ============================================
// Pre-Publish Validation
// ============================================

export function validateVideoForPublish(video) {
    const warnings = [];
    const errors = [];
    const needsReview = []; // Issues that send video to moderation instead of blocking

    // CRITICAL: Video must have CDN URL (either watermarked or original on CDN)
    const hasWatermarkedCdn = isCdnUrl(video.video_url_watermarked);
    const hasVideoCdn = isCdnUrl(video.video_url);

    if (!hasWatermarkedCdn && !hasVideoCdn) {
        errors.push(`NO_CDN_VIDEO: video_url points to source (${(video.video_url || 'null').substring(0, 60)}...), will expire`);
    }

    // CRITICAL: Must have CDN thumbnail
    if (!isCdnUrl(video.thumbnail_url)) {
        errors.push(`NO_CDN_THUMBNAIL: thumbnail_url=${(video.thumbnail_url || 'null').substring(0, 60)}`);
    }

    // WARNING: Missing movie poster (cosmetic, not blocking)
    if (!video.movie_poster_url && video.movie_title) {
        warnings.push(`NO_MOVIE_POSTER: movie "${video.movie_title}" has no poster`);
    }

    // WARNING: Celebrity(s) without photo (cosmetic, not blocking)
    const celebsNoPhoto = parseInt(video.celebs_no_photo) || 0;
    if (celebsNoPhoto > 0) {
        warnings.push(`CELEBS_NO_PHOTO: ${celebsNoPhoto} celebrity(s) have no photo`);
    }

    // MODERATION: No celebrities linked → needs_review (this IS critical)
    if (video.celebrity_count === 0 || video.celebrity_count === undefined) {
        needsReview.push('NO_CELEBRITIES: no celebrities linked to this video');
    }

    // WARNING: Missing sprite/preview (not critical but bad UX)
    if (!video.sprite_url) {
        warnings.push('NO_SPRITE: sprite sheet missing');
    }
    if (!video.preview_gif_url) {
        warnings.push('NO_PREVIEW_GIF: preview animation missing');
    }

    return { valid: errors.length === 0, needsReview, errors, warnings };
}

// ============================================
// Publish Single Video
// ============================================

export async function publishVideo(video, dryRun = false) {
    const videoId = video.id;

    // Generate multilingual slugs
    const slugs = generateMultilingualSlugs(video.title, videoId);

    if (dryRun) {
        const enTitle = typeof video.title === 'string'
            ? JSON.parse(video.title).en
            : video.title?.en;
        logger.info(`  [DRY] "${enTitle}" → /${slugs.en}`);
        return { status: 'ok', slug: slugs.en };
    }

    // Check if slug already exists (for any language) and make unique if needed
    for (const lang of LANGS) {
        const { rows: existing } = await query(
            `SELECT id FROM videos WHERE slug->>$1 = $2 AND id != $3 LIMIT 1`,
            [lang, slugs[lang], videoId]
        );
        if (existing.length > 0) {
            // Add more of the UUID to make it unique
            slugs[lang] = `${slugs[lang]}-${videoId.split('-').slice(0, 2).join('')}`;
        }
    }

    // Update video status to published
    await query(
        `UPDATE videos SET
            status = 'published',
            slug = $2::jsonb,
            published_at = NOW(),
            updated_at = NOW()
        WHERE id = $1`,
        [videoId, JSON.stringify(slugs)]
    );

    // Promote linked draft celebrities and movies to published
    await Promise.all([
        query(
            `UPDATE celebrities SET status = 'published'
             WHERE status = 'draft'
               AND id IN (SELECT celebrity_id FROM video_celebrities WHERE video_id = $1)`,
            [videoId]
        ),
        query(
            `UPDATE movies SET status = 'published'
             WHERE status = 'draft'
               AND id IN (SELECT movie_id FROM movie_scenes WHERE video_id = $1)`,
            [videoId]
        ),
    ]);

    // Link to movie scenes
    const scenesLinked = await linkMovieScenes(videoId);

    // Update raw_video status
    if (video.raw_video_id) {
        await query(
            `UPDATE raw_videos SET status = 'processed' WHERE id = $1`,
            [video.raw_video_id]
        );
    }

    // Log
    await query(
        `INSERT INTO processing_log (video_id, step, status, metadata)
         VALUES ($1, 'publish', 'completed', $2::jsonb)
         `,
        [
            videoId,
            JSON.stringify({
                slugs,
                scenesLinked,
                publishedAt: new Date().toISOString(),
            }),
        ]
    );

    const enTitle = typeof video.title === 'string'
        ? JSON.parse(video.title).en
        : video.title?.en;

    return { status: 'ok', slug: slugs.en, title: enTitle, scenesLinked };
}

// ============================================
// Main
// ============================================

async function main() {
    const args = parseArgs();
    const limit = args.limit || 50;
    const dryRun = args.dryRun;
    const autoMode = args.auto;

    logger.info('='.repeat(60));
    logger.info(`CelebSkin — Video Publishing${dryRun ? ' (DRY RUN)' : ''}`);
    logger.info('='.repeat(60));

    // Determine which videos to publish
    // STRICT: Only publish videos that completed the full pipeline:
    //   watermarked + CDN URLs for both video and thumbnail
    let statusFilter;
    if (autoMode) {
        statusFilter = `
            status = 'watermarked'
            AND ai_confidence >= 0.8
            AND video_url IS NOT NULL
            AND video_url LIKE '%b-cdn.net%'
            AND thumbnail_url IS NOT NULL
            AND thumbnail_url LIKE '%b-cdn.net%'
        `;
    } else {
        // Manual: watermarked or needs_review, but still require CDN URLs
        statusFilter = `
            status IN ('watermarked', 'needs_review')
            AND video_url IS NOT NULL
            AND video_url LIKE '%b-cdn.net%'
            AND thumbnail_url IS NOT NULL
            AND thumbnail_url LIKE '%b-cdn.net%'
        `;
    }

    const { rows: videos } = await query(
        `SELECT v.id, v.title, v.slug, v.raw_video_id, v.video_url, v.video_url_watermarked,
                v.thumbnail_url, v.sprite_url, v.preview_gif_url, v.ai_confidence, v.status,
                COALESCE(v.title->>'en', v.id::text) as display_title,
                (SELECT COUNT(*) FROM video_celebrities vc WHERE vc.video_id = v.id) as celebrity_count,
                (SELECT COUNT(*) FROM video_celebrities vc
                 JOIN celebrities c ON c.id = vc.celebrity_id
                 WHERE vc.video_id = v.id AND (c.photo_url IS NULL OR c.photo_url = '')) as celebs_no_photo,
                (SELECT m.poster_url FROM movie_scenes ms
                 JOIN movies m ON m.id = ms.movie_id
                 WHERE ms.video_id = v.id LIMIT 1) as movie_poster_url,
                (SELECT m.title FROM movie_scenes ms
                 JOIN movies m ON m.id = ms.movie_id
                 WHERE ms.video_id = v.id LIMIT 1) as movie_title
         FROM videos v
         WHERE ${statusFilter}
         ORDER BY ai_confidence DESC NULLS LAST, created_at ASC
         LIMIT $1`,
        [limit]
    );

    logger.info(`Found ${videos.length} videos ready to publish${autoMode ? ' (auto mode, confidence >= 0.8)' : ''}`);

    const startedAt = Date.now();
    let published = 0;
    let skipped = 0;
    let failed = 0;
    let blocked = 0;
    const _completed = [];
    const _errors = [];
    const _warnings = [];
    const _blocked = [];

    for (const video of videos) {
        try {
            const _start = Date.now();
            const vTitle = video.display_title || video.id;
            setActiveItem(video.id, { label: vTitle, subStep: 'Validating', pct: 0 });
            writeProgress({
                step: 'publish', stepLabel: 'Publishing Videos',
                videosTotal: videos.length, videosDone: published+skipped+failed+blocked,
                currentVideo: { id: video.id, title: vTitle, subStep: 'Validating' },
                completedVideos: _completed.slice(-10),
                errors: _errors.slice(-10),
                elapsedMs: Date.now() - startedAt,
            });

            // State machine pre-publish validation
            const prePublish = validatePrePublish(video);
            if (!prePublish.valid) {
                blocked++;
                removeActiveItem(video.id);
                _blocked.push({ id: video.id, title: vTitle, errors: prePublish.errors });
                logger.error(`  ✗ PRE-PUBLISH BLOCKED: ${vTitle}`);
                for (const err of prePublish.errors) {
                    logger.error(`    ❌ ${err}`);
                }
                continue;
            }

            // State transition validation
            try {
                validateTransition(video.status, 'published');
            } catch (err) {
                blocked++;
                removeActiveItem(video.id);
                _blocked.push({ id: video.id, title: vTitle, errors: [err.message] });
                logger.error(`  ✗ TRANSITION BLOCKED: ${vTitle} — ${err.message}`);
                continue;
            }

            // Pre-publish validation (detailed checks)
            const validation = validateVideoForPublish(video);

            // MODERATION: incomplete data → set needs_review for manual fix
            if (validation.needsReview && validation.needsReview.length > 0 && validation.valid) {
                blocked++;
                removeActiveItem(video.id);
                _blocked.push({ id: video.id, title: vTitle, errors: validation.needsReview });
                logger.warn(`  → MODERATION: ${vTitle}`);
                for (const issue of validation.needsReview) {
                    logger.warn(`    🔍 ${issue}`);
                }
                // Set status to needs_review
                await query(
                    `UPDATE videos SET status = 'needs_review', updated_at = NOW() WHERE id = $1`,
                    [video.id]
                );
                await query(
                    `INSERT INTO processing_log (video_id, step, status, metadata) VALUES ($1, 'publish_moderation', 'needs_review', $2::jsonb)`,
                    [video.id, JSON.stringify({ issues: validation.needsReview, warnings: validation.warnings })]
                );
                continue;
            }

            if (!validation.valid) {
                blocked++;
                removeActiveItem(video.id);
                _blocked.push({ id: video.id, title: vTitle, errors: validation.errors });
                logger.error(`  ✗ BLOCKED: ${vTitle}`);
                for (const err of validation.errors) {
                    logger.error(`    ❌ ${err}`);
                }
                for (const warn of validation.warnings) {
                    logger.warn(`    ⚠️ ${warn}`);
                }
                // Log to processing_log
                await query(
                    `INSERT INTO processing_log (video_id, step, status, metadata) VALUES ($1, 'publish_validation', 'blocked', $2::jsonb)`,
                    [video.id, JSON.stringify({ errors: validation.errors, warnings: validation.warnings })]
                );
                continue;
            }

            // Log warnings but continue publishing
            if (validation.warnings.length > 0) {
                _warnings.push({ id: video.id, title: vTitle, warnings: validation.warnings });
                for (const warn of validation.warnings) {
                    logger.warn(`  ⚠️ ${warn}`);
                }
            }

            setActiveItem(video.id, { label: vTitle, subStep: 'Publishing', pct: 50 });
            const result = await publishVideo(video, dryRun);

            if (result.status === 'ok') {
                published++;
                removeActiveItem(video.id);
                _completed.push({ id: video.id, title: vTitle, status: 'ok', ms: Date.now() - _start });
                logger.info(`  [${published}] "${result.title || 'untitled'}" → /video/${result.slug}${result.scenesLinked ? ` (${result.scenesLinked} movie scenes)` : ''}`);
            } else {
                skipped++;
                removeActiveItem(video.id);
            }
        } catch (err) {
            failed++;
            removeActiveItem(video.id);
            _errors.push({ id: video.id, title: video.display_title || video.id, error: err.message });
            logger.error(`  ✗ Error publishing ${video.id}: ${err.message}`);
        }
    }

    const allErrors = [..._errors, ..._blocked.map(b => ({ ...b, error: b.errors.join('; ') }))];
    completeStep({
        videosDone: published + skipped + failed + blocked,
        videosTotal: videos.length,
        elapsedMs: Date.now() - startedAt,
        completedVideos: _completed.slice(-20),
        errors: allErrors.slice(-20),
        errorCount: failed + blocked,
    });

    // Update all counts after publishing batch
    if (published > 0 && !dryRun) {
        await updateAllCounts();
    }

    // Summary
    logger.info('\n' + '='.repeat(60));
    logger.info('PUBLISHING SUMMARY');
    logger.info(`Published: ${published}`);
    logger.info(`Blocked by validation: ${blocked}`);
    logger.info(`Skipped: ${skipped}`);
    logger.info(`Failed: ${failed}`);

    if (_blocked.length > 0) {
        logger.info('\n⛔ BLOCKED VIDEOS (need fixing before publish):');
        for (const item of _blocked) {
            logger.info(`  ${item.title}:`);
            for (const err of item.errors) {
                logger.info(`    ❌ ${err}`);
            }
        }
    }

    if (_warnings.length > 0) {
        logger.info('\n⚠️ PUBLISHED WITH WARNINGS:');
        for (const item of _warnings) {
            logger.info(`  ${item.title}: ${item.warnings.join(', ')}`);
        }
    }

    if (published > 0 && !dryRun) {
        logger.info(`\nSite URLs (examples):`);
        logger.info(`  ${SITE_URL}/en/video/<slug>`);
        logger.info(`  ${SITE_URL}/ru/video/<slug>`);
    }
}

function parseArgs() {
    const args = { limit: null, dryRun: false, auto: false };
    for (const arg of process.argv.slice(2)) {
        if (arg === '--dry-run') args.dryRun = true;
        if (arg === '--auto') args.auto = true;
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
