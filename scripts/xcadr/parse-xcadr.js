#!/usr/bin/env node
/**
 * parse-xcadr.js — xcadr.online metadata parser
 *
 * Fetches video pages from xcadr.online, extracts Russian metadata,
 * and saves to the xcadr_imports table for later translation + matching.
 *
 * Does NOT download any video files.
 * Does NOT modify any existing pipeline tables.
 *
 * Usage:
 *   node xcadr/parse-xcadr.js --pages 5
 *   node xcadr/parse-xcadr.js --url "https://xcadr.online/videos/67688/seks-s-sidni-suini/"
 *   node xcadr/parse-xcadr.js --url "..." --debug
 *   node xcadr/parse-xcadr.js --celeb "https://xcadr.online/celebs/golaya-sidni-svini/"
 *   node xcadr/parse-xcadr.js --collection "https://xcadr.online/podborki/luchshee/"
 *   node xcadr/parse-xcadr.js --reparse
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { query, pool } from '../lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- CONFIGURATION ---
const XCADR_BASE = 'https://xcadr.online';
const REQUEST_DELAY_MS = 2000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const httpClient = axios.create({
  headers: { 'User-Agent': USER_AGENT },
  timeout: 15000,
});

// --- CLI ARGS ---

const cliArgs = process.argv.slice(2);

function getArg(flag) {
  const idx = cliArgs.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
  if (idx === -1) return null;
  const arg = cliArgs[idx];
  if (arg.includes('=')) return arg.split('=').slice(1).join('=');
  return cliArgs[idx + 1] || null;
}

function hasFlag(flag) {
  return cliArgs.includes(flag);
}

const DEBUG = hasFlag('--debug');

// --- HELPERS ---

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse ISO 8601 duration string to seconds.
 * e.g. "PT1M48S" → 108, "PT1H15M23S" → 4523
 */
function parseIsoDuration(text) {
  if (!text) return null;
  const m = text.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

/**
 * Parse xcadr Russian duration string to seconds.
 * Formats: "1м:48с", "8м:23с", "1ч:15м:23с"
 */
function parseDuration(text) {
  if (!text) return null;
  const match = text.match(/(?:(\d+)ч[:\s])?(\d+)м[:\s](\d+)с/);
  if (!match) return null;
  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2]);
  const seconds = parseInt(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Ensure URL is absolute.
 */
function absoluteUrl(href) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  return XCADR_BASE + (href.startsWith('/') ? '' : '/') + href;
}

/**
 * Extract xcadr_video_id from URL path.
 * e.g. /videos/67688/seks-s-sidni-suini/ → "67688"
 */
