#!/usr/bin/env node
/**
 * translate-xcadr.js — TMDB + Gemini translation for xcadr_imports
 *
 * Takes rows with status='parsed' and fills title_en, celebrity_name_en,
 * movie_title_en using TMDB API first, then Gemini AI as fallback.
 *
 * Usage:
 *   node xcadr/translate-xcadr.js --limit 50
 */

import axios from 'axios';
import { query, pool } from '../lib/db.js';
import { config } from '../lib/config.js';
import { extractGeminiJSON } from '../lib/gemini.js';

// --- CLI ---
const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg
  ? parseInt(limitArg.includes('=') ? limitArg.split('=')[1] : args[args.indexOf(limitArg) + 1])
  : 50;

// --- CONFIG ---
const TMDB_KEY  = config.ai.tmdbApiKey;
const GEMINI_KEY = config.ai.geminiApiKey;
const TMDB_BASE  = 'https://api.themoviedb.org/3';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

const TMDB_DELAY_MS   = 300;
const GEMINI_DELAY_MS = 1000;

// --- HELPERS ---

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Strip markdown code fences and parse JSON from Gemini response text.
 */
function parseGeminiJson(text) {
  const stripped = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(stripped);
}

// --- TMDB ---

/**
 * Fetch English movie title from TMDB by Russian query.
 * Returns { title_en, tmdb_id } or null.
 */
async function tmdbSearchMovie(titleRu, year) {
  if (!TMDB_KEY) return null;
  try {
    const params = {
      api_key: TMDB_KEY,
      query: titleRu,
      language: 'ru-RU',
      ...(year ? { year } : {}),
    };
    const search = await axios.get(`${TMDB_BASE}/search/movie`, { params, timeout: 8000 });
    const results = search.data.results;
    if (!results || results.length === 0) return null;

    const tmdb_id = results[0].id;

    // Fetch the English title with a second call
    await delay(TMDB_DELAY_MS);
    const detail = await axios.get(`${TMDB_BASE}/movie/${tmdb_id}`, {
      params: { api_key: TMDB_KEY, language: 'en-US' },
      timeout: 8000,
    });
    return { title_en: detail.data.title, tmdb_id };
  } catch {
    return null;
  }
}

/**
 * Fetch English celebrity name from TMDB by Russian query.
 * TMDB person names are typically in Latin regardless of locale.
 * Returns name string or null.
 */
async function tmdbSearchPerson(nameRu) {
  if (!TMDB_KEY) return null;
  try {
    const params = { api_key: TMDB_KEY, query: nameRu, language: 'ru-RU' };
    const res = await axios.get(`${TMDB_BASE}/search/person`, { params, timeout: 8000 });
    const results = res.data.results;
    if (!results || results.length === 0) return null;
    return results[0].name;
  } catch {
    return null;
  }
}

// --- GEMINI ---

/**
 * Use Gemini to translate remaining null fields.
 * Returns { celebrity_en, movie_en, title_en } — any field may be null.
 */
async function geminiTranslate(row) {
  if (!GEMINI_KEY) return null;

  const descLine = row.description_ru ? `\nDescription (Russian): ${row.description_ru}` : '';

  const prompt = `Translate these Russian movie/celebrity names to their correct English equivalents.
These are real movies and real actors/actresses, not fictional.
Do NOT translate literally — use the official international English names.

Celebrity (Russian): ${row.celebrity_name_ru || 'unknown'}
Movie (Russian): ${row.movie_title_ru || 'unknown'}${row.movie_year ? ` (${row.movie_year})` : ''}
Video title (Russian): ${row.title_ru}${descLine}

Return JSON object with exactly these fields:
{
  "celebrity_en": "English name or null if unknown",
  "movie_en": "English movie title or null if unknown",
  "title_en": "English translation of the video title",
  "description_en": "English translation of the description, or null if no description provided"
}`;

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
    console.warn(`  [Gemini] Error: ${err.message}`);
    return null;
  }
}

