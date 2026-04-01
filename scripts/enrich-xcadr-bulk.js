#!/usr/bin/env node
/**
 * enrich-xcadr-bulk.js — XCADR enrichment for celebrities and movies
 *
 * For xcadr-sourced content: parse XCADR pages → photo/poster → BunnyCDN, bio/desc → Gemini translate
 * Runs on AbeloHost, fetches XCADR pages via SSH to Contabo (WARP SOCKS5 proxy)
 *
 * Usage:
 *   node enrich-xcadr-bulk.js --type=celebrities          # enrich celebs
 *   node enrich-xcadr-bulk.js --type=movies               # enrich movies
 *   node enrich-xcadr-bulk.js --type=celebrities --dry-run
 *   node enrich-xcadr-bulk.js --type=celebrities --limit=10
 */

import { query, pool } from './lib/db.js';
import { config } from './lib/config.js';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import axios from 'axios';

const execFile = promisify(execFileCb);

// CLI
function getArg(name) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : '';
}
const TYPE = getArg('type') || 'celebrities';
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(getArg('limit')) || 0;

const LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];
const BUNNY_STORAGE_KEY = config.bunny?.storageKey || process.env.BUNNY_STORAGE_KEY || '';
const BUNNY_STORAGE_URL = 'https://storage.bunnycdn.com/celebskin-media';
const BUNNY_CDN_URL = 'https://celebskin-cdn.b-cdn.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CONTABO = 'root@161.97.142.117';

