#!/usr/bin/env node
/**
 * publish.js — Publish searchcelebrityhd videos
 *
 * Sets status=published for videos that have CDN video + thumbnail.
 * Videos missing celebrity photo or movie poster → needs_review (warning only).
 */

import { query } from '../lib/db.js';
import logger from '../lib/logger.js';

const args = process.argv.slice(2);
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '20');

logger.info('=== SearchCelebrityHD Publish ===');

// Get watermarked videos with CDN URLs ready
const { rows: videos } = await query(`
  SELECT v.id, v.video_url, v.thumbnail_url, v.ai_confidence,
         COALESCE(v.title->>'en', v.id::text) as title_en,
         (SELECT COUNT(*) FROM video_celebrities vc WHERE vc.video_id = v.id) as celeb_count,
         (SELECT COUNT(*) FROM video_tags vt WHERE vt.video_id = v.id) as tag_count
  FROM videos v
  JOIN raw_videos rv ON rv.id = v.raw_video_id
  WHERE v.status = 'watermarked'
    AND v.video_url LIKE '%b-cdn.net%'
    AND v.thumbnail_url IS NOT NULL
    AND rv.extra_data->>'source' = 'searchcelebrityhd'
  ORDER BY v.created_at ASC
  LIMIT $1
`, [limit]);

logger.info(`Found ${videos.length} videos ready to publish`);

let published = 0, review = 0;

for (const video of videos) {
  const warnings = [];
  if (video.celeb_count === 0) warnings.push('NO_CELEBRITIES');
  if (video.tag_count === 0) warnings.push('NO_TAGS');

  // NO_CELEBRITIES → needs_review (can't publish without actress)
  if (video.celeb_count === 0) {
    await query(
      `UPDATE videos SET status = 'needs_review', updated_at = NOW() WHERE id = $1`,
      [video.id]
    );
    logger.warn(`  → needs_review: ${video.title_en} (${warnings.join(', ')})`);
    review++;
    continue;
  }

  // Publish
  await query(
    `UPDATE videos SET status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [video.id]
  );
  if (warnings.length > 0) {
    logger.info(`  → published (warnings: ${warnings.join(', ')}): ${video.title_en}`);
  } else {
    logger.info(`  → published: ${video.title_en}`);
  }
  published++;
}

logger.info(`\n=== Publish: ${published} published, ${review} needs_review ===`);
