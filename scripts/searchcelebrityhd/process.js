#!/usr/bin/env node
/**
 * process.js — SearchCelebrityHD AI Processing
 *
 * Takes scraped data from raw_videos and processes with Gemini:
 *   - Downloads source screenshots (already on searchcelebrityhd.com)
 *   - Sends screenshots to Gemini Vision for tag analysis
 *   - Uses existing description (translates to 10 languages)
 *   - Creates video entry with multilingual data
 *
 * Key difference from boobsradar pipeline:
 *   - NO video upload to Gemini (avoids blocking)
 *   - Screenshots analyzed instead → accurate tags
 *   - Description already exists → just translate
 *   - Celebrity/movie already parsed from page tags
 *
 * Usage:
 *   node process.js                    # process all pending
 *   node process.js --limit=10         # limit to 10
 *   node process.js --id=<uuid>        # process specific raw_video
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import slugify from 'slugify';
import axios from 'axios';
import { config } from '../lib/config.js';
import {
  getPendingVideos, markRawVideoProcessed, markRawVideoFailed,
  insertVideo, findOrCreateCelebrity, linkVideoCelebrity,
  findOrCreateTag, linkVideoTag, findOrCreateMovie,
  findOrCreateCategory, linkVideoCategory,
  findOrCreateCollection, linkVideoCollection,
  linkMovieScene, linkMovieCelebrity, log as dbLog,
  query,
} from '../lib/db.js';
import logger from '../lib/logger.js';
import { writeProgress, completeStep, setActiveItem, removeActiveItem } from '../lib/progress.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const GEMINI_API_KEY = config.ai.geminiApiKey;
const GEMINI_MODEL = process.argv.find(a => a.startsWith('--model='))?.split('=')[1] || config.ai.geminiModel;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];

// ============================================
// System Prompt — screenshot-based analysis
// ============================================

const SYSTEM_PROMPT = `You are a connoisseur of erotic cinema and celebrity nude scenes. Analyze the provided screenshots from a video scene and generate MULTILINGUAL structured data for celeb.skin.

TASK: Study ALL provided screenshots carefully. Generate content in ALL 10 languages: en, ru, de, fr, es, pt, it, pl, nl, tr.

TAG TAXONOMY — pick ONLY from this fixed list (return English slugs):
Nudity Level: topless, full-frontal, butt, pussy, bush, nude, sideboob, see-through, implied-nudity, cleavage
Scene Type: sex-scene, explicit, mainstream, blowjob, cunnilingus, lesbian, masturbation, striptease, threesome, group-sex, bdsm, romantic, rape-scene
Setting: shower, bath, pool, beach, bed-scene, outdoor
Source: movie, tv-series, photoshoot
Body: pregnant, tattoo

STRICT TAG RULES:
- ONLY tag what you can LITERALLY SEE in the screenshots. Do NOT guess.
- "full-frontal" = you can clearly see BOTH breasts AND genitals from the front in the same screenshot. If you only see breasts → "topless".
- "pussy" = female genitals are CLEARLY and UNAMBIGUOUSLY visible. Shadows/dark areas do NOT count.
- "bush" = pubic hair is clearly visible.
- "explicit" = ONLY for screenshots showing real/unsimulated sex acts. Standard nude scene → NOT explicit.
- "mainstream" = standard cinema/TV nudity (topless, brief nudity). DEFAULT for most movie/TV scenes.
- "topless" = bare breasts clearly visible. Most common tag.
- "butt" = bare buttocks prominently visible.
- "sideboob" = ONLY side of breast visible.
- "implied-nudity" = nudity suggested but NOT shown.
- Select 3-6 tags maximum. When in doubt, choose LESS explicit tag.
- Always include exactly one Source tag.
- Return tags as {"en": ["topless", "bed-scene", "movie"], "ru": ["Топлес", "Постельная сцена", "Фильм"], ...}

HOT SCREENSHOTS — mark which screenshot numbers show the most nudity:
- Return "hot_screenshots": array of screenshot indices (0-based) with intensity
- Each: {"index": 3, "intensity": 1-5, "label": "what is visible"}
- intensity 5 = full nudity; 4 = topless; 3 = partial; 2 = underwear; 1 = cleavage
- "best_thumbnail_index": index of the BEST screenshot for video thumbnail (most visually striking nudity)

DESCRIPTION STYLE (field "review"):
- Write 2-3 sentences from the perspective of an erotic cinema connoisseur
- Format: who (actress name), where from (movie/series, year), what is visible
- Tone: factual but appreciative
- Do NOT write generic SEO filler

OUTPUT FORMAT (strict JSON):
{
  "title": {"en": "...", "ru": "...", ...all 10 locales},
  "slug": {"en": "actress-name-nude-movie-title", ...},
  "review": {"en": "2-3 sentences...", ...},
  "seo_title": {"en": "up to 60 chars", ...},
  "seo_description": {"en": "up to 160 chars", ...},
  "celebrities": ["Full Name"],
  "movie_title": "Movie Title",
  "movie_title_localized": {"ru": "...", "de": "...", ...},
  "year": 2003,
  "tags": {"en": ["topless", "butt", "movie"], "ru": ["Топлес", "Попа", "Фильм"], ...},
  "hot_screenshots": [{"index": 3, "intensity": 4, "label": "topless in bed"}],
  "best_thumbnail_index": 3,
  "quality": "1080p",
  "confidence": 0.92
}

RULES:
- Celebrity names: ONLY use names from the provided metadata. NEVER invent names.
- Confidence: 0.9+ if celebrity in metadata AND screenshots show clear nudity. Lower otherwise.
- Maximum 6 tags.
- RESPOND ONLY WITH VALID JSON, no markdown.`;

function makeSlug(text) {
  if (!text) return '';
  let slug = slugify(text, { lower: true, strict: true, locale: 'en' });
  if (slug.length > 60) {
    const trimmed = slug.substring(0, 60);
    const lastDash = trimmed.lastIndexOf('-');
    slug = lastDash > 10 ? trimmed.substring(0, lastDash) : trimmed;
  }
  return slug;
}

// ============================================
// Download screenshots and convert to base64
// ============================================

async function downloadScreenshots(screenshotUrls, maxCount = 10) {
  const images = [];
  // Take evenly spaced screenshots if more than maxCount
  let urls = screenshotUrls;
  if (urls.length > maxCount) {
    const step = urls.length / maxCount;
    urls = Array.from({ length: maxCount }, (_, i) => screenshotUrls[Math.floor(i * step)]);
  }

  for (const url of urls) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const base64 = Buffer.from(response.data).toString('base64');
      const mimeType = response.headers['content-type'] || 'image/jpeg';
      images.push({ base64, mimeType, url });
    } catch (err) {
      logger.warn(`  Failed to download screenshot: ${url} — ${err.message}`);
    }
  }

  return images;
}

// ============================================
// Call Gemini with screenshots
// ============================================

async function callGeminiWithScreenshots(rawVideo, screenshots) {
  const extraData = typeof rawVideo.extra_data === 'string'
    ? JSON.parse(rawVideo.extra_data)
    : rawVideo.extra_data || {};

  const userPrompt = `Analyze these ${screenshots.length} screenshots from a celebrity nude scene and return multilingual JSON.

Metadata:
Title: ${rawVideo.raw_title || 'unknown'}
Description: ${rawVideo.raw_description || 'none'}
Celebrities: ${(rawVideo.raw_celebrities || []).join(', ') || 'unknown'}
Movie: ${extraData.movie_title || 'unknown'} (${extraData.year || 'unknown'})
Duration: ${rawVideo.duration_seconds ? rawVideo.duration_seconds + 's' : 'unknown'}

IMPORTANT: Tag ONLY what you see in these screenshots. Do not guess.`;

  // Build parts: screenshots as inline images + text prompt
  const parts = [];

  for (let i = 0; i < screenshots.length; i++) {
    parts.push({
      inlineData: {
        mimeType: screenshots[i].mimeType,
        data: screenshots[i].base64,
      },
    });
    parts.push({ text: `[Screenshot ${i + 1} of ${screenshots.length}]` });
  }

  parts.push({ text: SYSTEM_PROMPT + '\n\n' + userPrompt });

  logger.info(`  Calling Gemini with ${screenshots.length} screenshots...`);

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 65536,
        responseMimeType: 'application/json',
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err.substring(0, 300)}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;

  if (!text) {
    const blockReason = candidate?.finishReason || data.promptFeedback?.blockReason || 'unknown';
    throw new Error(`Gemini blocked response (reason: ${blockReason})`);
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch (parseErr) {
    // Try to fix JSON
    let fixed = text
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']')
      .replace(/[\x00-\x1F]/g, ' ');
    try {
      result = JSON.parse(fixed);
    } catch {
      const lastBrace = fixed.lastIndexOf('}');
      if (lastBrace > 0) {
        result = JSON.parse(fixed.substring(0, lastBrace + 1));
      } else {
        throw new Error(`Invalid JSON from Gemini: ${parseErr.message}`);
      }
    }
  }

  return result;
}

// ============================================
// Process single video
// ============================================

async function processVideo(rawVideo) {
  const extraData = typeof rawVideo.extra_data === 'string'
    ? JSON.parse(rawVideo.extra_data)
    : rawVideo.extra_data || {};

  logger.info(`Processing: ${rawVideo.raw_title}`);

  // 1. Get screenshot URLs from extra_data
  const screenshotUrls = extraData.screenshots || [];
  if (screenshotUrls.length === 0) {
    throw new Error('No screenshots found in extra_data');
  }
  logger.info(`  ${screenshotUrls.length} screenshots available`);

  // 2. Download screenshots
  const screenshots = await downloadScreenshots(screenshotUrls, 10);
  if (screenshots.length === 0) {
    throw new Error('Failed to download any screenshots');
  }
  logger.info(`  ${screenshots.length} screenshots downloaded for AI analysis`);

  // 3. Call Gemini with screenshots
  const ai = await callGeminiWithScreenshots(rawVideo, screenshots);
  logger.info(`  AI: confidence=${ai.confidence}, tags=${(ai.tags?.en || []).join(', ')}`);

  // 4. Generate slugs
  const slugs = ai.slug || {};
  for (const loc of LOCALES) {
    if (!slugs[loc]) {
      const title = ai.title?.[loc] || ai.title?.en || rawVideo.raw_title;
      slugs[loc] = makeSlug(title);
    }
  }

  // 5. Determine status
  let videoStatus;
  if (ai.confidence >= 0.8) {
    videoStatus = 'enriched';
  } else if (ai.confidence >= 0.5) {
    videoStatus = 'needs_review';
  } else {
    videoStatus = 'needs_review';
  }

  // 6. Pick best thumbnail and build screenshot URLs for DB
  const bestIdx = ai.best_thumbnail_index || 0;
  const thumbnailUrl = screenshotUrls[bestIdx] || screenshotUrls[0];

  // 7. Insert video
  const videoId = await insertVideo({
    raw_video_id: rawVideo.id,
    title: JSON.stringify(ai.title || {}),
    slug: JSON.stringify(slugs),
    review: JSON.stringify(ai.review || {}),
    seo_title: JSON.stringify(ai.seo_title || {}),
    seo_description: JSON.stringify(ai.seo_description || {}),
    original_title: rawVideo.raw_title,
    quality: ai.quality || null,
    duration_seconds: rawVideo.duration_seconds,
    duration_formatted: ai.duration_formatted || null,
    video_url: rawVideo.video_file_url,
    thumbnail_url: thumbnailUrl,
    ai_model: GEMINI_MODEL,
    ai_confidence: ai.confidence || 0,
    ai_raw_response: JSON.stringify(ai),
    status: videoStatus,
  });

  logger.info(`  Video created: ${videoId} (status=${videoStatus})`);

  // 8. Save source screenshots to DB (from searchcelebrityhd CDN — these are ready to use)
  await query(
    `UPDATE videos SET screenshots = $1::jsonb WHERE id = $2`,
    [JSON.stringify(screenshotUrls), videoId]
  );
  logger.info(`  Saved ${screenshotUrls.length} source screenshots`);

  // 9. Save hot_screenshots as hot_moments (using screenshot index, not video timestamp)
  // For timeline markers we don't have timestamps, but we have screenshot intensities
  // Store in hot_moments for future use when we process the actual video
  if (ai.hot_screenshots?.length > 0) {
    // Convert screenshot indices to approximate timestamps if we know duration
    const duration = rawVideo.duration_seconds || 0;
    let hotMoments = [];
    if (duration > 0) {
      hotMoments = ai.hot_screenshots
        .filter(h => h.index >= 0 && h.index < screenshotUrls.length)
        .map(h => ({
          timestamp_sec: Math.round((h.index / screenshotUrls.length) * duration),
          intensity: h.intensity,
          label: h.label,
        }));
    }
    if (hotMoments.length > 0) {
      await query(
        `UPDATE videos SET hot_moments = $1::jsonb WHERE id = $2`,
        [JSON.stringify(hotMoments), videoId]
      );
      logger.info(`  Saved ${hotMoments.length} hot moments (estimated from screenshots)`);
    }
  }

  // 10. Link celebrities — ONLY from source metadata
  const rawCelebNames = new Set((rawVideo.raw_celebrities || []).map(n => n.toLowerCase().trim()));
  for (const celName of (ai.celebrities || [])) {
    const celSlug = makeSlug(celName);
    if (!celSlug) continue;
    if (['unknown', 'n/a'].includes(celName.toLowerCase())) continue;

    // Verify celebrity is from source metadata
    const nameLower = celName.toLowerCase().trim();
    const nameInMeta = rawCelebNames.has(nameLower) ||
      [...rawCelebNames].some(rc => rc.includes(nameLower) || nameLower.includes(rc)) ||
      (rawVideo.raw_title || '').toLowerCase().includes(nameLower);

    if (!nameInMeta) {
      logger.warn(`  Skipping hallucinated celebrity: "${celName}"`);
      continue;
    }
    const celId = await findOrCreateCelebrity(celName, celSlug);
    await linkVideoCelebrity(videoId, celId);
    logger.info(`  Linked celebrity: ${celName}`);
  }

  // 11. Link tags — ONLY canonical, max 6
  const MAX_TAGS = 6;
  const enTags = (ai.tags?.en || []).slice(0, MAX_TAGS);
  let linkedTags = 0;
  for (const tagSlugRaw of enTags) {
    const tagSlug = makeSlug(tagSlugRaw);
    if (!tagSlug) continue;
    const { rows } = await query(
      `SELECT id FROM tags WHERE slug = $1 AND is_canonical = true`,
      [tagSlug]
    );
    if (rows.length > 0) {
      await linkVideoTag(videoId, rows[0].id);
      linkedTags++;
    } else {
      logger.warn(`  Non-canonical tag skipped: "${tagSlugRaw}"`);
    }
  }
  logger.info(`  Linked ${linkedTags} tags`);

  // 12. Link movie
  if (ai.movie_title || extraData.movie_title) {
    const movieTitle = ai.movie_title || extraData.movie_title;
    const movieSlug = makeSlug(movieTitle);
    const movieId = await findOrCreateMovie({
      title: movieTitle,
      title_localized: ai.movie_title_localized || {},
      slug: movieSlug,
      year: ai.year || extraData.year || null,
      genres: [],
      ai_matched: true,
    });
    await linkMovieScene(movieId, videoId);
    for (const celName of (ai.celebrities || [])) {
      const celSlug = makeSlug(celName);
      if (!celSlug) continue;
      const celId = await findOrCreateCelebrity(celName, celSlug);
      await linkMovieCelebrity(movieId, celId);
    }
    logger.info(`  Linked movie: ${movieTitle}`);
  }

  // 13. Log
  await dbLog(videoId, 'ai_process', 'success',
    `SearchCelebrityHD: ${GEMINI_MODEL}, confidence=${ai.confidence}, screenshots=${screenshots.length}`,
    { source: 'searchcelebrityhd', screenshots_analyzed: screenshots.length }
  );

  await markRawVideoProcessed(rawVideo.id);
  return videoId;
}

// ============================================
// Main
// ============================================

const args = process.argv.slice(2);
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '10');
const specificId = args.find(a => a.startsWith('--id='))?.split('=')[1];

logger.info('=== SearchCelebrityHD AI Processing ===');
logger.info(`Model: ${GEMINI_MODEL}, Limit: ${limit}`);

if (!GEMINI_API_KEY) {
  logger.error('GEMINI_API_KEY not set');
  process.exit(1);
}

let pending;
if (specificId) {
  const { rows } = await query('SELECT * FROM raw_videos WHERE id = $1', [specificId]);
  pending = rows;
} else {
  pending = await getPendingVideos(limit);
}

logger.info(`Found ${pending.length} pending videos`);

let processed = 0, failed = 0;
const errors = [];

for (const raw of pending) {
  try {
    setActiveItem(raw.id, { label: raw.raw_title || raw.id, subStep: 'Gemini Vision', pct: 0 });
    await processVideo(raw);
    removeActiveItem(raw.id);
    processed++;
    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  } catch (err) {
    removeActiveItem(raw.id);
    logger.error(`Failed: ${raw.raw_title} — ${err.message}`);
    await markRawVideoFailed(raw.id, err.message);
    failed++;
    errors.push({ id: raw.id, title: raw.raw_title, error: err.message });
  }
}

completeStep({
  videosDone: processed,
  videosTotal: pending.length,
  errors: errors.slice(-20),
  errorCount: failed,
});

logger.info(`=== Done: ${processed} processed, ${failed} failed ===`);
