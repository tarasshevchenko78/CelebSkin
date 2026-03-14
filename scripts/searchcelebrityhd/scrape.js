#!/usr/bin/env node
/**
 * scrape.js — SearchCelebrityHD Scraper
 *
 * Scrapes video pages from searchcelebrityhd.com:
 *   - Parses listing pages (pagination)
 *   - Extracts: title, actress, movie, year, description, video URL, screenshot URLs
 *   - Saves to raw_videos table
 *
 * Usage:
 *   node scrape.js                     # scrape latest page
 *   node scrape.js --pages=5           # scrape 5 pages
 *   node scrape.js --from=10 --to=15   # scrape pages 10-15
 *   node scrape.js --url=https://...   # scrape single URL
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { query } from '../lib/db.js';
import logger from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = 'https://searchcelebrityhd.com';
const SOURCE_NAME = 'searchcelebrityhd';
const DELAY_MS = 2000; // polite scraping delay
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ============================================
// Ensure source exists in DB
// ============================================

async function ensureSource() {
  const { rows } = await query(
    `INSERT INTO sources (name, base_url, adapter_name)
     VALUES ($1, $2, 'searchcelebrityhd')
     ON CONFLICT (name) DO UPDATE SET base_url = $2
     RETURNING id`,
    [SOURCE_NAME, BASE_URL]
  );
  return rows[0].id;
}

// ============================================
// Fetch HTML
// ============================================

async function fetchPage(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 30000,
  });
  return data;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================
// Parse listing page → array of post URLs
// ============================================

function parseListingPage(html) {
  const $ = cheerio.load(html);
  const urls = [];

  // Main content links — each post card
  $('article a[href], .post a[href], .entry-title a[href], h2 a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && href.startsWith(BASE_URL + '/') && !href.includes('/page/') && !href.includes('/tag/') && !href.includes('/category/')) {
      urls.push(href);
    }
  });

  // Deduplicate
  return [...new Set(urls)];
}

// ============================================
// Parse single video page → structured data
// ============================================

function parseVideoPage(html, url) {
  const $ = cheerio.load(html);

  // Title from <title> or <h1>
  const pageTitle = $('title').text().trim().replace(/ - Search Celebrity HD$/, '').trim();
  const h1 = $('h1.entry-title, h1').first().text().trim();
  const title = h1 || pageTitle;

  // Description from <p> inside entry-content
  const description = $('.entry-content > p').first().text().trim();

  // Meta tags for actress + movie
  const metaTags = [];
  $('meta[property="article:tag"]').each((_, el) => {
    metaTags.push($(el).attr('content'));
  });
  // Also from rel="tag" links
  $('a[rel="tag"]').each((_, el) => {
    metaTags.push($(el).text().trim());
  });
  const uniqueTags = [...new Set(metaTags)].filter(Boolean);

  // Separate actress names from movie titles
  // Pattern: movie titles usually have year in parens, actress names don't
  const celebrities = [];
  const movieTags = [];
  for (const tag of uniqueTags) {
    if (/\(\d{4}\)/.test(tag)) {
      movieTags.push(tag);
    } else {
      celebrities.push(tag);
    }
  }

  // Extract movie title and year
  let movieTitle = null;
  let year = null;
  if (movieTags.length > 0) {
    const match = movieTags[0].match(/^(.+?)\s*\((\d{4})\)$/);
    if (match) {
      movieTitle = match[1].trim();
      year = parseInt(match[2]);
    }
  }

  // Video URL from <source> tag
  let videoUrl = null;
  $('source[type="video/mp4"]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) videoUrl = src.replace(/&#038;/g, '&');
  });
  // Also check for video src directly
  if (!videoUrl) {
    $('video[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) videoUrl = src.replace(/&#038;/g, '&');
    });
  }

  // Real video file URL from contentUrl in schema
  let directVideoUrl = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      const graph = json['@graph'] || [json];
      for (const item of graph) {
        if (item['@type'] === 'VideoObject' && item.contentUrl) {
          directVideoUrl = item.contentUrl;
        }
      }
    } catch {}
  });

  // Screenshot URLs — images inside entry-content gallery
  const screenshots = [];
  $('.entry-content img, .entry-content a[href$=".jpg"]').each((_, el) => {
    const src = $(el).attr('href') || $(el).attr('src') || $(el).attr('data-src');
    if (src && src.includes('wp-content/uploads') && src.includes('.jpg')) {
      // Get full-size URL (remove size suffix like -480x270)
      const fullUrl = src.replace(/-\d+x\d+\.jpg$/, '.jpg');
      screenshots.push(fullUrl);
    }
  });
  const uniqueScreenshots = [...new Set(screenshots)];

  // Thumbnail — last screenshot or og:image
  const thumbnail = $('meta[property="og:image"]').attr('content') ||
    uniqueScreenshots[uniqueScreenshots.length - 1] || null;

  // Duration from schema VideoObject
  let duration = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      const graph = json['@graph'] || [json];
      for (const item of graph) {
        if (item['@type'] === 'VideoObject' && item.duration) {
          // ISO 8601 duration: PT3M8S
          const match = item.duration?.match(/PT(\d+)M(\d+)S/);
          if (match) duration = parseInt(match[1]) * 60 + parseInt(match[2]);
        }
      }
    } catch {}
  });

  // Category
  const category = $('a[rel="category tag"]').first().text().trim() || 'Movies';

  return {
    url,
    title,
    description,
    celebrities,
    movieTitle,
    year,
    videoUrl: videoUrl || directVideoUrl,
    directVideoUrl,
    thumbnail,
    screenshots: uniqueScreenshots,
    duration,
    category,
    tags: uniqueTags,
  };
}

// ============================================
// Save to DB
// ============================================

async function saveToDb(sourceId, data) {
  // Check if already exists
  const existing = await query(
    `SELECT id FROM raw_videos WHERE source_url = $1`,
    [data.url]
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, status: 'exists' };
  }

  const { rows } = await query(
    `INSERT INTO raw_videos (
      source_id, source_url, raw_title, raw_description,
      thumbnail_url, duration_seconds, video_file_url,
      raw_tags, raw_celebrities, raw_categories,
      extra_data, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
    ON CONFLICT (source_url) DO NOTHING
    RETURNING id`,
    [
      sourceId,
      data.url,
      data.title,
      data.description,
      data.thumbnail,
      data.duration,
      data.directVideoUrl || data.videoUrl,
      data.tags,
      data.celebrities,
      [data.category],
      JSON.stringify({
        source: 'searchcelebrityhd',
        movie_title: data.movieTitle,
        year: data.year,
        screenshots: data.screenshots,
        screenshot_count: data.screenshots.length,
      }),
    ]
  );

  if (rows.length === 0) return { id: null, status: 'duplicate' };
  return { id: rows[0].id, status: 'new' };
}

// ============================================
// Main
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const singleUrl = args.find(a => a.startsWith('--url='))?.split('=').slice(1).join('=');
  const pagesArg = parseInt(args.find(a => a.startsWith('--pages='))?.split('=')[1] || '1');
  const fromPage = parseInt(args.find(a => a.startsWith('--from='))?.split('=')[1] || '1');
  const toPage = parseInt(args.find(a => a.startsWith('--to='))?.split('=')[1] || String(fromPage + pagesArg - 1));

  logger.info('=== SearchCelebrityHD Scraper ===');

  const sourceId = await ensureSource();
  logger.info(`Source ID: ${sourceId}`);

  let totalNew = 0, totalExists = 0, totalErrors = 0;

  if (singleUrl) {
    // Single URL mode
    logger.info(`Scraping single URL: ${singleUrl}`);
    try {
      const html = await fetchPage(singleUrl);
      const data = parseVideoPage(html, singleUrl);
      logger.info(`  Title: ${data.title}`);
      logger.info(`  Actress: ${data.celebrities.join(', ')}`);
      logger.info(`  Movie: ${data.movieTitle} (${data.year})`);
      logger.info(`  Screenshots: ${data.screenshots.length}`);
      logger.info(`  Video: ${data.videoUrl ? 'yes' : 'no'}`);

      const result = await saveToDb(sourceId, data);
      logger.info(`  → ${result.status} (${result.id || 'skipped'})`);
      if (result.status === 'new') totalNew++;
      else totalExists++;
    } catch (err) {
      logger.error(`  Error: ${err.message}`);
      totalErrors++;
    }
  } else {
    // Pagination mode
    logger.info(`Scraping pages ${fromPage} to ${toPage}`);

    for (let page = fromPage; page <= toPage; page++) {
      if (page > fromPage) await sleep(DELAY_MS);

      const listUrl = page === 1 ? BASE_URL + '/' : `${BASE_URL}/page/${page}/`;
      logger.info(`\nPage ${page}: ${listUrl}`);

      try {
        const listHtml = await fetchPage(listUrl);
        const postUrls = parseListingPage(listHtml);
        logger.info(`  Found ${postUrls.length} posts`);

        for (const postUrl of postUrls) {
          await sleep(DELAY_MS);

          try {
            const html = await fetchPage(postUrl);
            const data = parseVideoPage(html, postUrl);

            const result = await saveToDb(sourceId, data);
            const status = result.status === 'new' ? '✓ NEW' : '○ exists';
            logger.info(`  ${status}: ${data.title} | ${data.celebrities.join(', ')} | ${data.screenshots.length} screenshots`);

            if (result.status === 'new') totalNew++;
            else totalExists++;
          } catch (err) {
            logger.error(`  ✗ ${postUrl}: ${err.message}`);
            totalErrors++;
          }
        }
      } catch (err) {
        logger.error(`  Page ${page} failed: ${err.message}`);
        totalErrors++;
      }
    }
  }

  logger.info(`\n=== Summary: ${totalNew} new, ${totalExists} existing, ${totalErrors} errors ===`);
}

main().catch(err => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
