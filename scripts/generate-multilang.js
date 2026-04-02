#!/usr/bin/env node
/**
 * generate-multilang.js — Generate multilingual content for a video
 *
 * NEW: Gemini generates ONLY English content (title, review, seo).
 * LibreTranslate (free, self-hosted) translates to 9 other languages.
 * ~90% cheaper than old approach (Gemini for all 10 languages).
 */

import { config } from './lib/config.js';
import { query } from './lib/db.js';
import { translateToAll } from './lib/translate.js';
import slugify from 'slugify';

const LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];
let GEMINI_API_KEYS = [];
let _keyIdx = 0;
function getApiKey() { return GEMINI_API_KEYS[_keyIdx++ % GEMINI_API_KEYS.length] || ''; }
const GEMINI_MODEL = 'gemini-2.5-flash'; // cheaper model for text generation (no vision needed)

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log('  ' + ts + ' [INFO] [multilang] ' + msg);
}

const args = process.argv.slice(2);
const videoIdArg = args.find(a => a.startsWith('--video-id='));
const videoId = videoIdArg ? videoIdArg.split('=').slice(1).join('=') : null;

if (!videoId) { console.error('Usage: node generate-multilang.js --video-id=UUID'); process.exit(1); }

async function main() {
  // Load API keys from DB
  try {
    const { rows } = await query(`SELECT value FROM settings WHERE key = 'gemini_api_key' LIMIT 1`);
    if (rows[0]?.value) {
      const dbKeys = rows[0].value.split(',').map(k => k.trim()).filter(Boolean);
      if (dbKeys.length > 0) { GEMINI_API_KEYS = dbKeys; log(`Loaded ${dbKeys.length} key(s) from DB`); }
    }
  } catch {}
  if (GEMINI_API_KEYS.length === 0) { console.error('GEMINI_API_KEY not set in DB'); process.exit(1); }

  const { rows: [video] } = await query(
    "SELECT v.id, v.original_title, v.title, v.ai_raw_response, v.ai_tags, v.duration_seconds, " +
    "(SELECT string_agg(c.name, ', ') FROM celebrities c JOIN video_celebrities vc ON vc.celebrity_id = c.id WHERE vc.video_id = v.id) AS celebrities, " +
    "(SELECT m.title FROM movies m JOIN movie_scenes ms ON ms.movie_id = m.id WHERE ms.video_id = v.id LIMIT 1) AS movie_title, " +
    "(SELECT m.year FROM movies m JOIN movie_scenes ms ON ms.movie_id = m.id WHERE ms.video_id = v.id LIMIT 1) AS movie_year " +
    "FROM videos v WHERE v.id = $1",
    [videoId]
  );
  if (!video) { console.error('Video not found: ' + videoId); process.exit(1); }

  const title = video.original_title || (video.title && video.title.en) || '';
  const celebs = video.celebrities || '';
  const movie = video.movie_title ? video.movie_title + ' (' + (video.movie_year || '') + ')' : '';
  const tags = video.ai_tags || [];

  let aiDesc = '';
  try {
    if (video.ai_raw_response) {
      const raw = typeof video.ai_raw_response === 'string' ? JSON.parse(video.ai_raw_response) : video.ai_raw_response;
      aiDesc = raw.description_en || '';
    }
  } catch {}

  // === STEP 1: Gemini generates ENGLISH ONLY (title, review, seo) ===
  const prompt = 'You are a content writer for a celebrity nude scenes database.\n\n' +
    'Video metadata:\n' +
    '- Original title: "' + title + '"\n' +
    '- Celebrities: ' + (celebs || 'unknown') + '\n' +
    '- Movie/Show: ' + (movie || 'unknown') + '\n' +
    '- Tags: [' + tags.join(', ') + ']\n' +
    '- AI Description: ' + (aiDesc || 'none') + '\n\n' +
    'Generate ENGLISH content only:\n' +
    '1. title — Short compelling title (40-70 chars). "Celebrity + action + movie (year)".\n' +
    '2. review — 2-3 sentences as film connoisseur. Mention actress, scene context, movie.\n' +
    '3. seo_title — SEO title max 60 chars.\n' +
    '4. seo_description — Meta description max 160 chars.\n\n' +
    'Return ONLY valid JSON:\n' +
    '{"title":"...","review":"...","seo_title":"...","seo_description":"..."}';

  log('Calling Gemini ' + GEMINI_MODEL + ' (EN only)...');

  let enResult = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    const apiKey = getApiKey();
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) {
        log('Gemini error ' + resp.status);
        if (attempt < 2) continue;
        throw new Error('Gemini API ' + resp.status);
      }
      const data = await resp.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
      if (!text) { log('Empty response'); if (attempt < 2) continue; throw new Error('Empty'); }
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      enResult = JSON.parse(cleaned);
      break;
    } catch (err) {
      log('Error: ' + err.message);
      if (attempt >= 2) throw err;
    }
  }

  if (!enResult || !enResult.title) throw new Error('Failed to generate EN content');

  log('EN title: "' + enResult.title + '"');
  log('EN review: "' + (enResult.review || '').substring(0, 60) + '..."');

  // === STEP 2: LibreTranslate translates EN → 9 languages (FREE) ===
  log('Translating to 9 languages via LibreTranslate...');

  const [titles, reviews, seoTitles, seoDescs] = await Promise.all([
    translateToAll(enResult.title),
    translateToAll(enResult.review),
    translateToAll(enResult.seo_title || enResult.title),
    translateToAll(enResult.seo_description || ''),
  ]);

  // Slug: one English slug for all locales
  const enSlug = slugify(enResult.title, { lower: true, strict: true, locale: 'en' }).substring(0, 200);
  const slugs = {};
  for (const loc of LOCALES) slugs[loc] = enSlug;

  log('Generated content for ' + LOCALES.length + ' locales');
  log('RU title: "' + (titles.ru || '') + '"');

  // === STEP 3: Save to DB ===
  await query(
    "UPDATE videos SET title = $2::jsonb, slug = $3::jsonb, review = $4::jsonb, seo_title = $5::jsonb, seo_description = $6::jsonb, updated_at = NOW() WHERE id = $1",
    [videoId, JSON.stringify(titles), JSON.stringify(slugs), JSON.stringify(reviews), JSON.stringify(seoTitles), JSON.stringify(seoDescs)]
  );
  log('DB updated: title, slug, review, seo_title, seo_description');
}

main().catch(err => { console.error('[multilang] Fatal: ' + err.message); process.exit(1); });
