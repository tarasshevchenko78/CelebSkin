#!/usr/bin/env node
/**
 * download-and-process.js — D.9: Auto-download + process xcadr videos
 *
 * Picks up xcadr_imports with status='imported' that have a linked video
 * with no video_url yet. For each item:
 *
 *   Phase 1: Find video URL
 *     1A — Search boobsradar.com (clean video, no watermark)
 *     1B — Fallback: scrape xcadr video page
 *
 *   Phase 2: Download + process
 *     2A — Download video to tmp/
 *     2B — Cropdetect (xcadr source only — remove black bars)
 *     2C — Watermark (celeb.skin, bottom-right, 30% opacity)
 *     2D — 8 thumbnails evenly spaced
 *     2E — 6-second preview clip at 480px
 *
 *   Phase 3: Upload all files to BunnyCDN
 *
 *   Phase 4: Update videos + xcadr_imports tables
 *
 *   Phase 5: Cleanup tmp directory
 *
 * Usage:
 *   node xcadr/download-and-process.js
 *   node xcadr/download-and-process.js --limit 5
 *   node xcadr/download-and-process.js --id 42          (specific xcadr_imports.id)
 *   node xcadr/download-and-process.js --source boobsradar  (skip xcadr fallback)
 *   node xcadr/download-and-process.js --source xcadr       (skip boobsradar)
 *   node xcadr/download-and-process.js --skip-upload        (skip CDN upload, keep tmp)
 *   node xcadr/download-and-process.js --keep-tmp           (don't delete tmp on success)
 */

import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { mkdir, rm, stat, access, writeFile } from 'fs/promises';
import { createWriteStream } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pipeline as streamPipeline } from 'stream/promises';
import axios from 'axios';
import * as cheerio from 'cheerio';

import { query, pool } from '../lib/db.js';
import { config } from '../lib/config.js';
import logger from '../lib/logger.js';
import { uploadFile, getVideoPath, getCdnUrl } from '../lib/bunny.js';
import { withRetry } from '../lib/retry.js';
import { recordFailure } from '../lib/dead-letter.js';

const execFileAsync = promisify(execFile);
const __dirname    = dirname(fileURLToPath(import.meta.url));
const TMP_DIR      = config.pipeline.tmpDir;

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name) {
    const idx = args.indexOf(name);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    const eq = args.find((a) => a.startsWith(name + '='));
    return eq ? eq.split('=').slice(1).join('=') : null;
}
function hasFlag(name) { return args.includes(name); }

const LIMIT       = parseInt(getArg('--limit') || '5');
const ITEM_ID     = getArg('--id') ? parseInt(getArg('--id')) : null;
const FORCE_SRC   = getArg('--source') || null;  // 'boobsradar' | 'xcadr' | null
const SKIP_UPLOAD = hasFlag('--skip-upload');
const KEEP_TMP    = hasFlag('--keep-tmp');

// ── Constants ─────────────────────────────────────────────────────────────────

const THUMB_COUNT   = 8;
const PREVIEW_SECS  = 6;
const PREVIEW_WIDTH = 480;
const WM_TEXT       = 'celeb.skin';
const WM_OPACITY    = 0.3;
const WM_FONT_SIZE  = 24;
const WM_MARGIN     = 20;

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
};

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Phase 1A: Boobsradar search ───────────────────────────────────────────────

/**
 * Build name parts for fuzzy celebrity name matching.
 * "Erin R. Ryan" → ["erin", "ryan"]  (strips initials, keeps parts > 2 chars)
 */
function buildNameParts(name) {
    if (!name) return [];
    return name.toLowerCase().split(/[\s.]+/).filter((p) => p.length > 2);
}

/**
 * Return true if at least 2 name parts appear in text (or all parts if < 2).
 */
function matchesCelebrity(text, nameParts) {
    if (nameParts.length === 0) return false;
    const lower      = text.toLowerCase();
    const matchCount = nameParts.filter((p) => lower.includes(p)).length;
    return matchCount >= Math.min(2, nameParts.length);
}

/**
 * Search boobsradar.com for a clean video matching celebrity + movie.
 * Verifies celebrity name appears in result title/URL before fetching.
 * Returns a direct video URL string, or null if not found.
 */
