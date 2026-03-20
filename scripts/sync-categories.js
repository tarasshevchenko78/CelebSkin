#!/usr/bin/env node
/**
 * sync-categories.js — Sync boobsradar categories to DB
 *
 * Fetches categories from boobsradar.com/categories/, gets REAL video counts
 * from each category's first page (pagination), and upserts into `categories` table.
 *
 * Usage:
 *   node sync-categories.js
 *   node sync-categories.js --fast   # skip video count fetching (just names)
 */

import BoobsRadarAdapter from './adapters/boobsradar-adapter.js';
import { query, pool } from './lib/db.js';
import logger from './lib/logger.js';
import { toTitleCase } from './lib/name-utils.js';

const VIDEOS_PER_PAGE = 20;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const fast = process.argv.includes('--fast');
  const adapter = new BoobsRadarAdapter();

  logger.info('Fetching categories from boobsradar.com...');
  const categories = await adapter.getCategories();
  logger.info(`Found ${categories.length} categories`);

  if (categories.length === 0) {
    logger.warn('No categories found — possible anti-bot block');
    process.exit(1);
  }

  let inserted = 0;
  let updated = 0;

  for (const cat of categories) {
    let totalVideos = 0;

    if (!fast) {
      // Fetch page 1 of category to get lastPage from pagination
      try {
        const { lastPage } = await adapter.getVideoList(cat.url, 1);
        totalVideos = lastPage * VIDEOS_PER_PAGE;
        logger.info(`  ${cat.title}: ~${totalVideos} videos (${lastPage} pages)`);
        await sleep(500); // Be polite
      } catch (err) {
        logger.warn(`  ${cat.title}: failed to get count — ${err.message}`);
      }
    }

    const result = await query(
      `INSERT INTO collections (title, slug, videos_count, is_auto)
       VALUES ($1::jsonb, $2, $3, true)
       ON CONFLICT (slug) DO UPDATE SET
         title = COALESCE(EXCLUDED.title, collections.title),
         videos_count = CASE WHEN EXCLUDED.videos_count > 0 THEN EXCLUDED.videos_count ELSE collections.videos_count END
       RETURNING (xmax = 0) AS is_new`,
      [JSON.stringify({ en: toTitleCase(cat.title), ru: toTitleCase(cat.title) }), cat.slug, totalVideos]
    );
    if (result.rows[0]?.is_new) inserted++;
    else updated++;
  }

  logger.info(`Collections: ${inserted} new, ${updated} updated`);

  // Link raw_videos → collection_videos
  logger.info('Linking videos to collections...');
  const { rows: dbCats } = await query(`SELECT id, title, slug FROM collections`);
  const catMap = new Map();
  for (const c of dbCats) {
    if (c.title && c.title.en) catMap.set(c.title.en.toLowerCase(), c.id);
    if (c.title && c.title.ru) catMap.set(c.title.ru.toLowerCase(), c.id);
    if (c.slug) catMap.set(c.slug.toLowerCase(), c.id);
  }

  const { rows: videos } = await query(
    `SELECT v.id as video_id, rv.raw_categories
     FROM videos v
     JOIN raw_videos rv ON rv.id = v.raw_video_id
     WHERE rv.raw_categories IS NOT NULL
       AND array_length(rv.raw_categories, 1) > 0`
  );

  let linked = 0;
  for (const video of videos) {
    for (const rawCat of (video.raw_categories || [])) {
      const catId = catMap.get(rawCat.toLowerCase());
      if (catId) {
        try {
          await query(
            `INSERT INTO collection_videos (video_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [video.video_id, catId]
          );
          linked++;
        } catch { /* ignore */ }
      }
    }
  }

  logger.info(`Linked ${linked} video-collection associations`);
  logger.info('Done!');
  await pool.end();
}

main().catch(err => {
  logger.error('Fatal:', err.message);
  process.exit(1);
});
