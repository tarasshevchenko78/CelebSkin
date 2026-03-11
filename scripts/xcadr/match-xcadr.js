#!/usr/bin/env node
/**
 * match-xcadr.js — Match xcadr_imports with existing DB records
 *
 * Takes rows with status='translated' and:
 *  1. Checks for duplicate videos in our DB (sets status='duplicate')
 *  2. Matches celebrity + movie in our DB
 *  3. Builds a boobsradar search URL for admin to verify
 *  4. Sets status='matched' or 'no_match'
 *
 * Usage:
 *   node xcadr/match-xcadr.js --limit 50
 */

import { query, pool } from '../lib/db.js';

// --- CLI ---
const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg
  ? parseInt(limitArg.includes('=') ? limitArg.split('=')[1] : args[args.indexOf(limitArg) + 1])
  : 50;

// --- HELPERS ---

/**
 * Build a boobsradar search URL from celebrity + movie names.
 */
function buildBoobsradarUrl(celebEn, movieEn) {
  const parts = [celebEn, movieEn].filter(Boolean);
  if (parts.length === 0) return null;
  const q = encodeURIComponent(parts.join(' '));
  return `https://boobsradar.com/?s=${q}`;
}

// --- MATCH STRATEGIES ---

/**
 * Strategy A: similarity match on original_title.
 * Uses pg_trgm similarity — index exists on videos.original_title.
 */
async function matchByOriginalTitle(celebEn, movieEn) {
  if (!celebEn && !movieEn) return null;
  const searchTerm = [celebEn, movieEn].filter(Boolean).join(' ');
  const res = await query(
    `SELECT id, similarity(original_title, $1) AS score
     FROM videos
     WHERE original_title IS NOT NULL
       AND similarity(original_title, $1) > 0.3
     ORDER BY score DESC
     LIMIT 1`,
    [searchTerm]
  );
  return res.rows[0]?.id || null;
}

/**
 * Strategy B: match through celebrity → video_celebrities join.
 * Finds videos linked to a celebrity whose name matches, then
 * optionally cross-checks against movie.
 */
async function matchByCelebrity(celebEn, movieEn) {
  if (!celebEn) return null;

  // Find video IDs linked to matching celebrity
  const celebRes = await query(
    `SELECT v.id
     FROM videos v
     JOIN video_celebrities vc ON v.id = vc.video_id
     JOIN celebrities c ON vc.celebrity_id = c.id
     WHERE c.name ILIKE '%' || $1 || '%'
     LIMIT 20`,
    [celebEn]
  );
  if (celebRes.rows.length === 0) return null;

  // If we also have movie, cross-check
  if (movieEn) {
    for (const row of celebRes.rows) {
      const check = await query(
        `SELECT v.id
         FROM videos v
         JOIN movie_scenes ms ON v.id = ms.video_id
         JOIN movies m ON ms.movie_id = m.id
         WHERE v.id = $1
           AND (m.title ILIKE '%' || $2 || '%' OR m.title_localized->>'en' ILIKE '%' || $2 || '%')
         LIMIT 1`,
        [row.id, movieEn]
      );
      if (check.rows.length > 0) return check.rows[0].id;
    }
  }

  // Return first celeb match without movie cross-check
  return celebRes.rows[0].id;
}

/**
 * Strategy C: fuzzy ILIKE on video title jsonb field.
 */
async function matchByTitle(celebEn, movieEn) {
  if (!celebEn && !movieEn) return null;

  if (celebEn && movieEn) {
    const res = await query(
      `SELECT id FROM videos
       WHERE title->>'en' ILIKE '%' || $1 || '%'
         AND title->>'en' ILIKE '%' || $2 || '%'
       LIMIT 1`,
      [celebEn, movieEn]
    );
    return res.rows[0]?.id || null;
  }

  const term = celebEn || movieEn;
  const res = await query(
    `SELECT id FROM videos
     WHERE title->>'en' ILIKE '%' || $1 || '%'
     LIMIT 1`,
    [term]
  );
  return res.rows[0]?.id || null;
}

/**
 * Find matching celebrity id in our DB.
 */
async function findCelebrity(celebEn) {
  if (!celebEn) return null;
  const res = await query(
    `SELECT id FROM celebrities
     WHERE name ILIKE '%' || $1 || '%'
     LIMIT 1`,
    [celebEn]
  );
  return res.rows[0]?.id || null;
}

/**
 * Find matching movie id in our DB.
 */
async function findMovie(movieEn) {
  if (!movieEn) return null;
  const res = await query(
    `SELECT id FROM movies
     WHERE title ILIKE '%' || $1 || '%'
        OR title_localized->>'en' ILIKE '%' || $1 || '%'
     LIMIT 1`,
    [movieEn]
  );
  return res.rows[0]?.id || null;
}

// --- MAIN ---

async function main() {
  const rows = await query(
    `SELECT id, title_en, celebrity_name_en, movie_title_en
     FROM xcadr_imports
     WHERE status = 'translated'
     ORDER BY created_at ASC
     LIMIT $1`,
    [LIMIT]
  );

  if (rows.rows.length === 0) {
    console.log('No rows with status=translated found.');
    await pool.end();
    return;
  }

  console.log(`Matching ${rows.rows.length} rows (limit=${LIMIT})...`);

  let duplicates = 0;
  let matched    = 0;
  let noMatch    = 0;

  for (let i = 0; i < rows.rows.length; i++) {
    const row = rows.rows[i];
    const { celebrity_name_en, movie_title_en } = row;

    process.stdout.write(`\r[${i + 1}/${rows.rows.length}] ${(celebrity_name_en || '?').substring(0, 40)}`);

    try {
      // STEP 1 — Check for duplicate video in our DB
      let existingVideoId =
        await matchByOriginalTitle(celebrity_name_en, movie_title_en) ||
        await matchByCelebrity(celebrity_name_en, movie_title_en) ||
        await matchByTitle(celebrity_name_en, movie_title_en);

      if (existingVideoId) {
        await query(
          `UPDATE xcadr_imports
           SET matched_video_id = $1, status = 'duplicate', updated_at = NOW()
           WHERE id = $2`,
          [existingVideoId, row.id]
        );
        duplicates++;
        continue;
      }

      // STEP 2 — Match celebrity in our DB
      const matched_celebrity_id = await findCelebrity(celebrity_name_en);

      // STEP 3 — Match movie in our DB
      const matched_movie_id = await findMovie(movie_title_en);

      // STEP 4 — Build boobsradar search URL
      const boobsradar_url = buildBoobsradarUrl(celebrity_name_en, movie_title_en);

      // Determine final status
      const status = (celebrity_name_en || movie_title_en) ? 'matched' : 'no_match';
      if (status === 'no_match') {
        noMatch++;
      } else {
        matched++;
      }

      await query(
        `UPDATE xcadr_imports
         SET matched_celebrity_id = $1,
             matched_movie_id = $2,
             boobsradar_url = $3,
             status = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [matched_celebrity_id, matched_movie_id, boobsradar_url, status, row.id]
      );
    } catch (err) {
      console.warn(`\n[ERROR] Row ${row.id}: ${err.message}`);
    }
  }

  process.stdout.write('\n');
  console.log('\n========================================');
  console.log(`Duplicates: ${duplicates}, Matched: ${matched}, No match: ${noMatch}`);
  console.log('========================================');

  await pool.end();
}

main().catch((err) => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
