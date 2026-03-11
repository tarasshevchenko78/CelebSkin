#!/usr/bin/env node
/**
 * sync-categories.js — Sync boobsradar categories to DB
 *
 * Fetches categories from boobsradar.com/categories/ and upserts them
 * into the `categories` table. Also links existing raw_videos
 * to their categories via `video_categories`.
 *
 * Usage:
 *   node sync-categories.js
 */

import BoobsRadarAdapter from './adapters/boobsradar-adapter.js';
import { query, pool } from './lib/db.js';
import logger from './lib/logger.js';

async function main() {
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
    const result = await query(
      `INSERT INTO categories (name, slug, name_localized)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING (xmax = 0) AS is_new`,
      [cat.title, cat.slug, JSON.stringify({ en: cat.title })]
    );
    if (result.rows[0]?.is_new) inserted++;
    else updated++;
  }

  logger.info(`Categories: ${inserted} new, ${updated} updated`);

  // Now link raw_videos → video_categories based on raw_categories
  // raw_categories are stored as text[] in raw_videos
  // We need to match them to category slugs/names
  logger.info('Linking videos to categories...');

  // Get all category name→id mappings (case-insensitive)
  const { rows: dbCats } = await query(
    `SELECT id, name, slug FROM categories`
  );
  const catMap = new Map();
  for (const c of dbCats) {
    catMap.set(c.name.toLowerCase(), c.id);
    catMap.set(c.slug.toLowerCase(), c.id);
  }

  // Find videos with raw_categories that match our categories
  const { rows: videos } = await query(
    `SELECT v.id as video_id, rv.raw_categories
     FROM videos v
     JOIN raw_videos rv ON rv.id = v.raw_video_id
     WHERE rv.raw_categories IS NOT NULL
       AND array_length(rv.raw_categories, 1) > 0`
  );

  let linked = 0;
  for (const video of videos) {
    const cats = video.raw_categories || [];
    for (const rawCat of cats) {
      const catId = catMap.get(rawCat.toLowerCase());
      if (catId) {
        try {
          await query(
            `INSERT INTO video_categories (video_id, category_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [video.video_id, catId]
          );
          linked++;
        } catch {
          // ignore duplicate
        }
      }
    }
  }

  logger.info(`Linked ${linked} video-category associations`);

  // Update videos_count on categories
  await query(`
    UPDATE categories c SET videos_count = (
      SELECT COUNT(DISTINCT vc.video_id)
      FROM video_categories vc
      JOIN videos v ON v.id = vc.video_id
      WHERE vc.category_id = c.id AND v.status = 'published'
    )
  `);

  logger.info('Done!');
  await pool.end();
}

main().catch(err => {
  logger.error('Fatal:', err.message);
  process.exit(1);
});