async function findBoobsradarUrl(celebEn, movieEn, existingSearchUrl) {
    try {
        // Build search URL (same pattern as match-xcadr.js)
        const query_  = [celebEn, movieEn].filter(Boolean).join(' ');
        if (!query_) return null;

        const nameParts = buildNameParts(celebEn);

        const searchUrl = existingSearchUrl || `https://boobsradar.com/?s=${encodeURIComponent(query_)}`;
        logger.info(`  [BR] Searching: ${searchUrl}`);

        const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 20000 });
        const $   = cheerio.load(res.data);

        // Collect video page links WITH their link text from search results
        const videoResults = [];
        $('a[href]').each(function () {
            const href = $(this).attr('href') || '';
            if (/\/video\/[^/]+\/?$/.test(href) || /\/videos\/[^/]+\/?$/.test(href)) {
                const full  = href.startsWith('http') ? href : `https://boobsradar.com${href}`;
                const title = $(this).text().trim() ||
                              $(this).attr('title') || '';
                if (!videoResults.find((r) => r.url === full)) {
                    videoResults.push({ url: full, title });
                }
            }
        });

        if (videoResults.length === 0) {
            logger.info('  [BR] No video results found in search page');
            return null;
        }

        // Filter results: celebrity name must appear in title or URL
        const label = celebEn ? `"${celebEn}"` : '(no name)';
        logger.info(`  [BR] Found ${videoResults.length} result(s), filtering by ${label}...`);

        const matching = nameParts.length > 0
            ? videoResults.filter((r) => matchesCelebrity(r.title, nameParts) || matchesCelebrity(r.url, nameParts))
            : videoResults; // no celeb name available — try all

        if (matching.length === 0) {
            logger.info(`  [BR] 0 results match celebrity name — falling back to xcadr`);
            return null;
        }

        logger.info(`  [BR] ${matching.length} result(s) match, checking first 3...`);
        if (matching[0].title) logger.info(`  [BR] Top match: "${matching[0].title}"`);

        // Try matching results — verify celeb name on the video page too
        for (const result of matching.slice(0, 3)) {
            await delay(500);

            // Page-level verification: fetch page, confirm celeb name in title/description
            let pageOk = false;
            try {
                const pageRes = await axios.get(result.url, { headers: HEADERS, timeout: 20000 });
                const $page   = cheerio.load(pageRes.data);
                const pageText = ($page('title').text() + ' ' + $page('h1').text() + ' ' +
                                  $page('meta[name="description"]').attr('content') || '').toLowerCase();
                pageOk = matchesCelebrity(pageText, nameParts);

                if (!pageOk) {
                    logger.info(`  [BR] Page title mismatch, skipping: "${$page('title').text().trim().substring(0, 60)}"`);
                    continue;
                }

                // Extract video URL from already-fetched HTML
                const directUrl = await extractVideoUrl(result.url, 'boobsradar');
                if (directUrl) {
                    logger.info(`  [BR] ✓ Verified + found video URL: ${result.url}`);
                    return directUrl;
                }
            } catch (err) {
                logger.warn(`  [BR] Page check failed for ${result.url}: ${err.message}`);
            }
        }

        logger.info('  [BR] No verified video URL found — falling back to xcadr');
        return null;
    } catch (err) {
        logger.warn(`  [BR] Search failed: ${err.message}`);
        return null;
    }
}

// ── Phase 1B: Video URL extractor ────────────────────────────────────────────

// Ad patterns — URLs containing these strings are pre-roll ads, not content
const AD_PATTERNS = [
    'bongacams', 'chaturbate', 'ads.', 'promo', 'banner', 'sponsor',
    'tracker', 'click.', 'redirect', 'popunder', 'exoclick', 'juicyads',
    'trafficjunky', 'adserver', 'adsystem', 'adnxs', 'doubleclick',
];

function isAdUrl(url) {
    const lower = url.toLowerCase();
    return AD_PATTERNS.some((p) => lower.includes(p));
}

/** Score a video URL by resolution quality — higher is better */
function getQualityScore(url) {
    const lower = url.toLowerCase();
    if (lower.includes('2160') || lower.includes('4k'))               return 2160;
    if (lower.includes('1080') || lower.includes('fullhd'))           return 1080;
    if (lower.includes('720')  || lower.includes('_hd') || lower.includes('/hd/'))  return 720;
    if (lower.includes('480')  || lower.includes('_sd') || lower.includes('/sd/'))  return 480;
    if (lower.includes('360'))                                         return 360;
    if (lower.includes('240'))                                         return 240;
    // ?q=N or &q=N  (xcadr CDN query param)
    const qParam = lower.match(/[?&]q=(\d+)/);
    if (qParam) return parseInt(qParam[1], 10);
    return 500; // unknown — assume medium
}

/**
 * Extract a direct .mp4 video URL from a video page.
 *
 * For xcadr: KVS player script patterns FIRST (real content), then fallbacks.
 * For boobsradar: standard JWPlayer / og:video patterns.
 * All candidates are filtered through isAdUrl() before returning.
 *
 * source: 'boobsradar' | 'xcadr'
 */
