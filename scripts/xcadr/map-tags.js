#!/usr/bin/env node
/**
 * map-tags.js — Map Russian xcadr tags/collections to our system
 *
 * PART A: Maps xcadr_tag_mapping using a hardcoded dictionary + Gemini for new tags.
 * PART B: Maps xcadr_collection_mapping, creating new collections if needed.
 * PART C: Logs summary of unmapped items needing admin attention.
 *
 * Does NOT apply tags/collections to any video — that happens on import.
 *
 * Usage:
 *   node xcadr/map-tags.js
 */

import axios from 'axios';
import slugify from 'slugify';
import { query, pool } from '../lib/db.js';
import { config } from '../lib/config.js';
import { extractGeminiJSON } from '../lib/gemini.js';

const GEMINI_KEY = config.ai.geminiApiKey;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
const GEMINI_DELAY_MS = 1000;

const LOCALES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'nl', 'tr', 'ru'];

// --- HARDCODED TAG DICTIONARY (Russian → English slug) ---
const TAG_DICTIONARY = {
  'голая':              'nude',
  'грудь':             'topless',
  'секс':              'sex-scene',
  'блондинка':         'blonde',
  'брюнетка':         'brunette',
  'рыжая':            'redhead',
  'в душе':           'shower',
  'постельная сцена': 'bed-scene',
  'бассейн':          'pool',
  'попа':             'butt',
  'полностью голая':  'full-frontal',
  'нижнее белье':     'lingerie',
  'бикини':           'bikini',
  'оральный секс':    'oral',
  'лесбийская сцена': 'lesbian',
  'групповой секс':   'group',
  'измена':           'cheating',
  'насилие':          'forced',
  'стриптиз':        'striptease',
  'купание':         'bathing',
  'пляж':            'beach',
  'романтическая сцена': 'romantic',
  'первая ночь':     'wedding-night',
  'БДСМ':            'bdsm',
  'беременная':      'pregnant',
};

// --- HELPERS ---

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseGeminiJson(text) {
  const stripped = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(stripped);
}

function makeSlug(text) {
  return slugify(text, { lower: true, strict: true });
}

// --- GEMINI HELPERS ---

/**
 * Translate a Russian tag to an English slug using Gemini.
 * Returns a URL-safe slug string like "nude" or "shower-scene", or null.
 */
async function geminiTranslateRuTagToSlug(tagRu) {
  if (!GEMINI_KEY) return null;

  const prompt = `Translate this Russian content tag to English. Used on a celebrity movie scene database. Return ONLY the English translation as a single short phrase, lowercase (2-4 words max). No quotes, no explanation.
Russian tag: "${tagRu}"`;

  try {
    const res = await axios.post(
      GEMINI_URL,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 },
      },
      { timeout: 20000 }
    );
    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!text) return null;
    // Clean up and slugify
    return makeSlug(text.toLowerCase().replace(/['"]/g, '').substring(0, 50));
  } catch (err) {
    console.warn(`  [Gemini] Tag ru→en translate error: ${err.message}`);
    return null;
  }
}

/**
 * Translate a single English tag slug to all 10 locales.
 * Returns { en, ru, de, fr, es, it, pt, pl, nl, tr } or null.
 */
async function geminiTranslateTag(englishSlug) {
  if (!GEMINI_KEY) return null;

  const englishLabel = englishSlug.replace(/-/g, ' ');
  const prompt = `Translate this content tag used on a movie scene database to these languages.
Return the translated tag name (not slug) — capitalize first letter.
English tag: "${englishLabel}"

Return JSON with exactly these keys: en, ru, de, fr, es, it, pt, pl, nl, tr
Example for "nude": {"en":"Nude","ru":"Обнажённая","de":"Nackt","fr":"Nue","es":"Desnuda","pt":"Nua","it":"Nuda","pl":"Naga","nl":"Naakt","tr":"Çıplak"}`;

  try {
    const res = await axios.post(
      GEMINI_URL,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      },
      { timeout: 20000 }
    );
    return extractGeminiJSON(res.data);
  } catch (err) {
    console.warn(`  [Gemini] Tag translate error: ${err.message}`);
    return null;
  }
}

/**
 * Translate a Russian collection name to English + all locales.
 * Returns { en, ru, de, fr, es, it, pt, pl, nl, tr } or null.
 */
async function geminiTranslateCollection(nameRu) {
  if (!GEMINI_KEY) return null;

  const prompt = `Translate this Russian movie collection name to all these languages.
It's used as a category name on a celebrity movie scene website.
Russian: "${nameRu}"

Return JSON with exactly these keys: en, ru, de, fr, es, it, pt, pl, nl, tr
Use natural, fluent translations — not literal. Keep it short (2-5 words).`;

  try {
    const res = await axios.post(
      GEMINI_URL,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      },
      { timeout: 20000 }
    );
    return extractGeminiJSON(res.data);
  } catch (err) {
    console.warn(`  [Gemini] Collection translate error: ${err.message}`);
    return null;
  }
}

