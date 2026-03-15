#!/usr/bin/env node
/**
 * process-ai.js — AI Processing via Screenshots (SearchCelebrityHD)
 *
 * Instead of uploading full video to Gemini (which gets blocked for NSFW):
 *   1. Downloads screenshots from the source page (already captured by them)
 *   2. Sends screenshots as images to Gemini for tag analysis
 *   3. Uses source description for review text (translate to 10 langs)
 *   4. Celebrities + movie already extracted during scrape
 *
 * This avoids Gemini video blocking entirely — image analysis works for NSFW.
 *
 * Usage:
 *   node process-ai.js                   # process all pending
 *   node process-ai.js --limit=10        # limit
 *   node process-ai.js --model=gemini-2.5-pro  # model override
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import slugify from 'slugify';
import axios from 'axios';
import { config } from '../lib/config.js';
import { query, markRawVideoProcessed, markRawVideoFailed,
  insertVideo, findOrCreateCelebrity, linkVideoCelebrity,
  findOrCreateTag, linkVideoTag, findOrCreateMovie,
  linkMovieScene, linkMovieCelebrity, log as dbLog,
} from '../lib/db.js';
import logger from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const GEMINI_API_KEY = config.ai.geminiApiKey;
const _cliModel = process.argv.find(a => a.startsWith('--model='));
const GEMINI_MODEL = _cliModel ? _cliModel.split('=')[1] : 'gemini-3-flash-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];
const MAX_SCREENSHOTS_FOR_AI = 6; // send up to 6 screenshots to Gemini

function makeSlug(text) {
  return slugify(text, { lower: true, strict: true, locale: 'en' });
}

// Get pending videos from searchcelebrityhd source only (with screenshots)
async function getSearchCelebPending(limit) {
  const { rows } = await query(
    `UPDATE raw_videos
     SET status = 'processing', updated_at = NOW()
     WHERE id IN (
       SELECT id FROM raw_videos
       WHERE status = 'pending'
         AND extra_data->>'source' = 'searchcelebrityhd'
         AND (extra_data->>'screenshot_count')::int > 0
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [limit]
  );
  return rows;
}

// ============================================
// Download screenshots for AI analysis
// ============================================

async function downloadScreenshots(screenshotUrls, workDir) {
  await mkdir(workDir, { recursive: true });
  const downloaded = [];

  // Take evenly spaced screenshots (max MAX_SCREENSHOTS_FOR_AI)
  const step = Math.max(1, Math.floor(screenshotUrls.length / MAX_SCREENSHOTS_FOR_AI));
  const selected = [];
  for (let i = 0; i < screenshotUrls.length && selected.length < MAX_SCREENSHOTS_FOR_AI; i += step) {
    selected.push(screenshotUrls[i]);
  }

  for (let i = 0; i < selected.length; i++) {
    const url = selected[i];
    const filePath = join(workDir, `screenshot_${i + 1}.jpg`);
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      await writeFile(filePath, response.data);
      downloaded.push({ path: filePath, url, data: response.data });
    } catch (err) {
      logger.warn(`  Screenshot download failed: ${url} — ${err.message}`);
    }
  }

  return downloaded;
}

// ============================================
// Call Gemini with screenshots
// ============================================

const SYSTEM_PROMPT = `You are an expert curator for celeb.skin — a celebrity nude scenes database.
Analyze the provided screenshots from a movie/TV scene and generate accurate tags and multilingual content.

CRITICAL RULES:
1. ONLY describe what you can SEE in the screenshots. Do NOT guess.
2. NEVER invent celebrity names — use ONLY the names provided in metadata.
3. Be conservative with tags — when in doubt, choose the LESS explicit tag.

TAG TAXONOMY (use ONLY these English slugs):
Nudity: topless, full-frontal, butt, pussy, bush, nude, sideboob, see-through, implied-nudity, cleavage
Scene: sex-scene, explicit, mainstream, blowjob, cunnilingus, lesbian, masturbation, striptease, threesome, group-sex, bdsm, romantic, rape-scene
Setting: shower, bath, pool, beach, bed-scene, outdoor
Source: movie, tv-series, photoshoot
Body: pregnant, tattoo

TAG DEFINITIONS:
- "full-frontal" = BOTH breasts AND genitals clearly visible from front. If only breasts → "topless"
- "pussy" = genitals CLEARLY visible. Shadows/glimpses do NOT count
- "explicit" = real/unsimulated sex. Standard movie nudity = "mainstream"
- "topless" = bare breasts clearly visible (most common tag)
- "implied-nudity" = nudity suggested but not shown (covered by sheets, shot from behind)
- Select 3-6 tags. MUST include one Source tag.

DESCRIPTION STYLE (field "review"):
- 2-3 sentences. Who (full name), where (movie/series, year), what nudity is visible.
- Tone: factual, appreciative, like an expert curator.

OUTPUT (strict JSON):
{
  "title": {"en": "...", "ru": "...", ...all 10 langs},
  "slug": {"en": "actress-nude-movie-title", ...},
  "review": {"en": "2-3 sentences", ...},
  "seo_title": {"en": "up to 60 chars", ...},
  "seo_description": {"en": "up to 160 chars", ...},
  "tags": {"en": ["topless", "bed-scene", "movie"], "ru": ["Топлес", "Постельная сцена", "Фильм"], ...},
  "quality": "1080p",
  "confidence": 0.9
}

RULES:
- All fields MUST have ALL 10 language keys: en, ru, de, fr, es, pt, it, pl, nl, tr
- Tags "en" = ONLY slugs from taxonomy
- Maximum 6 tags
- RESPOND ONLY WITH VALID JSON`;

async function callGeminiWithScreenshots(rawVideo, screenshots) {
  const extraData = typeof rawVideo.extra_data === 'string'
    ? JSON.parse(rawVideo.extra_data)
    : rawVideo.extra_data || {};

  const userPrompt = `Analyze these ${screenshots.length} screenshots from a celebrity nude scene:

Celebrity: ${(rawVideo.raw_celebrities || []).join(', ') || 'unknown'}
Movie/Show: ${extraData.movie_title || 'unknown'} (${extraData.year || 'unknown'})
Source description: ${rawVideo.raw_description || 'none'}
Source tags: ${(rawVideo.raw_tags || []).join(', ') || 'none'}

Look at ALL screenshots carefully. Identify what nudity/body parts are ACTUALLY VISIBLE.
Generate multilingual content for celeb.skin.`;

  // Build parts: screenshots as inline images + text
  const parts = [];

  for (const shot of screenshots) {
    const base64 = shot.data.toString('base64');
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64,
      },
    });
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
        maxOutputTokens: 32768,
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
    throw new Error(`Gemini API error ${response.status}: ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'unknown';
    logger.error(`  Gemini full response: ${JSON.stringify(data).substring(0, 500)}`);
    throw new Error(`Gemini returned empty response (reason: ${reason})`);
  }

  let result;
  // Strip markdown code block wrapper if present
  let cleanText = text.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  try {
    result = JSON.parse(cleanText);
  } catch (err) {
    // Try to fix common JSON issues
    let fixed = cleanText.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    try {
      result = JSON.parse(fixed);
    } catch {
      const lastBrace = fixed.lastIndexOf('}');
      if (lastBrace > 0) {
        result = JSON.parse(fixed.substring(0, lastBrace + 1));
      } else {
        throw new Error(`Invalid JSON from Gemini: ${err.message}`);
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

  // 1. Download screenshots for AI analysis
  const screenshotUrls = extraData.screenshots || [];
  if (screenshotUrls.length === 0) {
    throw new Error('No screenshots available — cannot analyze');
  }

  const workDir = join(__dirname, '..', 'tmp', rawVideo.id);
  const screenshots = await downloadScreenshots(screenshotUrls, workDir);
  if (screenshots.length === 0) {
    throw new Error('All screenshot downloads failed');
  }
  logger.info(`  Downloaded ${screenshots.length}/${screenshotUrls.length} screenshots`);

  // 2. Call Gemini with screenshots
  const ai = await callGeminiWithScreenshots(rawVideo, screenshots);
  logger.info(`  AI: confidence=${ai.confidence}, tags=${(ai.tags?.en || []).join(', ')}`);

  // 3. Generate slugs
  const slugs = ai.slug || {};
  for (const loc of LOCALES) {
    if (!slugs[loc]) {
      const title = ai.title?.[loc] || ai.title?.en || rawVideo.raw_title;
      slugs[loc] = makeSlug(title);
    }
  }

  // 4. Determine status
  const confidence = ai.confidence || 0.8;
  const videoStatus = confidence >= 0.8 ? 'enriched' : 'needs_review';

  // 5. Insert video
  const videoId = await insertVideo({
    raw_video_id: rawVideo.id,
    title: JSON.stringify(ai.title || {}),
    slug: JSON.stringify(slugs),
    review: JSON.stringify(ai.review || {}),
    seo_title: JSON.stringify(ai.seo_title || {}),
    seo_description: JSON.stringify(ai.seo_description || {}),
    original_title: rawVideo.raw_title,
    quality: ai.quality || '1080p',
    duration_seconds: rawVideo.duration_seconds,
    duration_formatted: null,
    video_url: rawVideo.video_file_url,
    thumbnail_url: rawVideo.thumbnail_url,
    ai_model: GEMINI_MODEL,
    ai_confidence: confidence,
    ai_raw_response: JSON.stringify({ ...ai, source_screenshots: screenshotUrls }),
    status: videoStatus,
  });

  logger.info(`  Video created: ${videoId} (status=${videoStatus})`);

  // 6. Save source screenshots as video screenshots (CDN URLs from source)
  if (screenshotUrls.length > 0) {
    await query(
      `UPDATE videos SET screenshots = $1::jsonb WHERE id = $2`,
      [JSON.stringify(screenshotUrls), videoId]
    );
    // Set thumbnail to last screenshot (usually the best one)
    const bestThumb = screenshotUrls[screenshotUrls.length - 1];
    await query(
      `UPDATE videos SET thumbnail_url = $1 WHERE id = $2`,
      [bestThumb, videoId]
    );
  }

  // 7. Link celebrities — ONLY from source metadata
  const rawCelebNames = new Set((rawVideo.raw_celebrities || []).map(n => n.toLowerCase().trim()));
  for (const celName of (rawVideo.raw_celebrities || [])) {
    const celSlug = makeSlug(celName);
    if (!celSlug) continue;
    const celId = await findOrCreateCelebrity(celName, celSlug);
    await linkVideoCelebrity(videoId, celId);
    logger.info(`  Linked celebrity: ${celName}`);
  }

  // 8. Link tags (max 6, only canonical)
  const MAX_TAGS = 6;
  const enTags = (ai.tags?.en || []).slice(0, MAX_TAGS);
  let linkedTags = 0;
  for (const tagSlug of enTags) {
    const slug = makeSlug(tagSlug);
    if (!slug) continue;
    const { rows } = await query(
      `SELECT id FROM tags WHERE slug = $1 AND is_canonical = true`,
      [slug]
    );
    if (rows.length > 0) {
      await linkVideoTag(videoId, rows[0].id);
      linkedTags++;
    } else {
      logger.warn(`  Non-canonical tag: "${tagSlug}" — skipped`);
    }
  }
  logger.info(`  Linked ${linkedTags}/${enTags.length} tags`);

  // 9. Link movie
  if (extraData.movie_title) {
    const movieSlug = makeSlug(extraData.movie_title);
    const movieId = await findOrCreateMovie({
      title: extraData.movie_title,
      title_localized: {},
      slug: movieSlug,
      year: extraData.year || null,
      studio: null,
      director: null,
      genres: [],
      ai_matched: true,
    });
    await linkMovieScene(movieId, videoId);
    for (const celName of (rawVideo.raw_celebrities || [])) {
      const celSlug = makeSlug(celName);
      if (!celSlug) continue;
      const celId = await findOrCreateCelebrity(celName, celSlug);
      await linkMovieCelebrity(movieId, celId);
    }
    logger.info(`  Linked movie: ${extraData.movie_title} (${extraData.year})`);
  }

  // 10. Log
  await dbLog(videoId, 'ai_process', 'success',
    `Processed with ${GEMINI_MODEL} via ${screenshots.length} screenshots, confidence=${confidence}`,
    { source: 'searchcelebrityhd', screenshots: screenshots.length }
  );

  await markRawVideoProcessed(rawVideo.id);
  return videoId;
}

// ============================================
// Main
// ============================================

const args = process.argv.slice(2);
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '10');

logger.info('=== SearchCelebrityHD AI Processing (Screenshots) ===');
logger.info(`Model: ${GEMINI_MODEL}, Limit: ${limit}`);

if (!GEMINI_API_KEY) {
  logger.error('GEMINI_API_KEY not set');
  process.exit(1);
}

const pending = await getSearchCelebPending(limit);
logger.info(`Found ${pending.length} pending videos`);

let processed = 0, failed = 0;

for (const raw of pending) {
  try {
    await processVideo(raw);
    processed++;
    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  } catch (err) {
    logger.error(`Failed: ${raw.raw_title} — ${err.message}`);
    await markRawVideoFailed(raw.id, err.message);
    failed++;
  }
}

logger.info(`\n=== Done: ${processed} processed, ${failed} failed ===`);