function extractVideoId(url) {
  const match = url.match(/\/videos\/(\d+)\//);
  return match ? match[1] : null;
}

// --- FETCH HELPERS ---

async function fetchHtml(url) {
  const response = await httpClient.get(url);
  return response.data;
}

// --- PARSERS ---

/**
 * Parse a single xcadr video page.
 *
 * Key HTML structure (confirmed from live page):
 *
 *  <div class="block-details">
 *    <div class="info">
 *      ...
 *      Фильм: <a href="/movies/{slug}/">Горничная</a>
 *      Знаменитость: <a href="/celebs/{slug}/">Сидни Свини</a>
 *      ...
 *      Тэги: <a href="/tags/{slug}/">голая</a>, <a href="/tags/{slug}/">грудь</a>, ...
 *    </div>
 *  </div>
 *  Подборки: <a href="/collection/{slug}/">Лучшие эротические сцены 2025</a>
 *
 *  <div id="screenshots" class="tab-content">
 *    <div class="block-screenshots">
 *      <a href="/contents/videos_screenshots/{...}/source/1.jpg" class="item">
 *        <img src="/contents/videos_screenshots/{...}/228x128/1.jpg">
 *      </a>
 *      ...
 *    </div>
 *  </div>
 *
 *  Duration: <meta itemprop="duration" content="PT1M48S" />
 *  Year: <meta itemprop="description" content="Title – Movie (2025)" />
 *
 * IMPORTANT: Nav links are /celebs/, /movie/, /collections/ (NO slug) — they won't
 * match our slug-requiring regexes.
 */
async function parseVideoPage(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // Title
  const title_ru = $('h1').first().text().trim();
  if (!title_ru) {
    console.warn(`[WARN] No title found on: ${url}`);
    return null;
  }

  // xcadr video ID
  const xcadr_video_id = extractVideoId(url);

  // ── Celebrity ──────────────────────────────────────────────────────────────
  // Pattern: <a href="/celebs/{slug}/">Name</a>
  // Nav uses /celebs/ (no slug) → won't match
  let celebrity_name_ru = null;
  $('a[href]').each(function () {
    if (celebrity_name_ru) return false; // break
    const href = $(this).attr('href') || '';
    if (/\/celebs\/[^/]+\//.test(href)) {
      const text = $(this).text().trim();
      if (text) celebrity_name_ru = text;
    }
  });

  // ── Movie ──────────────────────────────────────────────────────────────────
  // Pattern: <a href="/movies/{slug}/">Название</a>
  // Nav uses /movie/ (singular, no slug) → won't match /movies/{slug}/
  let movie_title_ru = null;
  let movie_year = null;
  $('a[href]').each(function () {
    if (movie_title_ru) return false; // break
    const href = $(this).attr('href') || '';
    if (/\/movies\/[^/]+\//.test(href)) {
      const text = $(this).text().trim();
      if (text) {
        const yearMatch = text.match(/\((\d{4})\)/);
        movie_year = yearMatch ? parseInt(yearMatch[1]) : null;
        movie_title_ru = text.replace(/\s*\(\d{4}\)\s*$/, '').trim();
      }
    }
  });

  // Try to get year from meta description if not in link text: "Title – Movie (2025)"
  if (movie_title_ru && !movie_year) {
    const metaDesc = $('meta[itemprop="description"]').attr('content') || '';
    const yearMatch = metaDesc.match(/\((\d{4})\)\s*$/);
    if (yearMatch) movie_year = parseInt(yearMatch[1]);
  }

  // ── Tags ───────────────────────────────────────────────────────────────────
  // Pattern: <a href="/tags/{slug}/">tagname</a>
  const tags_ru = [];
  $('a[href]').each(function () {
    const href = $(this).attr('href') || '';
    if (/\/tags\/[^/]+\//.test(href)) {
      const text = $(this).text().trim();
      if (text && text.length < 60 && !tags_ru.includes(text)) {
        tags_ru.push(text);
      }
    }
  });

  // ── Collections ────────────────────────────────────────────────────────────
  // Pattern: <a href="/collection/{slug}/">Collection name</a>
  // Nav uses /collections/ (plural, no slug) → won't match /collection/{slug}/
  const collections_ru = [];
  $('a[href]').each(function () {
    const href = $(this).attr('href') || '';
    if (/\/collection\/[^/]+\//.test(href)) {
      const text = $(this).text().trim();
      if (text && !collections_ru.includes(text)) {
        collections_ru.push(text);
      }
    }
  });

  // ── Duration ───────────────────────────────────────────────────────────────
  // Primary: ISO 8601 meta tag → <meta itemprop="duration" content="PT1M48S">
  let duration_seconds = null;
  const isoDur = $('meta[itemprop="duration"]').attr('content') || '';
  if (isoDur) {
    duration_seconds = parseIsoDuration(isoDur);
  }
  // Fallback: Xм:Yс text pattern anywhere on page
  if (!duration_seconds) {
    const bodyText = $('body').text();
    const durationMatch = bodyText.match(/(?:\d+ч[:\s])?\d+м[:\s]\d+с/);
    if (durationMatch) duration_seconds = parseDuration(durationMatch[0]);
  }

  // ── Description ────────────────────────────────────────────────────────────
  // Use og:description or meta[name="description"] — xcadr uses these for scene context
  const description_ru = (
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    ''
  ).trim() || null;

  // ── Screenshots ────────────────────────────────────────────────────────────
  // Primary: #screenshots section — <a class="item" href=".../source/N.jpg">
  // These hrefs already point to source-size images!
  const screenshot_urls = [];

  $('#screenshots a[href]').each(function () {
    const href = $(this).attr('href') || '';
    if (/\/videos_screenshots\//.test(href)) {
      const sourceUrl = absoluteUrl(href.includes('/source/') ? href : href.replace(/\/\d+x\d+\//, '/source/'));
      if (sourceUrl && !screenshot_urls.includes(sourceUrl)) {
        screenshot_urls.push(sourceUrl);
      }
    }
  });

  // Fallback: any <a href> containing videos_screenshots
  if (screenshot_urls.length === 0) {
    $('a[href*="/videos_screenshots/"]').each(function () {
      const href = $(this).attr('href') || '';
      const sourceUrl = absoluteUrl(href.includes('/source/') ? href : href.replace(/\/\d+x\d+\//, '/source/'));
      if (sourceUrl && !screenshot_urls.includes(sourceUrl)) {
        screenshot_urls.push(sourceUrl);
      }
    });
  }

  // Last fallback: img[src] with videos_screenshots → convert to source size
  if (screenshot_urls.length === 0) {
    $('img[src*="/videos_screenshots/"], img[data-src*="/videos_screenshots/"]').each(function () {
      const src = $(this).attr('src') || $(this).attr('data-src') || '';
      if (src) {
        const sourceUrl = absoluteUrl(src.replace(/\/\d+x\d+\//, '/source/'));
        if (sourceUrl && !screenshot_urls.includes(sourceUrl)) {
          screenshot_urls.push(sourceUrl);
        }
      }
    });
  }

  return {
    xcadr_url: url,
    xcadr_video_id,
    title_ru,
    celebrity_name_ru,
    movie_title_ru,
    movie_year,
    tags_ru,
    collections_ru,
    duration_seconds,
    screenshot_urls,
    description_ru,
  };
}

/**
 * Fetch a listing page and return all video page URLs found.
 */
async function parseListPage(pageNum) {
  const url = pageNum <= 1
    ? `${XCADR_BASE}/`
    : `${XCADR_BASE}/page/${pageNum}/`;

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const videoUrls = new Set();
  $('a[href]').each(function () {
    const href = $(this).attr('href');
    if (/\/videos\/\d+\//i.test(href)) {
      videoUrls.add(absoluteUrl(href));
    }
  });

  return [...videoUrls];
}

/**
 * Fetch a celebrity page and return all video URLs + the celeb name.
 */
async function parseCelebPage(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const celeb_name_ru = $('h1').first().text().trim();
  const videoUrls = new Set();

  $('a[href]').each(function () {
    const href = $(this).attr('href');
    if (/\/videos\/\d+\//i.test(href)) {
      videoUrls.add(absoluteUrl(href));
    }
  });

  // Check for pagination on celeb page
  const paginationUrls = new Set();
  const basePathname = new URL(url).pathname;
  $('a[href]').each(function () {
    const href = $(this).attr('href');
    if (href && href.includes(basePathname) && /\/page\/\d+\//i.test(href)) {
      paginationUrls.add(absoluteUrl(href));
    }
  });

  for (const pageUrl of paginationUrls) {
    await delay(REQUEST_DELAY_MS);
    try {
      const pageHtml = await fetchHtml(pageUrl);
      const $p = cheerio.load(pageHtml);
      $p('a[href]').each(function () {
        const href = $p(this).attr('href');
        if (/\/videos\/\d+\//i.test(href)) {
          videoUrls.add(absoluteUrl(href));
        }
      });
    } catch (err) {
      console.warn(`[WARN] Failed to fetch celeb page: ${pageUrl} — ${err.message}`);
    }
  }

  return { celeb_name_ru, video_urls: [...videoUrls] };
}

/**
 * Fetch a collection page and return all video URLs.
 */
async function parseCollectionPage(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const collection_name_ru = $('h1').first().text().trim();
  const videoUrls = new Set();

  $('a[href]').each(function () {
    const href = $(this).attr('href');
    if (/\/videos\/\d+\//i.test(href)) {
      videoUrls.add(absoluteUrl(href));
    }
  });

  return { collection_name_ru, video_urls: [...videoUrls] };
}

// --- DATABASE ---

async function existsInDb(xcadr_url) {
  const result = await query(
    'SELECT id FROM xcadr_imports WHERE xcadr_url = $1',
    [xcadr_url]
  );
  return result.rows.length > 0;
}

async function saveToDb(data) {
  await query(
    `INSERT INTO xcadr_imports (
      xcadr_url, xcadr_video_id,
      title_ru, celebrity_name_ru, movie_title_ru, movie_year,
      tags_ru, collections_ru, duration_seconds, screenshot_urls,
      description_ru, status
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'parsed'
    )
    ON CONFLICT (xcadr_url) DO NOTHING`,
    [
      data.xcadr_url,
      data.xcadr_video_id,
      data.title_ru,
      data.celebrity_name_ru,
      data.movie_title_ru,
      data.movie_year,
      data.tags_ru,
      data.collections_ru,
      data.duration_seconds,
      data.screenshot_urls,
      data.description_ru || null,
    ]
  );
}

// --- REPARSE ---

/**
 * Re-fetch and update all xcadr_imports rows with status='parsed'.
 * Fixes previously mis-parsed metadata (tags, celebrity, movie, screenshots).
 */
async function reparseAll() {
  const result = await query(
    `SELECT id, xcadr_url FROM xcadr_imports
     WHERE status = 'parsed' AND xcadr_url IS NOT NULL
     ORDER BY id ASC`
  );

  console.log(`Found ${result.rows.length} items with status='parsed' to re-parse`);

  let fixed = 0;
  let failed = 0;

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    process.stdout.write(`\r[${i + 1}/${result.rows.length}] `);

    try {
      const data = await parseVideoPage(row.xcadr_url);
      if (!data) {
        console.warn(`\n  Skip (no data): ${row.xcadr_url}`);
        failed++;
        continue;
      }

      await query(
        `UPDATE xcadr_imports SET
          title_ru = $1, celebrity_name_ru = $2, movie_title_ru = $3, movie_year = $4,
          tags_ru = $5, collections_ru = $6, duration_seconds = $7, screenshot_urls = $8,
          description_ru = $9
         WHERE id = $10`,
        [
          data.title_ru, data.celebrity_name_ru, data.movie_title_ru, data.movie_year,
          data.tags_ru, data.collections_ru, data.duration_seconds, data.screenshot_urls,
          data.description_ru || null,
          row.id,
        ]
      );

      fixed++;
      if (DEBUG) {
        printDebug(data);
      } else {
        process.stdout.write(
          `Re-parsed: "${data.title_ru.substring(0, 50)}" — tags: ${data.tags_ru.length}, shots: ${data.screenshot_urls.length}`
        );
      }
    } catch (err) {
      console.warn(`\n  ✗ Failed id=${row.id}: ${err.message}`);
      failed++;
    }

    if (i < result.rows.length - 1) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  process.stdout.write('\n');
  console.log('\n========================================');
  console.log(`Re-parsed ${result.rows.length} items: ${fixed} updated, ${failed} failed`);
  console.log('========================================');
}

// --- DEBUG PRINTER ---

function printDebug(data) {
  console.log('\n=== DEBUG EXTRACT ===');
  console.log(`Title:       ${data.title_ru}`);
  console.log(`Celebrity:   ${data.celebrity_name_ru || '(none)'}`);
  console.log(`Movie:       ${data.movie_title_ru || '(none)'}${data.movie_year ? ` (${data.movie_year})` : ''}`);
  console.log(`Tags:        ${data.tags_ru.length > 0 ? data.tags_ru.join(', ') : '(none)'}`);
  console.log(`Collections: ${data.collections_ru.length > 0 ? data.collections_ru.join(', ') : '(none)'}`);
  console.log(`Screenshots: ${data.screenshot_urls.length} found`);
  console.log(`Duration:    ${data.duration_seconds !== null ? data.duration_seconds + 's' : '(none)'}`);
  console.log('=====================');
}

// --- MAIN ---

async function processVideoUrls(urls) {
  let parsed = 0;
  let skipped = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    if (!DEBUG && await existsInDb(url)) {
      skipped++;
      process.stdout.write(`\r[${i + 1}/${urls.length}] Skip (exists): ${url.substring(0, 80)}`);
      continue;
    }

    try {
      const data = await parseVideoPage(url);
      if (!data) {
        console.warn(`\n[WARN] Skipping (no data): ${url}`);
        skipped++;
        continue;
      }

      if (DEBUG) {
        printDebug(data);
        continue; // don't save in debug mode
      }

      await saveToDb(data);
      parsed++;
      if (!DEBUG) {
        process.stdout.write(`\r[${i + 1}/${urls.length}] Parsed ${parsed}: ${data.title_ru.substring(0, 60)}`);
      }
    } catch (err) {
      console.warn(`\n[WARN] Failed: ${url} — ${err.message}`);
      skipped++;
    }

    if (i < urls.length - 1) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  if (!DEBUG) process.stdout.write('\n');
  return { parsed, skipped };
}

async function main() {
  const pagesArg = getArg('--pages');
  const urlArg   = getArg('--url');
  const celebArg = getArg('--celeb');
  const collArg  = getArg('--collection');
  const reparse  = hasFlag('--reparse');

  if (!pagesArg && !urlArg && !celebArg && !collArg && !reparse) {
    console.log('Usage:');
    console.log('  node xcadr/parse-xcadr.js --pages 5');
    console.log('  node xcadr/parse-xcadr.js --url "https://xcadr.online/videos/67688/..."');
    console.log('  node xcadr/parse-xcadr.js --url "..." --debug');
    console.log('  node xcadr/parse-xcadr.js --celeb "https://xcadr.online/celebs/..."');
    console.log('  node xcadr/parse-xcadr.js --collection "https://xcadr.online/podborki/..."');
    console.log('  node xcadr/parse-xcadr.js --reparse   (re-fetch all status=parsed rows)');
    process.exit(0);
  }

  let totalParsed = 0;
  let totalSkipped = 0;

  // --- Re-parse existing items ---
  if (reparse) {
    await reparseAll();
    await pool.end();
    return;
  }

  // --- Single video URL ---
  if (urlArg) {
    console.log(`Parsing single video: ${urlArg}`);
    const { parsed, skipped } = await processVideoUrls([urlArg]);
    totalParsed += parsed;
    totalSkipped += skipped;
  }

  // --- Celebrity page ---
  if (celebArg) {
    console.log(`Fetching celebrity page: ${celebArg}`);
    try {
      const { celeb_name_ru, video_urls } = await parseCelebPage(celebArg);
      console.log(`Found celebrity: ${celeb_name_ru} — ${video_urls.length} videos`);
      const { parsed, skipped } = await processVideoUrls(video_urls);
      totalParsed += parsed;
      totalSkipped += skipped;
    } catch (err) {
      console.error(`[ERROR] Failed to parse celeb page: ${err.message}`);
    }
  }

  // --- Collection page ---
  if (collArg) {
    console.log(`Fetching collection page: ${collArg}`);
    try {
      const { collection_name_ru, video_urls } = await parseCollectionPage(collArg);
      console.log(`Found collection: ${collection_name_ru} — ${video_urls.length} videos`);
      const { parsed, skipped } = await processVideoUrls(video_urls);
      totalParsed += parsed;
      totalSkipped += skipped;
    } catch (err) {
      console.error(`[ERROR] Failed to parse collection page: ${err.message}`);
    }
  }

  // --- N listing pages ---
  if (pagesArg) {
    const pageCount = parseInt(pagesArg);
    if (isNaN(pageCount) || pageCount < 1) {
      console.error('[ERROR] --pages must be a positive integer');
      process.exit(1);
    }

    console.log(`Scraping ${pageCount} listing page(s) from xcadr.online...`);

    for (let p = 1; p <= pageCount; p++) {
      console.log(`\nFetching listing page ${p}/${pageCount}...`);
      let videoUrls = [];
      try {
        videoUrls = await parseListPage(p);
        console.log(`  Found ${videoUrls.length} video links on page ${p}`);
      } catch (err) {
        console.warn(`[WARN] Failed to fetch listing page ${p}: ${err.message}`);
        continue;
      }

      if (videoUrls.length === 0) {
        console.log(`  No videos found on page ${p}, stopping.`);
        break;
      }

      const { parsed, skipped } = await processVideoUrls(videoUrls);
      totalParsed += parsed;
      totalSkipped += skipped;

      if (p < pageCount) {
        await delay(REQUEST_DELAY_MS);
      }
    }
  }

  // --- Summary ---
  console.log('\n========================================');
  console.log(`Parsed ${totalParsed} new videos, ${totalSkipped} skipped (already exist or failed)`);
  console.log('========================================');

  await pool.end();
}

main().catch((err) => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
