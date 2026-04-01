#!/usr/bin/env node
/**
 * enrich-tmdb-bulk.js — Bulk TMDB enrichment for celebrities and movies
 *
 * Phase 1: Celebrities/movies with tmdb_id > 0 but missing photo/poster (direct API by ID)
 * Phase 2: Celebrities/movies with tmdb_id IS NULL (search API by name)
 * Phase 3: XCADR fallback for remaining (via Contabo WARP proxy)
 *
 * Usage:
 *   node enrich-tmdb-bulk.js --phase=1                    # tmdb_id known, fetch details
 *   node enrich-tmdb-bulk.js --phase=2                    # search TMDB by name
 *   node enrich-tmdb-bulk.js --phase=1 --type=celebrities # only celebrities
 *   node enrich-tmdb-bulk.js --phase=1 --type=movies      # only movies
 *   node enrich-tmdb-bulk.js --phase=1 --dry-run          # don't write to DB
 *   node enrich-tmdb-bulk.js --phase=1 --limit=50         # process max 50
 *
 * Rate limits: TMDB 40 req/10s, Gemini 1 req/s
 * Safe: never overwrites existing data, never changes slugs, never deletes
 */

import { config } from './lib/config.js';
import { query, pool } from './lib/db.js';
import axios from 'axios';

// ============================================================
// CLI args
// ============================================================
function getArg(name) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : '';
}
const PHASE = parseInt(getArg('phase')) || 1;
const TYPE = getArg('type') || 'all'; // 'celebrities', 'movies', 'all'
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(getArg('limit')) || 0;

// ============================================================
// Constants
// ============================================================
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/original';
const LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];
const BIRTH_COUNTRY_MAP = {
  'US': 'US', 'USA': 'US', 'United States': 'US', 'U.S.A.': 'US', 'America': 'US',
  'UK': 'GB', 'United Kingdom': 'GB', 'England': 'GB', 'Scotland': 'GB', 'Wales': 'GB', 'Britain': 'GB',
  'Russia': 'RU', 'Russian Federation': 'RU', 'USSR': 'RU', 'Soviet Union': 'RU',
  'Germany': 'DE', 'France': 'FR', 'Spain': 'ES', 'Italy': 'IT', 'Canada': 'CA',
  'Australia': 'AU', 'Japan': 'JP', 'China': 'CN', 'South Korea': 'KR', 'India': 'IN',
  'Brazil': 'BR', 'Mexico': 'MX', 'Argentina': 'AR', 'Colombia': 'CO',
  'Sweden': 'SE', 'Norway': 'NO', 'Denmark': 'DK', 'Finland': 'FI', 'Iceland': 'IS',
  'Poland': 'PL', 'Czech Republic': 'CZ', 'Czechia': 'CZ', 'Hungary': 'HU', 'Romania': 'RO',
  'Ukraine': 'UA', 'Belarus': 'BY', 'Slovakia': 'SK', 'Croatia': 'HR', 'Serbia': 'RS',
  'Netherlands': 'NL', 'Belgium': 'BE', 'Switzerland': 'CH', 'Austria': 'AT',
  'Portugal': 'PT', 'Greece': 'GR', 'Turkey': 'TR', 'Ireland': 'IE', 'Israel': 'IL',
  'New Zealand': 'NZ', 'South Africa': 'ZA', 'Thailand': 'TH', 'Philippines': 'PH',
  'Indonesia': 'ID', 'Malaysia': 'MY', 'Singapore': 'SG', 'Taiwan': 'TW',
  'Cuba': 'CU', 'Chile': 'CL', 'Peru': 'PE', 'Venezuela': 'VE', 'Puerto Rico': 'PR',
};

// ============================================================
// TMDB API
// ============================================================
let TMDB_KEY = '';
let _tmdbRequestCount = 0;
let _tmdbWindowStart = Date.now();

async function loadTmdbKey() {
  const { rows } = await query(`SELECT value FROM settings WHERE key = 'tmdb_api_key' LIMIT 1`);
  TMDB_KEY = rows[0]?.value || config.ai?.tmdbApiKey || '';
  if (!TMDB_KEY) { console.error('FATAL: TMDB API key not found'); process.exit(1); }
  console.log('TMDB key loaded');
}