// --- TAG OPERATIONS ---

/**
 * Find or create a tag in our tags table.
 * Returns the tag slug on success, null on failure.
 */
async function ensureTag(englishSlug) {
  // Check if tag exists
  const existing = await query(
    'SELECT slug FROM tags WHERE slug = $1',
    [englishSlug]
  );
  if (existing.rows.length > 0) return englishSlug;

  // Create it — need translated names for name_localized
  await delay(GEMINI_DELAY_MS);
  const translations = await geminiTranslateTag(englishSlug);

  const englishName = translations?.en || englishSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const nameLocalized = {};
  if (translations) {
    for (const locale of LOCALES) {
      if (translations[locale]) nameLocalized[locale] = translations[locale];
    }
  }

  try {
    await query(
      `INSERT INTO tags (slug, name, name_localized)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (slug) DO NOTHING`,
      [englishSlug, englishName, JSON.stringify(nameLocalized)]
    );
    return englishSlug;
  } catch (err) {
    console.warn(`  [DB] Failed to create tag "${englishSlug}": ${err.message}`);
    return null;
  }
}

// --- COLLECTION OPERATIONS ---

/**
 * Find or create a collection in our collections table.
 * Returns the collection id on success, null on failure.
 */
async function ensureCollection(nameRu) {
  // Translate first
  await delay(GEMINI_DELAY_MS);
  const translations = await geminiTranslateCollection(nameRu);
  if (!translations?.en) {
    console.warn(`  [Collection] Could not translate "${nameRu}"`);
    return null;
  }

  const collSlug = makeSlug(translations.en);

  // Check if collection with this slug exists
  const existing = await query(
    'SELECT id FROM collections WHERE slug = $1',
    [collSlug]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  // Also try fuzzy match on title
  const fuzzy = await query(
    `SELECT id FROM collections WHERE title->>'en' ILIKE '%' || $1 || '%'`,
    [translations.en]
  );
  if (fuzzy.rows.length > 0) return fuzzy.rows[0].id;

  // Build title jsonb
  const titleJson = {};
  for (const locale of LOCALES) {
    if (translations[locale]) titleJson[locale] = translations[locale];
  }

  try {
    const res = await query(
      `INSERT INTO collections (slug, title, description, featured, is_auto)
       VALUES ($1, $2::jsonb, '{}'::jsonb, false, false)
       RETURNING id`,
      [collSlug, JSON.stringify(titleJson)]
    );
    return res.rows[0].id;
  } catch (err) {
    console.warn(`  [DB] Failed to create collection "${translations.en}": ${err.message}`);
    return null;
  }
}

// --- PART A: TAG MAPPING ---

async function processTagMapping() {
  console.log('\n--- PART A: Tag Mapping ---');

  const tagsResult = await query(
    `SELECT DISTINCT unnest(tags_ru) AS tag
     FROM xcadr_imports
     WHERE tags_ru IS NOT NULL AND array_length(tags_ru, 1) > 0
     ORDER BY tag`
  );

  const allTags = tagsResult.rows.map((r) => r.tag);
  console.log(`Found ${allTags.length} unique Russian tags`);

  let autoMapped = 0;
  let newCreated = 0;
  let manualNeeded = 0;

  for (const tagRu of allTags) {
    // Skip only if already has a resolved mapping (our_tag_slug IS NOT NULL)
    const exists = await query(
      'SELECT id FROM xcadr_tag_mapping WHERE xcadr_tag_ru = $1 AND our_tag_slug IS NOT NULL',
      [tagRu]
    );
    if (exists.rows.length > 0) continue;

    const tagRuLower = tagRu.toLowerCase().trim();
    const dictMatch = TAG_DICTIONARY[tagRuLower] || TAG_DICTIONARY[tagRu];

    // Resolve slug: dictionary first, then Gemini
    let resolvedSlug = dictMatch || null;

    if (!resolvedSlug) {
      // Auto-translate with Gemini
      await delay(GEMINI_DELAY_MS);
      resolvedSlug = await geminiTranslateRuTagToSlug(tagRu);
      if (resolvedSlug) {
        process.stdout.write(`  [Gemini] "${tagRu}" → "${resolvedSlug}"\n`);
      }
    }

    if (resolvedSlug) {
      // Find or create the tag in our tags table
      const ourSlug = await ensureTag(resolvedSlug);
      if (ourSlug) {
        await query(
          `INSERT INTO xcadr_tag_mapping (xcadr_tag_ru, our_tag_slug, auto_mapped)
           VALUES ($1, $2, true)
           ON CONFLICT (xcadr_tag_ru) DO UPDATE SET our_tag_slug = EXCLUDED.our_tag_slug, auto_mapped = true`,
          [tagRu, ourSlug]
        );
        autoMapped++;
        process.stdout.write(`  ✓ "${tagRu}" → "${ourSlug}"\n`);
      } else {
        await query(
          `INSERT INTO xcadr_tag_mapping (xcadr_tag_ru, our_tag_slug, auto_mapped)
           VALUES ($1, NULL, false)
           ON CONFLICT (xcadr_tag_ru) DO NOTHING`,
          [tagRu]
        );
        manualNeeded++;
      }
    } else {
      await query(
        `INSERT INTO xcadr_tag_mapping (xcadr_tag_ru, our_tag_slug, auto_mapped)
         VALUES ($1, NULL, false)
         ON CONFLICT (xcadr_tag_ru) DO NOTHING`,
        [tagRu]
      );
      manualNeeded++;
    }
  }

  return { autoMapped, newCreated, manualNeeded };
}

// --- PART B: COLLECTION MAPPING ---

async function processCollectionMapping() {
  console.log('\n--- PART B: Collection Mapping ---');

  const colsResult = await query(
    `SELECT DISTINCT unnest(collections_ru) AS col
     FROM xcadr_imports
     WHERE collections_ru IS NOT NULL AND array_length(collections_ru, 1) > 0
     ORDER BY col`
  );

  const allCols = colsResult.rows.map((r) => r.col);
  console.log(`Found ${allCols.length} unique Russian collections`);

  let autoMapped = 0;
  let newCreated = 0;

  for (const colRu of allCols) {
    // Skip only if already has a resolved mapping (our_collection_id IS NOT NULL)
    const exists = await query(
      'SELECT id FROM xcadr_collection_mapping WHERE xcadr_collection_ru = $1 AND our_collection_id IS NOT NULL',
      [colRu]
    );
    if (exists.rows.length > 0) continue;

    const collectionId = await ensureCollection(colRu);
    if (collectionId) {
      await query(
        `INSERT INTO xcadr_collection_mapping (xcadr_collection_ru, our_collection_id, auto_mapped)
         VALUES ($1, $2, true)
         ON CONFLICT (xcadr_collection_ru) DO UPDATE SET our_collection_id = EXCLUDED.our_collection_id, auto_mapped = true`,
        [colRu, collectionId]
      );
      autoMapped++;
      console.log(`  ✓ "${colRu}" → collection id ${collectionId}`);
    } else {
      await query(
        `INSERT INTO xcadr_collection_mapping (xcadr_collection_ru, our_collection_id, auto_mapped)
         VALUES ($1, NULL, false)
         ON CONFLICT (xcadr_collection_ru) DO NOTHING`,
        [colRu]
      );
      console.warn(`  ✗ "${colRu}" → could not map`);
    }
  }

  return { autoMapped, newCreated };
}

// --- PART C: SUMMARY ---

async function logSummary() {
  console.log('\n--- PART C: Summary ---');

  const unmappedTags = await query(
    'SELECT xcadr_tag_ru FROM xcadr_tag_mapping WHERE our_tag_slug IS NULL ORDER BY xcadr_tag_ru'
  );
  const unmappedCols = await query(
    'SELECT xcadr_collection_ru FROM xcadr_collection_mapping WHERE our_collection_id IS NULL ORDER BY xcadr_collection_ru'
  );

  if (unmappedTags.rows.length > 0) {
    console.log(`\nUnmapped tags requiring admin attention (${unmappedTags.rows.length}):`);
    unmappedTags.rows.forEach((r) => console.log(`  - ${r.xcadr_tag_ru}`));
  } else {
    console.log('All tags mapped successfully.');
  }

  if (unmappedCols.rows.length > 0) {
    console.log(`\nUnmapped collections requiring admin attention (${unmappedCols.rows.length}):`);
    unmappedCols.rows.forEach((r) => console.log(`  - ${r.xcadr_collection_ru}`));
  } else {
    console.log('All collections mapped successfully.');
  }
}

// --- MAIN ---

async function main() {
  const tagStats  = await processTagMapping();
  const collStats = await processCollectionMapping();
  await logSummary();

  console.log('\n========================================');
  console.log(`Tags    — Mapped: ${tagStats.autoMapped} auto, ${tagStats.manualNeeded} manual needed, ${tagStats.newCreated} new created`);
  console.log(`Collections — Mapped: ${collStats.autoMapped} (${collStats.newCreated} new created)`);
  console.log('========================================');

  await pool.end();
}

main().catch((err) => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