async function extractVideoUrl(pageUrl, source) {
    try {
        const res = await axios.get(pageUrl, { headers: HEADERS, timeout: 20000 });
        const html = res.data;
        const $ = cheerio.load(html);

        const candidates = []; // { url, method }

        if (source === 'xcadr') {
            // ── xcadr: KVS player JavaScript patterns (real content) ──────────
            // These appear in inline <script> blocks on xcadr pages.
            // Priority order: most specific → least specific.

            // KVS patterns — ALL use global flag so we collect every quality variant.
            // video_url / video_alt_url / video_alt_url2 are the three KVS quality slots.
            const kvsPatterns = [
                // KVS flashvars: video_url: '...'  /  video_alt_url: '...'  /  video_alt_url2: '...'
                { re: /video_(?:alt_url\d*|url)\s*[=:]\s*['"]([^'"]+\.mp4[^'"]*)['"]/gi, method: 'kvs:video_url' },
                // post_video_url (sometimes used for HD variant)
                { re: /post_video_url\s*[=:]\s*['"]([^'"]+\.mp4[^'"]*)['"]/gi,           method: 'kvs:post_video_url' },
                // JW / Flowplayer sources array: {file: '...'}
                { re: /sources\s*[=:]\s*\[[\s\S]*?['"]([^'"]+\.mp4[^'"]*)['"]/gi,        method: 'kvs:sources' },
                // Generic file key: file: '...'  or  "file":"..."
                { re: /['"]file['"]\s*[=:]\s*['"]([^'"]+\.mp4[^'"]*)['"]/gi,             method: 'kvs:file' },
            ];

            // Collect all script text
            const scriptTexts = [];
            $('script').each(function () {
                const t = $(this).html() || '';
                if (t.trim()) scriptTexts.push(t);
            });

            // Also search raw HTML (some KVS sites inline outside <script>)
            scriptTexts.push(html);

            for (const { re, method } of kvsPatterns) {
                for (const text of scriptTexts) {
                    // Use matchAll to catch ALL quality variants (global flag required)
                    const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
                    for (const m of text.matchAll(globalRe)) {
                        if (m[1] && m[1].startsWith('http')) {
                            candidates.push({ url: m[1], method });
                        }
                    }
                }
            }

            // Also check /get_file/ or /get_video/ endpoint patterns
            const getFileMatch = html.match(/(['"])(https?:\/\/[^'"]*\/(?:get_file|get_video)\/[^'"]+)\1/i);
            if (getFileMatch) {
                candidates.push({ url: getFileMatch[2], method: 'kvs:get_file' });
            }

            // Log all candidates before filtering (debug)
            if (candidates.length > 0) {
                logger.info(`  [xcadr] Found ${candidates.length} candidate URL(s) in scripts:`);
                for (const c of candidates) {
                    logger.info(`    [${c.method}] ${c.url.substring(0, 100)}`);
                }
            } else {
                logger.info('  [xcadr] No KVS patterns found in scripts');
            }

            // Filter out ads
            const clean = candidates.filter((c) => !isAdUrl(c.url));
            if (clean.length < candidates.length) {
                logger.info(`  [xcadr] Filtered ${candidates.length - clean.length} ad URL(s)`);
            }

            if (clean.length > 0) {
                // De-duplicate by URL (same URL can appear in multiple pattern passes)
                const seen = new Set();
                const unique = clean.filter((c) => {
                    if (seen.has(c.url)) return false;
                    seen.add(c.url);
                    return true;
                });

                // Sort by quality descending — pick highest resolution available
                unique.sort((a, b) => getQualityScore(b.url) - getQualityScore(a.url));

                if (unique.length > 1) {
                    logger.info(`  [xcadr] Quality variants found:`);
                    for (const c of unique) {
                        logger.info(`    [${c.method}] q=${getQualityScore(c.url)} ${c.url.substring(0, 100)}`);
                    }
                }

                const chosen = unique[0];
                logger.info(`  [xcadr] ✓ Best quality [q=${getQualityScore(chosen.url)}] [${chosen.method}]: ${chosen.url.substring(0, 100)}`);
                return chosen.url;
            }

            // Fallback: <source src> — LAST RESORT for xcadr (usually the ad)
            logger.warn('  [xcadr] KVS patterns failed — trying <source> fallback (may be ad)');
            $('source[src]').each(function () {
                if (candidates.length > 0) return;
                const src = $(this).attr('src') || '';
                if (/\.mp4/i.test(src) && src.startsWith('http') && !isAdUrl(src)) {
                    candidates.push({ url: src, method: 'source-tag' });
                }
            });
            if (candidates.length > 0) {
                logger.info(`  [xcadr] [source-tag] ${candidates[0].url.substring(0, 100)}`);
                return candidates[0].url;
            }

            logger.warn('  [xcadr] No video URL found');
            return null;

        } else {
            // ── boobsradar / generic: standard patterns ───────────────────────

            // 1. <source src="...mp4">
            $('source[src]').each(function () {
                const src = $(this).attr('src') || '';
                if (/\.mp4/i.test(src) && src.startsWith('http')) {
                    candidates.push({ url: src, method: 'source-tag' });
                }
            });

            // 2. <video src="...mp4">
            $('video[src]').each(function () {
                const src = $(this).attr('src') || '';
                if (/\.mp4/i.test(src) && src.startsWith('http')) {
                    candidates.push({ url: src, method: 'video-tag' });
                }
            });

            // 3. og:video meta
            const ogVideo = $('meta[property="og:video"]').attr('content') ||
                            $('meta[property="og:video:url"]').attr('content') || '';
            if (ogVideo && /\.mp4/i.test(ogVideo)) {
                candidates.push({ url: ogVideo, method: 'og:video' });
            }

            // 4. Script block patterns (JWPlayer, setup({ file: "..." }))
            const scriptPatterns = [
                { re: /['"]?file['"]?\s*:\s*['"]([^'"]+\.mp4[^'"]*)/i,    method: 'script:file' },
                { re: /['"]?src['"]?\s*:\s*['"]([^'"]+\.mp4[^'"]*)/i,     method: 'script:src' },
                { re: /video_url\s*=\s*['"]([^'"]+\.mp4[^'"]*)/i,         method: 'script:video_url' },
                { re: /['"]?url['"]?\s*:\s*['"]([^'"]+\.mp4[^'"]*)/i,     method: 'script:url' },
            ];

            $('script').each(function () {
                const scriptText = $(this).html() || '';
                for (const { re, method } of scriptPatterns) {
                    const m = scriptText.match(re);
                    if (m && m[1].startsWith('http')) {
                        candidates.push({ url: m[1], method });
                    }
                }
            });

            // 5. data attributes
            $('[data-video-url],[data-src],[data-file]').each(function () {
                const v = $(this).attr('data-video-url') ||
                          $(this).attr('data-src') ||
                          $(this).attr('data-file') || '';
                if (/\.mp4/i.test(v) && v.startsWith('http')) {
                    candidates.push({ url: v, method: 'data-attr' });
                }
            });

            // Filter ads and return first clean result
            const clean = candidates.filter((c) => !isAdUrl(c.url));
            return clean.length > 0 ? clean[0].url : null;
        }
    } catch (err) {
        logger.warn(`  [extractVideoUrl] ${source} page error: ${err.message}`);
        return null;
    }
}

// ── Video download ────────────────────────────────────────────────────────────

async function downloadVideo(videoUrl, destPath, extraHeaders = {}) {
    const res = await axios({
        method:       'GET',
        url:          videoUrl,
        responseType: 'stream',
        timeout:      600000, // 10 min
        headers:      { ...HEADERS, ...extraHeaders },
        maxRedirects: 10,
    });
    await streamPipeline(res.data, createWriteStream(destPath));
    const info = await stat(destPath);
    return info.size;
}

// ── Phase 2A: FFprobe helpers ─────────────────────────────────────────────────

async function getVideoDuration(videoPath) {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'quiet',
            '-show_entries', 'format=duration',
            '-of', 'csv=p=0',
            videoPath,
        ], { timeout: 15000 });
        return Math.round(parseFloat(stdout.trim()));
    } catch {
        return 0;
    }
}

async function getVideoResolution(videoPath) {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'quiet',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height',
            '-of', 'csv=p=0',
            videoPath,
        ], { timeout: 15000 });
        const [width, height] = stdout.trim().split(',').map(Number);
        return { width: width || 1280, height: height || 720 };
    } catch {
        return { width: 1280, height: 720 };
    }
}

function widthToQuality(width) {
    if (width >= 1920) return '1080p';
    if (width >= 1280) return '720p';
    if (width >= 854)  return '480p';
    return '360p';
}

function formatDuration(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Phase 2B: Cropdetect (xcadr source only) ──────────────────────────────────

/**
 * Run FFmpeg cropdetect and return crop filter string like "crop=1280:534:0:273"
 * or null if no crop needed / detection failed.
 */
async function detectCrop(videoPath) {
    try {
        // Use -t 60 to analyze first 60 seconds — fast enough
        const { stderr } = await execFileAsync('ffmpeg', [
            '-i', videoPath,
            '-vf', 'cropdetect=24:16:0',
            '-t', '60',
            '-frames:v', '100',
            '-f', 'null', '/dev/null',
        ], { timeout: 60000 });

        // Grab the last crop= line (most stable value)
        const lines   = stderr.split('\n');
        const cropLines = lines.filter((l) => l.includes('crop='));
        if (cropLines.length === 0) return null;

        const lastLine = cropLines[cropLines.length - 1];
        const m = lastLine.match(/crop=(\d+:\d+:\d+:\d+)/);
        if (!m) return null;

        const [w, h, x, y] = m[1].split(':').map(Number);

        // Skip if crop changes nothing meaningful (less than 5% reduction)
        const { width: origW, height: origH } = await getVideoResolution(videoPath);
        if (w >= origW * 0.95 && h >= origH * 0.95) {
            logger.info(`  [crop] No significant crop needed (${w}x${h} vs ${origW}x${origH})`);
            return null;
        }

        logger.info(`  [crop] Detected: ${w}x${h} at offset ${x},${y}`);
        return `crop=${w}:${h}:${x}:${y}`;
    } catch (err) {
        logger.warn(`  [crop] Detect failed: ${err.message}`);
        return null;
    }
}

// ── Phase 2B.2: xcadr delogo filter ──────────────────────────────────────────

/**
 * Build an FFmpeg delogo filter that blurs all 4 corners where xcadr.online
 * places its floating watermark. Covers 22% width × 6% height in each corner.
 * Tested on 718×360 (157×21) and 640×360 (140×21) — removes "XCADR.ONLINE" cleanly
 * with minimal affected area.
 */
function buildDelogoFilter(width, height) {
    const logoW = Math.round(width  * 0.22);
    const logoH = Math.round(height * 0.06);
    const pad   = 4; // px from edge
    const rX    = width  - logoW - pad;      // right-edge x
    const bY    = height - logoH - pad;      // bottom-edge y
    return [
        `delogo=x=${pad}:y=${pad}:w=${logoW}:h=${logoH}`,    // top-left
        `delogo=x=${rX}:y=${pad}:w=${logoW}:h=${logoH}`,     // top-right
        `delogo=x=${pad}:y=${bY}:w=${logoW}:h=${logoH}`,     // bottom-left
        `delogo=x=${rX}:y=${bY}:w=${logoW}:h=${logoH}`,      // bottom-right
    ].join(',');
}

// ── Phase 2C: Watermark ───────────────────────────────────────────────────────

async function applyWatermark(inputPath, outputPath, cropFilter, delogoFilter = null) {
    // Build drawtext filter — matches watermark.js exactly
    const alpha      = WM_OPACITY;
    const drawtext   = [
        `drawtext=text='${WM_TEXT}'`,
        `fontsize=${WM_FONT_SIZE}`,
        `fontcolor=white@${alpha}`,
        `x=w-tw-${WM_MARGIN}`,
        `y=h-th-${WM_MARGIN}`,
        `shadowcolor=black@${(alpha * 0.7).toFixed(2)}`,
        `shadowx=1`,
        `shadowy=1`,
    ].join(':');

    // Chain: [crop,] [delogo,] drawtext — all in one FFmpeg pass
    const parts = [];
    if (cropFilter)   parts.push(cropFilter);
    if (delogoFilter) parts.push(delogoFilter);
    parts.push(drawtext);
    const vf = parts.join(',');

    await execFileAsync('ffmpeg', [
        '-i', inputPath,
        '-vf', vf,
        '-codec:a', 'copy',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-movflags', '+faststart',
        '-y',
        outputPath,
    ], { timeout: 900000 }); // 15 min — large files
}

// ── Phase 2D: Xcadr screenshots downloader ────────────────────────────────────

/**
 * Download xcadr screenshot URLs to workDir as thumb_NNN.jpg files.
 * Returns paths array with the "best" thumbnail (at 1/3 of the array) moved to index 0.
 */
async function downloadXcadrScreenshots(screenshotUrls, workDir) {
    const paths = [];
    for (let i = 0; i < screenshotUrls.length; i++) {
        const url = screenshotUrls[i];
        const filePath = join(workDir, `thumb_${String(i + 1).padStart(3, '0')}.jpg`);
        try {
            const res = await axios({
                method:       'GET',
                url,
                responseType: 'arraybuffer',
                timeout:      15000,
                headers:      HEADERS,
            });
            await writeFile(filePath, res.data);
            paths.push(filePath);
        } catch (err) {
            logger.warn(`  [screenshots] Failed to download screenshot ${i + 1}: ${err.message}`);
        }
    }

    if (paths.length === 0) return [];

    // Move the "best" representative frame (1/3 position) to index 0 → becomes thumbnail_url
    const thumbnailIdx = Math.floor(paths.length / 3);
    if (thumbnailIdx > 0) {
        const [thumb] = paths.splice(thumbnailIdx, 1);
        paths.unshift(thumb);
    }

    return paths;
}

// ── Phase 2D: FFmpeg Thumbnails ───────────────────────────────────────────────

async function extractThumbnails(videoPath, workDir, duration) {
    const thumbPaths = [];

    // Spread THUMB_COUNT frames evenly from 10% to 90% of duration
    for (let i = 0; i < THUMB_COUNT; i++) {
        const pct       = 0.1 + (0.8 * i) / (THUMB_COUNT - 1);
        const timestamp = Math.floor(duration * pct);
        const outPath   = join(workDir, `thumb_${String(i + 1).padStart(3, '0')}.jpg`);

        await execFileAsync('ffmpeg', [
            '-ss', String(timestamp),
            '-i', videoPath,
            '-vframes', '1',
            '-vf', 'scale=320:-2',
            '-q:v', '3',
            '-y',
            outPath,
        ], { timeout: 30000 });

        thumbPaths.push(outPath);
    }

    return thumbPaths;
}

// ── Phase 2E: Preview clip ────────────────────────────────────────────────────

async function extractPreview(videoPath, workDir, duration) {
    // 6 seconds from the 30% mark (middle-ish, avoids title cards at start)
    const startAt  = Math.floor(duration * 0.3);
    const outPath  = join(workDir, 'preview.mp4');

    await execFileAsync('ffmpeg', [
        '-ss', String(startAt),
        '-i', videoPath,
        '-t', String(PREVIEW_SECS),
        '-vf', `scale=${PREVIEW_WIDTH}:-2`,
        '-codec:a', 'copy',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '28',
        '-movflags', '+faststart',
        '-y',
        outPath,
    ], { timeout: 120000 });

    return outPath;
}

// ── Phase 3: Upload to CDN ────────────────────────────────────────────────────

async function uploadAll(videoId, watermarkedPath, thumbPaths, previewPath) {
    const base = getVideoPath(videoId); // 'videos/{uuid}'

    // Upload watermarked video
    logger.info(`  [CDN] Uploading watermarked video...`);
    const videoUrl = await withRetry(
        () => uploadFile(watermarkedPath, `${base}/watermarked.mp4`, { videoId, step: 'xcadr-download', timeout: 900000 }),
        { maxRetries: 3, delayMs: 5000, label: `cdn:watermarked:${videoId}` }
    );

    // Upload thumbnails
    logger.info(`  [CDN] Uploading ${thumbPaths.length} thumbnails...`);
    const thumbUrls = [];
    for (let i = 0; i < thumbPaths.length; i++) {
        const remoteName = `thumb_${String(i + 1).padStart(3, '0')}.jpg`;
        const cdnUrl = await withRetry(
            () => uploadFile(thumbPaths[i], `${base}/${remoteName}`, { videoId, step: 'xcadr-thumb', timeout: 60000 }),
            { maxRetries: 3, delayMs: 3000, label: `cdn:thumb${i + 1}:${videoId}` }
        );
        thumbUrls.push(cdnUrl);
    }

    // Upload preview clip
    logger.info(`  [CDN] Uploading preview clip...`);
    let previewUrl = null;
    try {
        previewUrl = await withRetry(
            () => uploadFile(previewPath, `${base}/preview.mp4`, { videoId, step: 'xcadr-preview', timeout: 120000 }),
            { maxRetries: 3, delayMs: 3000, label: `cdn:preview:${videoId}` }
        );
    } catch (err) {
        logger.warn(`  [CDN] Preview upload failed (non-fatal): ${err.message}`);
    }

    return { videoUrl, thumbUrls, previewUrl };
}

// ── Phase 4: DB update ────────────────────────────────────────────────────────

async function updateDb(videoId, importId, updates) {
    const {
        videoUrl, videoSrcUrl, thumbUrls, previewUrl,
        duration, quality, xcadrSrc,
    } = updates;

    const durationFormatted = duration ? formatDuration(duration) : null;
    const screenshotsJsonb  = JSON.stringify(thumbUrls);
    const thumbnailUrl      = thumbUrls[0] || null;

    // Update videos table — set status to 'watermarked' so publish pipeline picks it up
    await query(
        `UPDATE videos SET
            video_url              = $1,
            video_url_watermarked  = $2,
            thumbnail_url          = $3,
            preview_url            = $4,
            screenshots            = $5::jsonb,
            duration_seconds       = $6,
            duration_formatted     = $7,
            quality                = $8,
            status                 = 'watermarked',
            updated_at             = NOW()
         WHERE id = $9`,
        [
            videoSrcUrl,          // $1 — original source URL
            videoUrl,             // $2 — CDN watermarked URL
            thumbnailUrl,         // $3
            previewUrl,           // $4
            screenshotsJsonb,     // $5
            duration || null,     // $6
            durationFormatted,    // $7
            quality,              // $8
            videoId,              // $9
        ]
    );

    // Log to processing_log
    await query(
        `INSERT INTO processing_log (video_id, step, status, metadata)
         VALUES ($1, 'xcadr-download', 'completed', $2::jsonb)`,
        [videoId, JSON.stringify({ importId, xcadrSrc, quality, duration, thumbCount: thumbUrls.length })]
    );
}

// ── Phase 5: Cleanup ──────────────────────────────────────────────────────────

async function cleanup(workDir) {
    try {
        await rm(workDir, { recursive: true, force: true });
    } catch (err) {
        logger.warn(`  [cleanup] Failed to remove ${workDir}: ${err.message}`);
    }
}

// ── Phase 1B: yt-dlp xcadr downloader ────────────────────────────────────────

/**
 * Use yt-dlp to download an xcadr video directly to workDir/original.mp4.
 * yt-dlp handles KVS session tokens and IP binding transparently.
 * Returns the local file path on success, or null on failure.
 */
async function downloadWithYtdlp(xcadrUrl, workDir) {
    await mkdir(workDir, { recursive: true });
    const outPath = join(workDir, 'original.mp4');
    try {
        const { stdout, stderr } = await execFileAsync('yt-dlp', [
            '--no-playlist',
            '--force-overwrites',   // always overwrite stale files from previous attempts
            '-o', outPath,
            '--no-progress',
            '--quiet',
            xcadrUrl,
        ], { timeout: 600000 }); // 10 min
        // Verify the file was written and is non-trivial
        const info = await stat(outPath);
        if (info.size < 10000) {
            logger.warn(`  [yt-dlp] Output too small (${info.size} bytes) — download failed`);
            return null;
        }
        logger.info(`  [yt-dlp] ✓ Downloaded: ${(info.size / 1024 / 1024).toFixed(1)} MB → ${outPath}`);
        return outPath;
    } catch (err) {
        logger.warn(`  [yt-dlp] Failed: ${err.message.substring(0, 200)}`);
        return null;
    }
}

// ── Main per-item processor ───────────────────────────────────────────────────

async function processItem(item) {
    const videoId = item.matched_video_id;
    const workDir = join(TMP_DIR, videoId);

    logger.info(`\n── Processing import #${item.id}: "${item.title_en || item.title_ru}" (video: ${videoId})`);

    // ── Phase 1: Find video URL ──────────────────────────────────────────────

    let srcVideoUrl  = null;
    let isXcadrSrc   = false;
    let isLocalFile  = false; // true when yt-dlp already wrote original.mp4 to workDir

    if (FORCE_SRC !== 'xcadr') {
        // Try boobsradar first
        logger.info('  [Phase 1A] Searching boobsradar...');
        srcVideoUrl = await findBoobsradarUrl(
            item.celebrity_name_en,
            item.movie_title_en,
            item.boobsradar_url // pre-built search URL from match-xcadr.js
        );
    }

    if (!srcVideoUrl && FORCE_SRC !== 'boobsradar') {
        // Fallback to xcadr direct page (via yt-dlp — handles session tokens + IP binding)
        logger.info('  [Phase 1B] Trying xcadr via yt-dlp...');
        const ytdlpResult = await downloadWithYtdlp(item.xcadr_url, workDir);
        if (ytdlpResult) {
            srcVideoUrl  = ytdlpResult;  // local file path
            isXcadrSrc   = true;
            isLocalFile  = true;
        }
    }

    if (!srcVideoUrl) {
        logger.warn(`  ✗ Could not find video URL for import #${item.id}`);
        await query(
            `INSERT INTO processing_log (video_id, step, status, metadata)
             VALUES ($1, 'xcadr-download', 'failed', $2::jsonb)`,
            [videoId, JSON.stringify({ importId: item.id, reason: 'no_video_url_found' })]
        );
        return { status: 'no_url' };
    }

    logger.info(`  ✓ Source: ${isXcadrSrc ? 'xcadr' : 'boobsradar'} — ${srcVideoUrl.substring(0, 80)}...`);

    // ── Phase 2: Download + process ──────────────────────────────────────────

    // workDir may already exist (created by yt-dlp in Phase 1B)
    await mkdir(workDir, { recursive: true });

    try {
        // 2A: Download (skip if yt-dlp already wrote original.mp4)
        const originalPath = join(workDir, 'original.mp4');
        let fileSize = 0;
        if (isLocalFile) {
            const info = await stat(originalPath);
            fileSize = info.size;
            logger.info(`  [Phase 2A] Using yt-dlp file: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
        } else {
            logger.info('  [Phase 2A] Downloading video...');
            try {
                // boobsradar: no special headers needed
                fileSize = await downloadVideo(srcVideoUrl, originalPath, {});
                logger.info(`  ✓ Downloaded: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
            } catch (err) {
                throw new Error(`Download failed: ${err.message}`);
            }
        }

        // Verify file exists and is non-empty
        const info = await stat(originalPath);
        if (info.size < 10000) throw new Error(`Downloaded file too small (${info.size} bytes) — likely an error page`);

        console.log('XCADR_PROGRESS:' + JSON.stringify({ step: 'download', status: 'running', current: 0, total: 0, item: videoId.substring(0, 8), substep: 'downloaded' }));

        // 2A.1: Get video metadata
        const duration   = await getVideoDuration(originalPath);
        const { width }  = await getVideoResolution(originalPath);
        const quality    = widthToQuality(width);
        logger.info(`  ✓ Metadata: ${duration}s, ${width}px → ${quality}`);

        if (duration < 5) throw new Error(`Video duration too short (${duration}s) — likely invalid`);

        // 2B: Cropdetect + delogo (xcadr only)
        let cropFilter   = null;
        let delogoFilter = null;
        if (isXcadrSrc) {
            logger.info('  [Phase 2B] Running cropdetect (xcadr source)...');
            cropFilter = await detectCrop(originalPath);

            // Delogo must use dimensions AFTER crop (delogo follows crop in filter chain).
            // If crop is applied, parse cropped W×H; otherwise use original resolution.
            let delogoW = width;
            let delogoH = (await getVideoResolution(originalPath)).height;
            if (cropFilter) {
                const cm = cropFilter.match(/crop=(\d+):(\d+)/);
                if (cm) { delogoW = Number(cm[1]); delogoH = Number(cm[2]); }
            }
            delogoFilter = buildDelogoFilter(delogoW, delogoH);
            logger.info(`  [Phase 2B] delogo: ${delogoW}x${delogoH} (${cropFilter ? 'post-crop' : 'original'}) → logoW=${Math.round(delogoW*0.22)} logoH=${Math.round(delogoH*0.06)}`);
        }

        // 2C: Watermark (+ crop + delogo if xcadr source)
        const watermarkedPath = join(workDir, 'watermarked.mp4');
        const phaseLabel = [cropFilter && 'crop', delogoFilter && 'delogo', 'watermark'].filter(Boolean).join(' + ');
        logger.info(`  [Phase 2C] Applying ${phaseLabel}...`);
        await withRetry(
            () => applyWatermark(originalPath, watermarkedPath, cropFilter, delogoFilter),
            { maxRetries: 2, delayMs: 5000, label: `watermark:${videoId}` }
        );
        const wmInfo = await stat(watermarkedPath);
        logger.info(`  ✓ Watermarked: ${(wmInfo.size / 1024 / 1024).toFixed(1)} MB`);
        console.log('XCADR_PROGRESS:' + JSON.stringify({ step: 'download', status: 'running', current: 0, total: 0, item: videoId.substring(0, 8), substep: 'watermarked' }));

        // 2D: Thumbnails — prefer xcadr screenshots over FFmpeg extraction
        let thumbPaths;
        const xcadrScreenshots = Array.isArray(item.screenshot_urls) ? item.screenshot_urls : [];

        if (xcadrScreenshots.length > 0) {
            logger.info(`  [Phase 2D] Downloading ${xcadrScreenshots.length} xcadr screenshots...`);
            thumbPaths = await downloadXcadrScreenshots(xcadrScreenshots, workDir);
            if (thumbPaths.length > 0) {
                logger.info(`  ✓ ${thumbPaths.length} xcadr screenshots downloaded`);
            } else {
                logger.warn('  [Phase 2D] All screenshot downloads failed — falling back to FFmpeg');
                thumbPaths = await extractThumbnails(watermarkedPath, workDir, duration);
                logger.info(`  ✓ ${thumbPaths.length} thumbnails extracted via FFmpeg`);
            }
        } else {
            logger.info(`  [Phase 2D] No xcadr screenshots — extracting ${THUMB_COUNT} via FFmpeg...`);
            thumbPaths = await extractThumbnails(watermarkedPath, workDir, duration);
            logger.info(`  ✓ ${thumbPaths.length} thumbnails extracted`);
        }

        // 2E: Preview clip
        logger.info(`  [Phase 2E] Generating preview clip (${PREVIEW_SECS}s)...`);
        const previewPath = await extractPreview(watermarkedPath, workDir, duration);
        logger.info(`  ✓ Preview clip ready`);

        // ── Phase 3: Upload to CDN ──────────────────────────────────────────

        let cdnVideoUrl  = null;
        let cdnThumbUrls = thumbPaths.map(() => null); // fallback: keep null
        let cdnPreviewUrl = null;

        if (!SKIP_UPLOAD) {
            logger.info('  [Phase 3] Uploading to CDN...');
            const uploaded = await uploadAll(videoId, watermarkedPath, thumbPaths, previewPath);
            cdnVideoUrl   = uploaded.videoUrl;
            cdnThumbUrls  = uploaded.thumbUrls;
            cdnPreviewUrl = uploaded.previewUrl;
            logger.info(`  ✓ CDN upload complete`);
            console.log('XCADR_PROGRESS:' + JSON.stringify({ step: 'download', status: 'running', current: 0, total: 0, item: videoId.substring(0, 8), substep: 'uploaded' }));
        } else {
            logger.info('  [Phase 3] Skipping CDN upload (--skip-upload)');
            cdnVideoUrl   = `local:${watermarkedPath}`;
            cdnThumbUrls  = thumbPaths;
            cdnPreviewUrl = previewPath;
        }

        // ── Phase 4: Update DB ──────────────────────────────────────────────

        logger.info('  [Phase 4] Updating database...');
        // If yt-dlp was used, store xcadr_url as source (not the local tmp path)
        const storedSrcUrl = isLocalFile ? item.xcadr_url : srcVideoUrl;
        await updateDb(videoId, item.id, {
            videoUrl:    cdnVideoUrl,
            videoSrcUrl: storedSrcUrl,
            thumbUrls:   cdnThumbUrls,
            previewUrl:  cdnPreviewUrl,
            duration,
            quality,
            xcadrSrc:    isXcadrSrc,
        });
        logger.info('  ✓ Database updated — video status → watermarked');

        // ── Phase 5: Cleanup ────────────────────────────────────────────────

        if (!KEEP_TMP && !SKIP_UPLOAD) {
            await cleanup(workDir);
            logger.info('  ✓ Tmp directory cleaned up');
        } else {
            logger.info(`  ↳ Tmp kept at: ${workDir}`);
        }

        return { status: 'ok', quality, duration, fileSize };

    } catch (err) {
        // Don't leave partial tmp on error
        if (!KEEP_TMP) await cleanup(workDir).catch(() => {});

        // Record in dead letter queue
        try {
            await recordFailure(videoId, 'xcadr-download', err, 1);
        } catch { /* non-fatal */ }

        logger.error(`  ✗ Failed: ${err.message}`);
        return { status: 'error', reason: err.message };
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    logger.info('='.repeat(60));
    logger.info('xcadr Download & Process — D.9');
    logger.info(`Limit: ${ITEM_ID ? 1 : LIMIT}, Source: ${FORCE_SRC || 'auto (boobsradar → xcadr)'}`);
    logger.info(`Skip upload: ${SKIP_UPLOAD}, Keep tmp: ${KEEP_TMP}`);
    logger.info('='.repeat(60));

    // Verify FFmpeg is available
    try {
        await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
    } catch {
        logger.error('FFmpeg not found. Install: apt install ffmpeg');
        process.exit(1);
    }

    // Ensure tmp directory
    await mkdir(TMP_DIR, { recursive: true });
    await mkdir(join(TMP_DIR, 'xcadr'), { recursive: true });

    // ── Query items to process ───────────────────────────────────────────────
    // xcadr_imports with status='imported' that have a linked video with no video_url
    let whereClause = `
        xi.status = 'imported'
        AND xi.matched_video_id IS NOT NULL
        AND v.video_url IS NULL`;

    const queryParams = [];
    if (ITEM_ID) {
        whereClause += ` AND xi.id = $1`;
        queryParams.push(ITEM_ID);
    } else {
        queryParams.push(LIMIT);
    }

    const result = await query(
        `SELECT
            xi.id,
            xi.xcadr_url,
            xi.boobsradar_url,
            xi.title_en,
            xi.title_ru,
            xi.celebrity_name_en,
            xi.movie_title_en,
            xi.matched_video_id,
            xi.screenshot_urls,
            v.title->>'en' AS video_title_en
         FROM xcadr_imports xi
         JOIN videos v ON v.id = xi.matched_video_id
         WHERE ${whereClause}
         ORDER BY xi.created_at ASC
         ${ITEM_ID ? '' : `LIMIT $1`}`,
        queryParams
    );

    const items = result.rows;

    if (items.length === 0) {
        logger.info('No items to process. Import videos first via auto-import.js --auto-import');
        await pool.end();
        return;
    }

    logger.info(`\nFound ${items.length} item(s) to download and process\n`);

    const startedAt = Date.now();
    let ok = 0, noUrl = 0, errors = 0;

    for (let _di = 0; _di < items.length; _di++) {
        const item = items[_di];
        console.log('XCADR_PROGRESS:' + JSON.stringify({ step: 'download', status: 'running', current: _di + 1, total: items.length, item: item.title_en || item.title_ru, substep: 'starting' }));
        const result = await processItem(item);
        switch (result.status) {
            case 'ok':    ok++;    break;
            case 'no_url': noUrl++; break;
            case 'error': errors++; break;
        }
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);

    logger.info('\n' + '='.repeat(60));
    logger.info('=== Download & Process Summary ===');
    logger.info(`Processed:  ${items.length}`);
    logger.info(`Success:    ${ok}`);
    logger.info(`No URL:     ${noUrl}`);
    logger.info(`Errors:     ${errors}`);
    logger.info(`Time:       ${elapsed}s`);
    logger.info('='.repeat(60));

    await pool.end();
}

main().catch((err) => {
    logger.error('[FATAL]', err);
    process.exit(1);
});