async function tmdbThrottle() {
  _tmdbRequestCount++;
  if (_tmdbRequestCount >= 38) { // stay under 40/10s
    const elapsed = Date.now() - _tmdbWindowStart;
    if (elapsed < 10000) {
      const wait = 10000 - elapsed + 500;
      await new Promise(r => setTimeout(r, wait));
    }
    _tmdbRequestCount = 0;
    _tmdbWindowStart = Date.now();
  }
}

async function tmdbGet(path) {
  await tmdbThrottle();
  try {
    const res = await axios.get(`https://api.themoviedb.org/3${path}`, {
      headers: { Authorization: `Bearer ${TMDB_KEY}` },
      timeout: 10000,
    });
    return res.data;
  } catch (e) {
    if (e.response?.status === 429) {
      console.warn('  TMDB rate limited, waiting 15s...');
      await new Promise(r => setTimeout(r, 15000));
      _tmdbRequestCount = 0;
      _tmdbWindowStart = Date.now();
      return tmdbGet(path); // retry once
    }
    if (e.response?.status === 404) return null;
    throw e;
  }
}

// ============================================================
// Gemini API for translations
// ============================================================
let GEMINI_KEYS = [];
let _geminiIdx = 0;

async function loadGeminiKeys() {
  const { rows } = await query(`SELECT value FROM settings WHERE key = 'gemini_api_key' LIMIT 1`);
  if (rows[0]?.value) {
    GEMINI_KEYS = rows[0].value.split(',').map(k => k.trim()).filter(Boolean);
  }
  console.log(`Gemini keys loaded: ${GEMINI_KEYS.length}`);
}

function getGeminiKey() { return GEMINI_KEYS[_geminiIdx++ % GEMINI_KEYS.length] || ''; }

async function geminiTranslate(text, targetLang) {
  if (!text || GEMINI_KEYS.length === 0) return '';
  const key = getGeminiKey();
  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        contents: [{ parts: [{ text: `Translate the following text to ${targetLang}. Return ONLY the translated text, nothing else:\n\n${text}` }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.1 },
      },
      { timeout: 15000 }
    );
    const parts = res.data?.candidates?.[0]?.content?.parts || [];
    return parts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  } catch (e) {
    console.warn(`  Gemini translate error: ${e.message}`);
    return '';
  }
}

async function translateBio(enText) {
  if (!enText) return {};
  const bio = { en: enText };
  const langNames = { ru: 'Russian', de: 'German', fr: 'French', es: 'Spanish', pt: 'Portuguese', it: 'Italian', pl: 'Polish', nl: 'Dutch', tr: 'Turkish' };
  for (const [code, langName] of Object.entries(langNames)) {
    bio[code] = await geminiTranslate(enText, langName);
    await new Promise(r => setTimeout(r, 1100)); // 1 req/s
  }
  return bio;
}

// ============================================================
// Nationality extraction
// ============================================================
function extractNationality(placeOfBirth) {
  if (!placeOfBirth) return null;
  const parts = placeOfBirth.split(',').map(s => s.trim());
  const lastPart = parts[parts.length - 1];
  return BIRTH_COUNTRY_MAP[lastPart] || null;
}

// ============================================================
// Stats
// ============================================================
const stats = {
  celebs: { total: 0, tmdb_found: 0, tmdb_photo: 0, tmdb_bio: 0, skipped: 0, errors: 0 },
  movies: { total: 0, tmdb_found: 0, tmdb_poster: 0, tmdb_desc: 0, skipped: 0, errors: 0 },
};

function logProgress(type, current, total) {
  const s = stats[type];
  if (type === 'celebs') {
    console.log(`Celebrities: ${current}/${total} | TMDB found: ${s.tmdb_found} | Photos: ${s.tmdb_photo} | Bios: ${s.tmdb_bio} | Skipped: ${s.skipped} | Errors: ${s.errors}`);
  } else {
    console.log(`Movies: ${current}/${total} | TMDB found: ${s.tmdb_found} | Posters: ${s.tmdb_poster} | Descs: ${s.tmdb_desc} | Skipped: ${s.skipped} | Errors: ${s.errors}`);
  }
}

// ============================================================
// Phase 1: Enrich by known tmdb_id
// ============================================================