// --- MAIN ---

async function main() {
  if (!TMDB_KEY && !GEMINI_KEY) {
    console.error('[ERROR] Neither TMDB_API_KEY nor GEMINI_API_KEY configured in .env');
    process.exit(1);
  }

  const rows = await query(
    `SELECT id, title_ru, celebrity_name_ru, movie_title_ru, movie_year, description_ru
     FROM xcadr_imports
     WHERE status = 'parsed'
     ORDER BY created_at ASC
     LIMIT $1`,
    [LIMIT]
  );

  if (rows.rows.length === 0) {
    console.log('No rows with status=parsed found.');
    await pool.end();
    return;
  }

  console.log(`Translating ${rows.rows.length} rows (limit=${LIMIT})...`);

  let translated = 0;
  let tmdbHits   = 0;
  let geminiFallbacks = 0;
  let errors     = 0;

  for (const row of rows.rows) {
    try {
      let title_en          = null;
      let celebrity_name_en = null;
      let movie_title_en    = null;
      let description_en    = null;

      // STEP A — TMDB movie lookup
      if (row.movie_title_ru) {
        await delay(TMDB_DELAY_MS);
        const movieResult = await tmdbSearchMovie(row.movie_title_ru, row.movie_year);
        if (movieResult) {
          movie_title_en = movieResult.title_en;
          tmdbHits++;
        }
      }

      // STEP B — TMDB person lookup
      if (row.celebrity_name_ru) {
        await delay(TMDB_DELAY_MS);
        const personName = await tmdbSearchPerson(row.celebrity_name_ru);
        if (personName) {
          celebrity_name_en = personName;
          tmdbHits++;
        }
      }

      // STEP C — Gemini fallback for anything still null
      if (!celebrity_name_en || !movie_title_en) {
        await delay(GEMINI_DELAY_MS);
        const gemini = await geminiTranslate(row);
        if (gemini) {
          geminiFallbacks++;
          if (!celebrity_name_en && gemini.celebrity_en) {
            celebrity_name_en = gemini.celebrity_en !== 'null' ? gemini.celebrity_en : null;
          }
          if (!movie_title_en && gemini.movie_en) {
            movie_title_en = gemini.movie_en !== 'null' ? gemini.movie_en : null;
          }
          if (!title_en && gemini.title_en) {
            title_en = gemini.title_en;
          }
          if (!description_en && gemini.description_en) {
            description_en = gemini.description_en !== 'null' ? gemini.description_en : null;
          }
        }
      }

      // STEP D — Construct title_en if still missing
      if (!title_en) {
        if (celebrity_name_en && movie_title_en) {
          title_en = `${celebrity_name_en} nude scene - ${movie_title_en}${row.movie_year ? ` (${row.movie_year})` : ''}`;
        } else if (celebrity_name_en) {
          title_en = `${celebrity_name_en} nude scene`;
        } else {
          title_en = row.title_ru; // last resort: keep Russian
        }
      }

      // STEP E — Update database
      await query(
        `UPDATE xcadr_imports
         SET title_en = $1, celebrity_name_en = $2, movie_title_en = $3,
             description_en = $4,
             status = 'translated', updated_at = NOW()
         WHERE id = $5`,
        [title_en, celebrity_name_en, movie_title_en, description_en, row.id]
      );

      translated++;
      process.stdout.write(`\r[${translated + errors}/${rows.rows.length}] ${celebrity_name_en || '?'} — ${movie_title_en || '?'}`.substring(0, 100));
    } catch (err) {
      errors++;
      console.warn(`\n[ERROR] Row ${row.id}: ${err.message}`);
    }
  }

  process.stdout.write('\n');
  console.log('\n========================================');
  console.log(`Translated: ${translated}, TMDB hits: ${tmdbHits}, Gemini fallbacks: ${geminiFallbacks}, Errors: ${errors}`);
  console.log('========================================');

  await pool.end();
}

main().catch((err) => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
