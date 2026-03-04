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

import dotenv from 'dotenv';
dotenv.config();

import slugify from 'slugify';
import { query } from './lib/db.js';
import logger from './lib/logger.js';
import { writeProgress, clearProgress } from './lib/progress.js';

const LANGS = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];
const SITE_URL = process.env.SITE_URL || 'https://celeb.skin';

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

async function updateAllCounts() {
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
// Publish Single Video
// ============================================

async function publishVideo(video, dryRun = false) {
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
    let statusFilter;
    if (autoMode) {
        // Auto-publish: only high-confidence videos with all media ready
        statusFilter = `
            status IN ('enriched', 'auto_recognized', 'watermarked')
            AND ai_confidence >= 0.8
            AND video_url IS NOT NULL
            AND thumbnail_url IS NOT NULL
        `;
    } else {
        // Manual: publish all enriched/watermarked/auto_recognized
        statusFilter = `
            status IN ('enriched', 'auto_recognized', 'watermarked', 'needs_review')
            AND video_url IS NOT NULL
        `;
    }

    const { rows: videos } = await query(
        `SELECT id, title, slug, raw_video_id, video_url, video_url_watermarked,
                thumbnail_url, ai_confidence, status
         FROM videos
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
    const _completed = [];
    const _errors = [];

    for (const video of videos) {
        try {
            const _start = Date.now();
            writeProgress({
                step: 'publish', stepLabel: 'Publishing Videos',
                videosTotal: videos.length, videosDone: published+skipped+failed,
                currentVideo: { id: video.id, title: video.id, subStep: 'Processing' },
                completedVideos: _completed.slice(-10),
                errors: _errors.slice(-10),
                elapsedMs: Date.now() - startedAt,
            });
            const result = await publishVideo(video, dryRun);

            if (result.status === 'ok') {
                published++;
                _completed.push({ id: video.id, title: video.id, status: 'ok', ms: Date.now() - _start });
                logger.info(`  [${published}] "${result.title || 'untitled'}" → /video/${result.slug}${result.scenesLinked ? ` (${result.scenesLinked} movie scenes)` : ''}`);
            } else {
                skipped++;
            }
        } catch (err) {
            failed++;
            _errors.push({ id: video.id, title: video.id, error: err.message });
            logger.error(`  ✗ Error publishing ${video.id}: ${err.message}`);
        }
    }

    clearProgress();

    // Update all counts after publishing batch
    if (published > 0 && !dryRun) {
        await updateAllCounts();
    }

    // Summary
    logger.info('\n' + '='.repeat(60));
    logger.info('PUBLISHING SUMMARY');
    logger.info(`Published: ${published}`);
    logger.info(`Skipped: ${skipped}`);
    logger.info(`Failed: ${failed}`);

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

main().catch(err => {
    logger.error('Fatal error:', err);
    process.exit(1);
});