async function enrichCelebById(celeb) {
  const data = await tmdbGet(`/person/${celeb.tmdb_id}?language=en-US`);
  if (!data) { stats.celebs.skipped++; return; }
  stats.celebs.tmdb_found++;

  const updates = [];
  const values = [];
  let idx = 1;

  // Photo
  if (!celeb.photo_url && data.profile_path) {
    updates.push(`photo_url = $${idx++}`);
    values.push(TMDB_IMAGE_BASE + data.profile_path);
    stats.celebs.tmdb_photo++;
  }

  // Birth date
  if (!celeb.birth_date && data.birthday) {
    updates.push(`birth_date = $${idx++}`);
    values.push(data.birthday);
  }

  // Nationality
  if (!celeb.nationality && data.place_of_birth) {
    const nat = extractNationality(data.place_of_birth);
    if (nat) {
      updates.push(`nationality = $${idx++}`);
      values.push(nat);
    }
  }

  // Bio — translate to 10 languages
  if ((!celeb.bio || Object.keys(celeb.bio).length === 0 || !celeb.bio.en) && data.biography) {
    const shortBio = data.biography.substring(0, 1500); // keep reasonable
    const bio = await translateBio(shortBio);
    if (Object.keys(bio).length > 1) {
      updates.push(`bio = $${idx++}`);
      values.push(JSON.stringify(bio));
      stats.celebs.tmdb_bio++;
    }
  }

  if (updates.length === 0) { stats.celebs.skipped++; return; }
  if (DRY_RUN) { console.log(`  [DRY-RUN] Would update celeb ${celeb.id} (${celeb.name}): ${updates.join(', ')}`); return; }

  values.push(celeb.id);
  await query(`UPDATE celebrities SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);
}

async function enrichMovieById(movie) {
  let data = await tmdbGet(`/movie/${movie.tmdb_id}?language=en-US`);
  // If movie not found, try TV
  if (!data) data = await tmdbGet(`/tv/${movie.tmdb_id}?language=en-US`);
  if (!data) { stats.movies.skipped++; return; }
  stats.movies.tmdb_found++;

  const updates = [];
  const values = [];
  let idx = 1;

  // Poster
  if (!movie.poster_url && data.poster_path) {
    updates.push(`poster_url = $${idx++}`);
    values.push(TMDB_IMAGE_BASE + data.poster_path);
    stats.movies.tmdb_poster++;
  }

  // Year
  const releaseDate = data.release_date || data.first_air_date;
  if (!movie.year && releaseDate) {
    updates.push(`year = $${idx++}`);
    values.push(parseInt(releaseDate.substring(0, 4)));
  }

  // Countries
  const countries = (data.production_countries || data.origin_country || [])
    .map(c => c.iso_3166_1 || c).filter(Boolean).slice(0, 5);
  if ((!movie.countries || movie.countries.length === 0) && countries.length > 0) {
    updates.push(`countries = $${idx++}`);
    values.push(countries);
  }

  // Genres
  const genres = (data.genres || []).map(g => g.name).filter(Boolean);
  if ((!movie.genres || movie.genres.length === 0) && genres.length > 0) {
    updates.push(`genres = $${idx++}`);
    values.push(genres);
  }

  // Studio
  const studio = (data.production_companies || [])[0]?.name;
  if (!movie.studio && studio) {
    updates.push(`studio = $${idx++}`);
    values.push(studio);
  }

  // Description — translate to 10 languages
  const overview = data.overview;
  if ((!movie.description || Object.keys(movie.description).length === 0 || !movie.description.en) && overview) {
    const desc = await translateBio(overview.substring(0, 1500));
    if (Object.keys(desc).length > 1) {
      updates.push(`description = $${idx++}`);
      values.push(JSON.stringify(desc));
      stats.movies.tmdb_desc++;
    }
  }

  if (updates.length === 0) { stats.movies.skipped++; return; }
  if (DRY_RUN) { console.log(`  [DRY-RUN] Would update movie ${movie.id} (${movie.title}): ${updates.join(', ')}`); return; }

  values.push(movie.id);
  await query(`UPDATE movies SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);
}

// ============================================================
// Phase 2: Search TMDB by name
// ============================================================