// ============================================================
// Fetch XCADR page via Contabo WARP
// ============================================================
async function fetchXcadrPage(url) {
  try {
    const { stdout } = await execFile('ssh', [
      CONTABO,
      `curl -s --socks5-hostname 127.0.0.1:40000 -H "User-Agent: ${UA}" --max-time 15 "${url}"`
    ], { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    console.warn(`  Fetch failed: ${url} — ${e.message.substring(0, 100)}`);
    return '';
  }
}

// ============================================================
// Upload image to BunnyCDN
// ============================================================
async function uploadImageToBunny(imageUrl, remotePath) {
  if (!BUNNY_STORAGE_KEY) { console.warn('  No BUNNY_STORAGE_KEY, skip upload'); return null; }
  try {
    // Download image via Contabo WARP
    const tmpPath = join(tmpdir(), `xcadr-img-${Date.now()}.jpg`);
    await execFile('ssh', [
      CONTABO,
      `curl -s --socks5-hostname 127.0.0.1:40000 -H "User-Agent: ${UA}" --max-time 30 -o /tmp/xcadr-dl-img.jpg "${imageUrl}" && cat /tmp/xcadr-dl-img.jpg`
    ], { timeout: 45000, maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' })
      .then(({ stdout }) => writeFile(tmpPath, stdout));

    // Upload to Bunny
    const fileBuffer = await import('fs').then(fs => fs.readFileSync(tmpPath));
    if (fileBuffer.length < 1000) { await unlink(tmpPath).catch(() => {}); return null; } // too small, probably error

    await axios.put(`${BUNNY_STORAGE_URL}/${remotePath}`, fileBuffer, {
      headers: { 'AccessKey': BUNNY_STORAGE_KEY, 'Content-Type': 'image/jpeg' },
      timeout: 30000,
    });
    await unlink(tmpPath).catch(() => {});
    return `${BUNNY_CDN_URL}/${remotePath}`;
  } catch (e) {
    console.warn(`  Upload failed: ${e.message.substring(0, 100)}`);
    return null;
  }
}

// ============================================================
// Gemini translate
// ============================================================
let GEMINI_KEYS = [];
let _gIdx = 0;

async function loadGeminiKeys() {
  const { rows } = await query(`SELECT value FROM settings WHERE key = 'gemini_api_key' LIMIT 1`);
  if (rows[0]?.value) GEMINI_KEYS = rows[0].value.split(',').map(k => k.trim()).filter(Boolean);
  console.log(`Gemini keys: ${GEMINI_KEYS.length}`);
}

async function geminiTranslate(text, targetLang) {
  if (!text || GEMINI_KEYS.length === 0) return '';
  const key = GEMINI_KEYS[_gIdx++ % GEMINI_KEYS.length];
  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        contents: [{ parts: [{ text: `Translate to ${targetLang}. Return ONLY translated text:\n\n${text}` }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.1 },
      },
      { timeout: 15000 }
    );
    return (res.data?.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  } catch { return ''; }
}

async function translateToAllLangs(ruText) {
  if (!ruText) return {};
  const result = { ru: ruText };
  // First translate to English
  result.en = await geminiTranslate(ruText, 'English');
  await new Promise(r => setTimeout(r, 1100));
  // Then other languages from English (better quality)
  const langs = { de: 'German', fr: 'French', es: 'Spanish', pt: 'Portuguese', it: 'Italian', pl: 'Polish', nl: 'Dutch', tr: 'Turkish' };
  for (const [code, name] of Object.entries(langs)) {
    result[code] = await geminiTranslate(result.en || ruText, name);
    await new Promise(r => setTimeout(r, 1100));
  }
  return result;
}

// ============================================================
// Parse XCADR celebrity page
// ============================================================
function parseCelebPage(html) {
  if (!html || html.length < 500) return null;

  // Birthday: <meta itemprop="birthDate" content="1987-06-16" />
  const birthMatch = html.match(/birthDate[^>]*content="(\d{4}-\d{2}-\d{2})"/);
  const birthday = birthMatch ? birthMatch[1] : null;

  // Photo: contents/models/{id}/{filename}.jpg
  const photoMatch = html.match(/src="(https:\/\/xcadr\.online\/contents\/models\/[^"]+\.jpg)"/);
  const photoUrl = photoMatch ? photoMatch[1] : null;

  // Bio: itemprop="description">text
  const bioMatch = html.match(/itemprop="description">([^<]+)/);
  const bioRu = bioMatch ? bioMatch[1].trim() : null;

  // Description meta fallback
  let descRu = null;
  if (!bioRu) {
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
    descRu = descMatch ? descMatch[1].trim() : null;
  }

  return { birthday, photoUrl, bioRu: bioRu || descRu };
}

// ============================================================
// Parse XCADR movie page
// ============================================================
function parseMoviePage(html) {
  if (!html || html.length < 500) return null;

  // Poster: contents/movies/{id}/{filename}.jpg or og:image
  const posterMatch = html.match(/src="(https:\/\/xcadr\.online\/contents\/movies\/[^"]+\.jpg)"/) ||
                      html.match(/og:image[^>]*content="(https:\/\/xcadr\.online\/[^"]+\.jpg)"/);
  const posterUrl = posterMatch ? posterMatch[1] : null;

  // Description
  const descMatch = html.match(/itemprop="description">([^<]+)/) ||
                    html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
  const descRu = descMatch ? descMatch[1].trim() : null;

  // Year from content
  const yearMatch = html.match(/\((\d{4})\)/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;

  return { posterUrl, descRu, year };
}

// ============================================================
// Stats
// ============================================================
const stats = { total: 0, xcadr_found: 0, photos: 0, bios: 0, skipped: 0, errors: 0 };

function logProgress(current, total) {
  console.log(`${TYPE}: ${current}/${total} | XCADR found: ${stats.xcadr_found} | Photos/Posters: ${stats.photos} | Bios/Descs: ${stats.bios} | Skipped: ${stats.skipped} | Errors: ${stats.errors}`);
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('═'.repeat(60));
  console.log(`XCADR Bulk Enrichment — ${TYPE} — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('═'.repeat(60));

  await loadGeminiKeys();

  if (TYPE === 'celebrities') {
    const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
    const { rows } = await query(`
      SELECT DISTINCT ON (c.id) c.id, c.name, c.photo_url, c.birth_date, c.nationality, c.bio,
        xi.celeb_xcadr_slug, xi.celebrity_name_ru
      FROM celebrities c
      JOIN video_celebrities vc ON vc.celebrity_id = c.id
      JOIN videos v ON v.id = vc.video_id
      JOIN xcadr_imports xi ON xi.xcadr_url = v.source_url
      WHERE (c.photo_url IS NULL OR c.photo_url = '')
        AND v.source_url LIKE '%xcadr%'
        AND xi.celeb_xcadr_slug IS NOT NULL AND xi.celeb_xcadr_slug != ''
      ORDER BY c.id, xi.updated_at DESC
      ${limitClause}
    `);
    console.log(`Found ${rows.length} celebrities with XCADR slugs`);
    stats.total = rows.length;

    for (let i = 0; i < rows.length; i++) {
      const celeb = rows[i];
      try {
        const url = `https://xcadr.online/celebs/${celeb.celeb_xcadr_slug}/`;
        const html = await fetchXcadrPage(url);
        const data = parseCelebPage(html);

        if (!data) { stats.skipped++; continue; }
        stats.xcadr_found++;

        const updates = [];
        const values = [];
        let idx = 1;

        // Photo → BunnyCDN
        if (!celeb.photo_url && data.photoUrl) {
          const cdnPath = `celebrities/${celeb.id}/photo.jpg`;
          const cdnUrl = DRY_RUN ? `[CDN:${cdnPath}]` : await uploadImageToBunny(data.photoUrl, cdnPath);
          if (cdnUrl) {
            updates.push(`photo_url = $${idx++}`);
            values.push(cdnUrl);
            stats.photos++;
          }
        }

        // Birthday
        if (!celeb.birth_date && data.birthday) {
          updates.push(`birth_date = $${idx++}`);
          values.push(data.birthday);
        }

        // Bio → translate RU → all langs
        if ((!celeb.bio || !celeb.bio.en) && data.bioRu) {
          const bio = DRY_RUN ? { ru: data.bioRu } : await translateToAllLangs(data.bioRu.substring(0, 1500));
          if (Object.keys(bio).length > 0) {
            updates.push(`bio = $${idx++}`);
            values.push(JSON.stringify(bio));
            stats.bios++;
          }
        }

        if (updates.length === 0) { stats.skipped++; continue; }
        if (DRY_RUN) {
          console.log(`  [DRY-RUN] ${celeb.name} (${celeb.celeb_xcadr_slug}): ${updates.join(', ')}`);
          continue;
        }

        values.push(celeb.id);
        await query(`UPDATE celebrities SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);

        // XCADR rate limit: 1 req / 2s
        await new Promise(r => setTimeout(r, 2000));

      } catch (e) {
        console.error(`  Error: celeb ${celeb.id} (${celeb.name}): ${e.message.substring(0, 150)}`);
        stats.errors++;
      }

      if ((i + 1) % 50 === 0) logProgress(i + 1, rows.length);
    }
    logProgress(rows.length, rows.length);

  } else if (TYPE === 'movies') {
    const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
    const { rows } = await query(`
      SELECT DISTINCT ON (m.id) m.id, m.title, m.poster_url, m.year, m.description,
        xi.movie_xcadr_slug, xi.movie_title_ru
      FROM movies m
      JOIN movie_scenes ms ON ms.movie_id = m.id
      JOIN videos v ON v.id = ms.video_id
      JOIN xcadr_imports xi ON xi.xcadr_url = v.source_url
      WHERE (m.poster_url IS NULL OR m.poster_url = '')
        AND v.source_url LIKE '%xcadr%'
        AND xi.movie_xcadr_slug IS NOT NULL AND xi.movie_xcadr_slug != ''
      ORDER BY m.id, xi.updated_at DESC
      ${limitClause}
    `);
    console.log(`Found ${rows.length} movies with XCADR slugs`);
    stats.total = rows.length;

    for (let i = 0; i < rows.length; i++) {
      const movie = rows[i];
      try {
        const url = `https://xcadr.online/movies/${movie.movie_xcadr_slug}/`;
        const html = await fetchXcadrPage(url);
        const data = parseMoviePage(html);

        if (!data) { stats.skipped++; continue; }
        stats.xcadr_found++;

        const updates = [];
        const values = [];
        let idx = 1;

        // Poster → BunnyCDN
        if (!movie.poster_url && data.posterUrl) {
          const cdnPath = `movies/${movie.id}/poster.jpg`;
          const cdnUrl = DRY_RUN ? `[CDN:${cdnPath}]` : await uploadImageToBunny(data.posterUrl, cdnPath);
          if (cdnUrl) {
            updates.push(`poster_url = $${idx++}`);
            values.push(cdnUrl);
            stats.photos++;
          }
        }

        // Year
        if (!movie.year && data.year) {
          updates.push(`year = $${idx++}`);
          values.push(data.year);
        }

        // Description → translate
        if ((!movie.description || !movie.description.en) && data.descRu) {
          const desc = DRY_RUN ? { ru: data.descRu } : await translateToAllLangs(data.descRu.substring(0, 1500));
          if (Object.keys(desc).length > 0) {
            updates.push(`description = $${idx++}`);
            values.push(JSON.stringify(desc));
            stats.bios++;
          }
        }

        if (updates.length === 0) { stats.skipped++; continue; }
        if (DRY_RUN) {
          console.log(`  [DRY-RUN] ${movie.title} (${movie.movie_xcadr_slug}): ${updates.join(', ')}`);
          continue;
        }

        values.push(movie.id);
        await query(`UPDATE movies SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);

        await new Promise(r => setTimeout(r, 2000));

      } catch (e) {
        console.error(`  Error: movie ${movie.id} (${movie.title}): ${e.message.substring(0, 150)}`);
        stats.errors++;
      }

      if ((i + 1) % 50 === 0) logProgress(i + 1, rows.length);
    }
    logProgress(rows.length, rows.length);
  }

  // Final stats
  console.log('\n' + '═'.repeat(60));
  const { rows: [cn] } = await query(`SELECT COUNT(*) as cnt FROM celebrities WHERE photo_url IS NULL OR photo_url = ''`);
  const { rows: [mn] } = await query(`SELECT COUNT(*) as cnt FROM movies WHERE poster_url IS NULL OR poster_url = ''`);
  console.log(`Celebrities without photo: ${cn.cnt}`);
  console.log(`Movies without poster: ${mn.cnt}`);

  await pool.end();
  console.log('Done!');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
