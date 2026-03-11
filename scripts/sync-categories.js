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
      `INSERT INTO categories (name, slug, name_localized, videos_count)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         videos_count = CASE WHEN EXCLUDED.videos_count > 0 THEN EXCLUDED.videos_count ELSE categories.videos_count END
       RETURNING (xmax = 0) AS is_new`,
      [cat.title, cat.slug, JSON.stringify({ en: cat.title }), totalVideos]
    );
    if (result.rows[0]?.is_new) inserted++;
    else updated++;
  }

  logger.info(`Categories: ${inserted} new, ${updated} updated`);

  // Link raw_videos → video_categories
  logger.info('Linking videos to categories...');
  const { rows: dbCats } = await query(`SELECT id, name, slug FROM categories`);
  const catMap = new Map();
  for (const c of dbCats) {
    catMap.set(c.name.toLowerCase(), c.id);
    catMap.set(c.slug.toLowerCase(), c.id);
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
            `INSERT INTO video_categories (video_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [video.video_id, catId]
          );
          linked++;
        } catch { /* ignore */ }
      }
    }
  }

  logger.info(`Linked ${linked} video-category associations`);
  logger.info('Done!');
  await pool.end();
}

main().catch(err => {
  logger.error('Fatal:', err.message);
  process.exit(1);
});