async function searchAndEnrichCeleb(celeb) {
  // Search TMDB
  const searchName = encodeURIComponent(celeb.name);
  const data = await tmdbGet(`/search/person?query=${searchName}&language=en-US`);
  if (!data?.results?.length) { stats.celebs.skipped++; return; }

  // Find best match — validate by birthday if available
  let best = null;
  for (const result of data.results.slice(0, 5)) {
    const detail = await tmdbGet(`/person/${result.id}?language=en-US`);
    if (!detail) continue;

    // Birthday validation
    if (celeb.birth_date && detail.birthday) {
      const dbYear = new Date(celeb.birth_date).getFullYear();
      const tmdbYear = parseInt(detail.birthday.substring(0, 4));
      if (Math.abs(dbYear - tmdbYear) > 1) {
        console.log(`  Skipped (birthday mismatch): "${celeb.name}" DB:${dbYear} vs TMDB:${tmdbYear} (${detail.name})`);
        continue;
      }
    }

    // If name matches closely, use it
    if (detail.name.toLowerCase() === celeb.name.toLowerCase() ||
        result.name.toLowerCase() === celeb.name.toLowerCase()) {
      best = detail;
      break;
    }
    // First result with photo as fallback
    if (!best && detail.profile_path) best = detail;
  }

  if (!best) { stats.celebs.skipped++; return; }
  stats.celebs.tmdb_found++;

  // Update tmdb_id first
  if (!celeb.tmdb_id || celeb.tmdb_id <= 0) {
    if (!DRY_RUN) await query(`UPDATE celebrities SET tmdb_id = $1 WHERE id = $2`, [best.id, celeb.id]);
  }

  // Reuse enrichById with the TMDB data
  const fakeCeleb = { ...celeb, tmdb_id: best.id };
  await enrichCelebById(fakeCeleb);
  // Undo double-count from enrichCelebById
  stats.celebs.tmdb_found--;
}

