#!/usr/bin/env node
/**
 * backfill-tags.js — Привязка канонических тегов к старым видео через donor tag mapping
 * Источник: raw_videos.raw_tags → tag_mapping + DONOR_MAP → canonical tags → video_tags
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const pool = new pg.Pool({
  host: process.env.DB_HOST || '185.224.82.214',
  port: 5432,
  database: 'celebskin',
  user: 'celebskin',
  password: process.env.DB_PASSWORD,
});

// Canonical slugs — only these pass
const CANONICAL_SLUGS = new Set([
  'sexy','cleavage','bikini','lingerie','topless','butt','nude',
  'full-frontal','bush','sex-scene','explicit','oral','blowjob',
  'lesbian','masturbation','striptease','shower','skinny-dip',
  'rape-scene','gang-rape','bed-scene','romantic','rough',
  'threesome','bdsm','body-double','prosthetic',
  'movie','tv-show','music-video','on-stage','photoshoot',
]);

// Hardcoded DONOR_MAP fallback (same as lib/tags.js)
const DONOR_MAP = {
  'nude': 'nude', 'naked': 'nude',
  'topless': 'topless', 'tits': 'topless', 'boobs': 'topless', 'breasts': 'topless',
  'full frontal': 'full-frontal', 'pussy': 'full-frontal', 'frontal': 'full-frontal',
  'bush': 'bush', 'pubic': 'bush', 'hairy': 'bush',
  'ass': 'butt', 'butt': 'butt', 'booty': 'butt', 'behind': 'butt',
  'cleavage': 'cleavage', 'sideboob': 'cleavage',
  'sexy': 'sexy', 'hot': 'sexy', 'seductive': 'sexy',
  'bikini': 'bikini', 'swimsuit': 'bikini', 'swimwear': 'bikini',
  'lingerie': 'lingerie', 'underwear': 'lingerie', 'bra': 'lingerie',
  'panties': 'lingerie', 'thong': 'lingerie', 'corset': 'lingerie', 'stockings': 'lingerie',
  'sex scene': 'sex-scene', 'sex': 'sex-scene', 'fucking': 'sex-scene', 'intercourse': 'sex-scene',
  'explicit': 'explicit', 'unsimulated': 'explicit', 'real sex': 'explicit', 'hardcore': 'explicit',
  'oral': 'oral', 'cunnilingus': 'oral',
  'blowjob': 'blowjob', 'bj': 'blowjob', 'fellatio': 'blowjob',
  'lesbian': 'lesbian', 'girl on girl': 'lesbian',
  'masturbation': 'masturbation', 'solo': 'masturbation',
  'shower': 'shower', 'bath': 'shower', 'bathtub': 'shower',
  'striptease': 'striptease', 'strip': 'striptease', 'undressing': 'striptease',
  'skinny dipping': 'skinny-dip', 'swimming nude': 'skinny-dip',
  'rape': 'rape-scene', 'rape scene': 'rape-scene', 'forced': 'rape-scene',
  'gang rape': 'gang-rape', 'gangrape': 'gang-rape',
  'threesome': 'threesome', 'group': 'threesome', 'orgy': 'threesome',
  'bdsm': 'bdsm', 'bondage': 'bdsm', 'tied': 'bdsm',
  'romantic': 'romantic', 'love scene': 'romantic', 'sensual': 'romantic',
  'bed': 'bed-scene', 'bedroom': 'bed-scene',
  'rough': 'rough',
  'scene': 'sexy', 'nudity': 'nude', 'nudity scene': 'nude',
  'love': 'romantic', 'erotic': 'sexy', 'erotica': 'sexy',
  'nude scene': 'nude', 'topless scene': 'topless',
  'classic nude': 'nude', 'classic': 'movie',
  'swingers': 'sex-scene',
};

async function main() {
  const client = await pool.connect();
  try {
    // 1. Load tag_mapping from DB (priority over DONOR_MAP)
    const { rows: dbMappings } = await client.query(
      `SELECT donor_tag, our_tag_slug FROM tag_mapping`
    );
    const dbMap = {};
    for (const m of dbMappings) {
      dbMap[m.donor_tag.toLowerCase().trim()] = m.our_tag_slug;
    }
    console.log(`Loaded ${dbMappings.length} DB tag mappings`);

    // 2. Load canonical tag IDs
    const { rows: tagRows } = await client.query(
      `SELECT id, slug FROM tags WHERE is_canonical = true`
    );
    const tagIdBySlug = {};
    for (const t of tagRows) {
      tagIdBySlug[t.slug] = t.id;
    }
    console.log(`Loaded ${tagRows.length} canonical tags`);

    // 3. Fetch videos without tags
    const { rows: videos } = await client.query(`
      SELECT v.id, v.title, rv.raw_tags
      FROM videos v
      JOIN raw_videos rv ON rv.id = v.raw_video_id
      WHERE v.status = 'published'
        AND v.id NOT IN (SELECT DISTINCT video_id FROM video_tags)
      ORDER BY v.published_at DESC
    `);
    console.log(`Found ${videos.length} videos without tags\n`);

    let totalMapped = 0;
    let totalInserted = 0;
    let videosWithTags = 0;

    for (const v of videos) {
      const rawTags = v.raw_tags || [];
      if (rawTags.length === 0) continue;

      // Map each raw tag → canonical slug
      const mapped = new Set();
      for (const raw of rawTags) {
        const key = raw.toLowerCase().trim();
        // Priority: DB tag_mapping → DONOR_MAP → direct match
        let slug = dbMap[key] || DONOR_MAP[key] || null;
        if (!slug && CANONICAL_SLUGS.has(key)) {
          slug = key; // direct match (e.g. "nude", "topless")
        }
        if (slug && CANONICAL_SLUGS.has(slug)) {
          mapped.add(slug);
        }
      }

      if (mapped.size === 0) {
        // Try to assign at least 'sexy' + 'movie' as fallback
        mapped.add('sexy');
        mapped.add('movie');
      }

      // Insert video_tags
      let inserted = 0;
      for (const slug of mapped) {
        const tagId = tagIdBySlug[slug];
        if (!tagId) continue;
        await client.query(
          `INSERT INTO video_tags (video_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [v.id, tagId]
        );
        inserted++;
      }

      const title = v.title?.en || v.title?.ru || v.id.slice(0, 8);
      console.log(`${title}: [${rawTags.join(', ')}] → [${[...mapped].join(', ')}] (${inserted} tags)`);
      totalMapped += mapped.size;
      totalInserted += inserted;
      if (inserted > 0) videosWithTags++;
    }

    // 4. Update tag counts
    await client.query(`
      UPDATE tags SET videos_count = (
        SELECT COUNT(*) FROM video_tags WHERE tag_id = tags.id
      )
    `);

    console.log(`\n=== ИТОГ ===`);
    console.log(`Видео обработано: ${videos.length}`);
    console.log(`Видео получили теги: ${videosWithTags}`);
    console.log(`Тегов присвоено: ${totalInserted}`);
    console.log(`Уникальных маппингов: ${totalMapped}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