async function searchAndEnrichMovie(movie) {
  const searchTitle = encodeURIComponent(movie.title);
  let yearParam = movie.year ? `&year=${movie.year}` : '';

  // Try movie search
  let data = await tmdbGet(`/search/movie?query=${searchTitle}${yearParam}&language=en-US`);
  let isTV = false;

  // Fallback to TV
  if (!data?.results?.length) {
    yearParam = movie.year ? `&first_air_date_year=${movie.year}` : '';
    data = await tmdbGet(`/search/tv?query=${searchTitle}${yearParam}&language=en-US`);
    isTV = true;
  }

  if (!data?.results?.length) { stats.movies.skipped++; return; }

  // Find best match — validate by year
  let best = null;
  for (const result of data.results.slice(0, 5)) {
    const releaseDate = result.release_date || result.first_air_date || '';
    const tmdbYear = releaseDate ? parseInt(releaseDate.substring(0, 4)) : null;

    if (movie.year && tmdbYear && Math.abs(movie.year - tmdbYear) > 1) {
      console.log(`  Skipped (year mismatch): "${movie.title}" DB:${movie.year} vs TMDB:${tmdbYear}`);
      continue;
    }

    if (!best && result.poster_path) { best = result; break; }
    if (!best) best = result;
  }

  if (!best) { stats.movies.skipped++; return; }
  stats.movies.tmdb_found++;

  const tmdbId = best.id;

  // Update tmdb_id
  if (!movie.tmdb_id || movie.tmdb_id <= 0) {
    if (!DRY_RUN) await query(`UPDATE movies SET tmdb_id = $1 WHERE id = $2`, [tmdbId, movie.id]);
  }

  // Get full details
  const fakeMovie = { ...movie, tmdb_id: tmdbId };
  await enrichMovieById(fakeMovie);
  stats.movies.tmdb_found--;
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('═'.repeat(60));
  console.log(`TMDB Bulk Enrichment — Phase ${PHASE} — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('═'.repeat(60));

  await loadTmdbKey();
  await loadGeminiKeys();

  // ---- Phase 1: Known tmdb_id ----
  if (PHASE === 1) {
    if (TYPE === 'all' || TYPE === 'celebrities') {
      console.log('\n▶ Celebrities with tmdb_id > 0 but no photo...');
      const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
      const { rows: celebs } = await query(`
        SELECT id, name, tmdb_id, photo_url, birth_date, nationality, bio
        FROM celebrities
        WHERE (photo_url IS NULL OR photo_url = '') AND tmdb_id > 0
        ORDER BY videos_count DESC
        ${limitClause}
      `);
      console.log(`Found ${celebs.length} celebrities to enrich`);
      stats.celebs.total = celebs.length;

      for (let i = 0; i < celebs.length; i++) {
        try {
          await enrichCelebById(celebs[i]);
        } catch (e) {
          console.error(`  Error enriching celeb ${celebs[i].id} (${celebs[i].name}): ${e.message}`);
          stats.celebs.errors++;
        }
        if ((i + 1) % 100 === 0) logProgress('celebs', i + 1, celebs.length);
      }
      logProgress('celebs', celebs.length, celebs.length);
    }

    if (TYPE === 'all' || TYPE === 'movies') {
      console.log('\n▶ Movies with tmdb_id > 0 but no poster...');
      const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
      const { rows: movies } = await query(`
        SELECT id, title, tmdb_id, poster_url, year, countries, genres, studio, description
        FROM movies
        WHERE (poster_url IS NULL OR poster_url = '') AND tmdb_id > 0
        ORDER BY scenes_count DESC
        ${limitClause}
      `);
      console.log(`Found ${movies.length} movies to enrich`);
      stats.movies.total = movies.length;

      for (let i = 0; i < movies.length; i++) {
        try {
          await enrichMovieById(movies[i]);
        } catch (e) {
          console.error(`  Error enriching movie ${movies[i].id} (${movies[i].title}): ${e.message}`);
          stats.movies.errors++;
        }
        if ((i + 1) % 100 === 0) logProgress('movies', i + 1, movies.length);
      }
      logProgress('movies', movies.length, movies.length);
    }
  }

  // ---- Phase 2: Search by name ----
  if (PHASE === 2) {
    if (TYPE === 'all' || TYPE === 'celebrities') {
      console.log('\n▶ Celebrities with tmdb_id IS NULL — searching TMDB...');
      const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
      const { rows: celebs } = await query(`
        SELECT id, name, tmdb_id, photo_url, birth_date, nationality, bio
        FROM celebrities
        WHERE (photo_url IS NULL OR photo_url = '') AND (tmdb_id IS NULL OR tmdb_id = 0)
        ORDER BY videos_count DESC
        ${limitClause}
      `);
      console.log(`Found ${celebs.length} celebrities to search`);
      stats.celebs.total = celebs.length;

      for (let i = 0; i < celebs.length; i++) {
        try {
          await searchAndEnrichCeleb(celebs[i]);
        } catch (e) {
          console.error(`  Error searching celeb ${celebs[i].id} (${celebs[i].name}): ${e.message}`);
          stats.celebs.errors++;
        }
        if ((i + 1) % 50 === 0) logProgress('celebs', i + 1, celebs.length);
      }
      logProgress('celebs', celebs.length, celebs.length);
    }

    if (TYPE === 'all' || TYPE === 'movies') {
      console.log('\n▶ Movies with tmdb_id IS NULL — searching TMDB...');
      const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
      const { rows: movies } = await query(`
        SELECT id, title, tmdb_id, poster_url, year, countries, genres, studio, description
        FROM movies
        WHERE (poster_url IS NULL OR poster_url = '') AND (tmdb_id IS NULL OR tmdb_id = 0)
        ORDER BY scenes_count DESC
        ${limitClause}
      `);
      console.log(`Found ${movies.length} movies to search`);
      stats.movies.total = movies.length;

      for (let i = 0; i < movies.length; i++) {
        try {
          await searchAndEnrichMovie(movies[i]);
        } catch (e) {
          console.error(`  Error searching movie ${movies[i].id} (${movies[i].title}): ${e.message}`);
          stats.movies.errors++;
        }
        if ((i + 1) % 50 === 0) logProgress('movies', i + 1, movies.length);
      }
      logProgress('movies', movies.length, movies.length);
    }
  }

  // ---- Final stats ----
  console.log('\n' + '═'.repeat(60));
  console.log('FINAL STATS');
  console.log('═'.repeat(60));

  // Check remaining NULLs
  const { rows: [celebNull] } = await query(`SELECT COUNT(*) as cnt FROM celebrities WHERE photo_url IS NULL OR photo_url = ''`);
  const { rows: [movieNull] } = await query(`SELECT COUNT(*) as cnt FROM movies WHERE poster_url IS NULL OR poster_url = ''`);
  const { rows: [celebRu] } = await query(`SELECT COUNT(*) as cnt FROM celebrities WHERE name ~ '[а-яА-Я]'`);
  const { rows: [movieRu] } = await query(`SELECT COUNT(*) as cnt FROM movies WHERE title ~ '[а-яА-Я]'`);

  console.log(`Celebrities without photo: ${celebNull.cnt}`);
  console.log(`Movies without poster: ${movieNull.cnt}`);
  console.log(`Celebrities with Russian names: ${celebRu.cnt}`);
  console.log(`Movies with Russian titles: ${movieRu.cnt}`);

  await pool.end();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
