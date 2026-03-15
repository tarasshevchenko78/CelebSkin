#!/usr/bin/env node
/**
 * process-with-ai.js — AI обработка через Gemini 2.5 Flash
 * Один вызов → JSONB для 10 языков (title, review, seo, slugs)
 * Автоматически определяет знаменитостей, фильмы, теги
 *
 * 3-УРОВНЕВОЕ РАСПОЗНАВАНИЕ:
 *   Level 1: Текстовые метаданные → Gemini (быстро)
 *   Level 2: Визуальное распознавание кадров → Gemini Vision (если Level 1 < 0.5)
 *   Level 3: Ручная модерация в админке (если Level 1+2 не справились)
 *
 * Usage:
 *   node process-with-ai.js [--limit=10] [--auto-publish] [--model=gemini-2.5-pro]
 *   node process-with-ai.js --visual-only   # только визуальное распознавание
 *   node process-with-ai.js --skip-visual   # пропустить визуальное распознавание
 */

import path from 'path';
import { fileURLToPath } from 'url';
import slugify from "slugify";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { config } from "./lib/config.js";
import {
  getPendingVideos, markRawVideoProcessed, markRawVideoFailed,
  insertVideo, findOrCreateCelebrity, linkVideoCelebrity,
  findOrCreateTag, linkVideoTag, findOrCreateMovie,
  findOrCreateCategory, linkVideoCategory,
  findOrCreateCollection, linkVideoCollection,
  linkMovieScene, linkMovieCelebrity, log as dbLog,
  query,
} from "./lib/db.js";
import logger from "./lib/logger.js";
import { writeProgress, clearProgress, completeStep, setActiveItem, removeActiveItem } from "./lib/progress.js";
import { smartRecognize } from "./lib/visual-recognizer.js";
import { extractBestFrame, extractKeyFrames, cleanupFrames } from "./lib/frame-extractor.js";
import axios from "axios";
import { createWriteStream } from "fs";
import { pipeline as streamPipeline } from "stream/promises";
import { mkdir, access, readFile, stat } from "fs/promises";

const GEMINI_API_KEY = config.ai.geminiApiKey;
// CLI override: --model=gemini-2.5-pro | gemini-2.0-flash | gemini-2.0-pro
const _cliModel = process.argv.find(a => a.startsWith("--model="));
const GEMINI_MODEL = _cliModel ? _cliModel.split("=")[1] : config.ai.geminiModel;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const VISUAL_ONLY = process.argv.includes("--visual-only");
const SKIP_VISUAL = process.argv.includes("--skip-visual");

const LOCALES = ["en", "ru", "de", "fr", "es", "pt", "it", "pl", "nl", "tr"];

const SYSTEM_PROMPT = `You are a connoisseur of erotic cinema and celebrity nude scenes. Watch the provided video carefully and analyze it together with metadata to generate MULTILINGUAL structured data for celeb.skin.

TASK: Watch the video (if provided), analyze metadata, and generate content in ALL 10 languages: en, ru, de, fr, es, pt, it, pl, nl, tr.

TAG TAXONOMY — pick ONLY from this fixed list (return English slugs in tags field):
Nudity Level: topless, full-frontal, butt, pussy, bush, nude, sideboob, see-through, implied-nudity, cleavage
Scene Type: sex-scene, explicit, mainstream, blowjob, cunnilingus, lesbian, masturbation, striptease, threesome, group-sex, bdsm, romantic, rape-scene
Setting: shower, bath, pool, beach, bed-scene, outdoor
Source: movie, tv-series, photoshoot
Body: pregnant, tattoo

STRICT TAG RULES — MOST IMPORTANT:
- ONLY tag what you can LITERALLY SEE in the video frames. Do NOT guess from title or metadata.
- If you did not watch the video, use ONLY the most conservative tags (topless/nude + source).
- "full-frontal" = you can clearly see BOTH breasts AND genitals from the front in the same frame. If you only see breasts, that is "topless", NOT "full-frontal".
- "pussy" = female genitals are CLEARLY and UNAMBIGUOUSLY visible. Brief glimpses or shadows do NOT count.
- "bush" = pubic hair is clearly visible. Do not tag this unless you are certain.
- "explicit" = ONLY for scenes with real/unsimulated sex acts, penetration, or pornographic-level content. A standard nude scene in a movie is NOT explicit.
- "mainstream" = standard cinema/TV nudity (topless, brief nudity, love scenes without graphic sex). This is the DEFAULT for most movie/TV scenes.
- "sex-scene" = simulated or implied sex scene. This is different from "explicit" (which requires unsimulated/graphic content).
- "topless" = bare breasts clearly visible. This is the most common tag for movie nudity.
- "butt" = bare buttocks prominently visible, not just a brief flash.
- "sideboob" = ONLY the side of the breast visible, no full breast exposure.
- "implied-nudity" = nudity is suggested but NOT shown (e.g. covered by sheets, shot from behind).
- Select 3-8 tags. When in doubt, choose the LESS explicit tag.
- Always include exactly one Source tag (movie, tv-series, or photoshoot).
- Return tags as {"en": ["topless", "bed-scene", "movie"], "ru": ["Топлес", "Постельная сцена", "Фильм"], ...}
- For non-English languages, use the natural localized tag name (e.g. ru: "Минет", de: "Blowjob", fr: "Fellation")

HOT MOMENTS — ONLY moments where NUDITY/BARE SKIN is VISIBLE on screen:
- Return "hot_moments": array of 2-5 timestamps where ACTUAL NUDITY is shown
- Each: {"timestamp_sec": 45, "intensity": 1-5, "label": "what body part is visible"}
- intensity 5 = full nudity clearly visible; 4 = topless/significant; 3 = partial (butt, sideboob); 2 = underwear/lingerie; 1 = cleavage only
- NEVER mark dialogue, kissing, emotional moments, or fully clothed scenes as hot moments
- ONLY mark moments where bare skin (breasts, butt, genitals) is ACTUALLY VISIBLE on screen
- If the video has NO nudity at all, return "hot_moments": []
- "best_thumbnail_sec": timestamp of the BEST frame showing the most nudity — for thumbnail
- "screenshot_timestamps": 6-10 timestamps including all hot_moments + context shots

DESCRIPTION STYLE (field "review"):
- Write 2-3 sentences from the perspective of an erotic cinema connoisseur
- Format: who (actress full name), where from (movie/series title, year), what is visible in the scene
- Tone: factual but appreciative, like an expert curator describing a notable scene
- Example EN: "Margot Robbie delivers a stunning full-frontal scene in The Wolf of Wall Street (2013). The actress confidently bares it all in this iconic bedroom sequence that became one of the most talked-about moments in modern cinema."
- Example RU: "Марго Робби демонстрирует потрясающую сцену полного обнажения в «Волке с Уолл-стрит» (2013). Актриса уверенно раздевается в этой культовой спальной сцене, ставшей одним из самых обсуждаемых моментов современного кинематографа."
- Do NOT write generic SEO filler or 150+ word reviews
- Each language should feel natural, not a word-for-word translation

OUTPUT FORMAT (strict JSON):
{
  "title": {"en": "...", "ru": "...", "de": "...", "fr": "...", "es": "...", "pt": "...", "it": "...", "pl": "...", "nl": "...", "tr": "..."},
  "slug": {"en": "scarlett-johansson-nude-under-the-skin", "ru": "skarlett-johansson-obnazhennaya-scena", ...},
  "review": {"en": "2-3 sentence description...", "ru": "...", ...},
  "seo_title": {"en": "up to 60 chars", "ru": "...", ...},
  "seo_description": {"en": "up to 160 chars", "ru": "...", ...},
  "celebrities": ["Scarlett Johansson"],
  "movie_title": "Under the Skin",
  "movie_title_localized": {"ru": "Побудь в моей шкуре", "de": "Under the Skin", ...},
  "year": 2013,
  "studio": "Film4 Productions",
  "director": "Jonathan Glazer",
  "category": "movie-scenes",
  "tags": {"en": ["full-frontal", "nude", "movie"], "ru": ["Полная обнажёнка", "Обнажённая", "Фильм"], ...},
  "hot_moments": [{"timestamp_sec": 32, "intensity": 4, "label": "topless reveal"}, {"timestamp_sec": 67, "intensity": 5, "label": "full frontal"}],
  "best_thumbnail_sec": 67,
  "screenshot_timestamps": [5, 15, 32, 45, 67, 80, 95, 110],
  "quality": "1080p",
  "duration_formatted": "3:45",
  "confidence": 0.92
}

RULES:
- Slugs: URL-safe, transliterated Latin chars for all languages
- Celebrity names: ONLY use names from the provided metadata (raw_celebrities, title). NEVER invent or guess names.
- Confidence: 0.9+ ONLY if celebrity name is in metadata AND you watched the video. 0.5-0.8 if text-only. <0.5 if unknown.
- All localized fields must have ALL 10 language keys
- Tags "en" field must contain ONLY slugs from the taxonomy above (lowercase, hyphenated)
- Maximum 6 tags total. Be selective.
- hot_moments timestamps must be actual seconds within the video duration
- RESPOND ONLY WITH VALID JSON, no markdown`;

function makeSlug(text) {
  return slugify(text, { lower: true, strict: true, locale: "en" });
}

/**
 * Upload video to Gemini File API and wait for processing
 * Returns fileUri for use in generateContent, or null on failure
 */
async function uploadVideoToGemini(videoPath) {
  const fileInfo = await stat(videoPath);
  const fileSizeMB = (fileInfo.size / 1024 / 1024).toFixed(1);
  logger.info(`Uploading video to Gemini File API (${fileSizeMB}MB)...`);

  // Step 1: Start resumable upload
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(fileInfo.size),
        'X-Goog-Upload-Header-Content-Type': 'video/mp4',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { displayName: path.basename(videoPath) } }),
    }
  );
  if (!startRes.ok) {
    throw new Error(`Gemini File API start failed: ${startRes.status}`);
  }
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('No upload URL returned by Gemini File API');

  // Step 2: Upload the video bytes
  const videoData = await readFile(videoPath);
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Length': String(videoData.length),
      'Content-Type': 'video/mp4',
    },
    body: videoData,
  });
  if (!uploadRes.ok) {
    throw new Error(`Gemini File API upload failed: ${uploadRes.status}`);
  }
  const uploadResult = await uploadRes.json();
  const fileUri = uploadResult.file?.uri;
  const fileName = uploadResult.file?.name;
  if (!fileUri) throw new Error('No fileUri in upload response');

  logger.info(`Video uploaded: ${fileName}, waiting for processing...`);

  // Step 3: Poll until file state is ACTIVE
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000)); // poll every 3s
    const statusRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_API_KEY}`
    );
    if (!statusRes.ok) continue;
    const statusData = await statusRes.json();
    if (statusData.state === 'ACTIVE') {
      logger.info(`Video ready for analysis: ${fileUri}`);
      return { fileUri, fileName };
    }
    if (statusData.state === 'FAILED') {
      throw new Error(`Gemini video processing failed: ${statusData.error?.message || 'unknown'}`);
    }
  }
  throw new Error('Gemini video processing timeout (3 min)');
}

/**
 * Delete uploaded file from Gemini after processing
 */
async function deleteGeminiFile(fileName) {
  try {
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_API_KEY}`,
      { method: 'DELETE' }
    );
  } catch { /* non-critical */ }
}

async function callGemini(rawVideo, videoPath = null) {
  const hasVideo = !!videoPath;
  const userPrompt = `Analyze this video (metadata${hasVideo ? ' + full video file' : ''}) and return multilingual JSON:

Title: ${rawVideo.raw_title || "unknown"}
Description: ${rawVideo.raw_description || "none"}
Source tags: ${(rawVideo.raw_tags || []).join(", ") || "none"}
Source categories: ${(rawVideo.raw_categories || []).join(", ") || "none"}
Celebrities/Models: ${(rawVideo.raw_celebrities || []).join(", ") || "unknown"}
Duration (sec): ${rawVideo.duration_seconds || "unknown"}
Source URL: ${rawVideo.source_url}

${hasVideo ? 'IMPORTANT: Watch the ENTIRE video carefully. Identify hot moments with exact timestamps. Pick the best thumbnail timestamp from the most visually striking nude/erotic moment. Tag ONLY what you actually SEE — do not guess.' : 'WARNING: No video file available — use metadata and source tags only. Since you CANNOT see the video, follow these rules strictly:\n- Do NOT assign tags like full-frontal, pussy, bush, explicit, blowjob, cunnilingus — you cannot verify these without seeing the video\n- Use only safe/obvious tags: topless, nude, movie/tv-series (infer from context)\n- Set confidence to 0.4 or lower\n- Do NOT generate hot_moments — set to empty array []\n- Do NOT generate screenshot_timestamps — set to empty array []\n- Set best_thumbnail_sec to null'}`;

  // Build parts: video file (if available) + text prompt
  const parts = [];
  let geminiFile = null;

  if (videoPath) {
    try {
      geminiFile = await uploadVideoToGemini(videoPath);
      parts.push({
        fileData: {
          fileUri: geminiFile.fileUri,
          mimeType: 'video/mp4',
        },
      });
    } catch (err) {
      logger.warn(`Video upload to Gemini failed, falling back to text-only: ${err.message}`);
    }
  }

  parts.push({ text: SYSTEM_PROMPT + "\n\n" + userPrompt });

  logger.info(`Calling Gemini ${hasVideo && geminiFile ? '(with video)' : '(text-only)'}...`);

  const response = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 65536,
        responseMimeType: "application/json",
      },
      safetySettings: [
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      ],
    }),
  });

  // Cleanup uploaded file
  if (geminiFile) {
    deleteGeminiFile(geminiFile.fileName);
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  let text = candidate?.content?.parts?.[0]?.text;

  // If video caused empty response, retry text-only as fallback
  if (!text && geminiFile) {
    const blockReason = candidate?.finishReason || data.promptFeedback?.blockReason || 'unknown';
    logger.warn(`Video analysis blocked (${blockReason}), retrying text-only...`);
    deleteGeminiFile(geminiFile.fileName);
    geminiFile = null;

    const fallbackParts = [{ text: SYSTEM_PROMPT + "\n\n" + userPrompt }];
    const fallbackRes = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: fallbackParts }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 65536, responseMimeType: "application/json" },
        safetySettings: [
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        ],
      }),
    });
    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();
      text = fallbackData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        // Text-only fallback — strip unreliable data (AI can't see video)
        const result = JSON.parse(text);
        result.hot_moments = [];
        result.best_thumbnail_sec = null;
        result.screenshot_timestamps = [];
        result._fallback = 'text_only';
        // Strip explicit tags that can't be confirmed without watching video
        const UNSAFE_TAGS_WITHOUT_VIDEO = new Set([
          'full-frontal', 'pussy', 'bush', 'explicit', 'blowjob', 'cunnilingus',
          'masturbation', 'group-sex', 'bdsm', 'threesome', 'see-through',
        ]);
        if (result.tags?.en) {
          const originalTags = [...result.tags.en];
          result.tags.en = result.tags.en.filter(t => !UNSAFE_TAGS_WITHOUT_VIDEO.has(t));
          // Ensure at least 'nude' or 'topless' remains
          if (result.tags.en.length === 0 || result.tags.en.every(t => ['movie', 'tv-series', 'photoshoot'].includes(t))) {
            result.tags.en.push('nude');
          }
          // Strip same tags from other locales
          for (const loc of Object.keys(result.tags)) {
            if (loc !== 'en' && Array.isArray(result.tags[loc])) {
              result.tags[loc] = result.tags[loc].filter((_, i) => !UNSAFE_TAGS_WITHOUT_VIDEO.has(originalTags[i]));
              if (result.tags[loc].length === 0) result.tags[loc] = [result.tags.en[0] || 'nude'];
            }
          }
          const removed = originalTags.filter(t => UNSAFE_TAGS_WITHOUT_VIDEO.has(t));
          if (removed.length > 0) {
            logger.info(`Stripped ${removed.length} unverifiable tags from fallback: ${removed.join(', ')}`);
          }
        }
        // Lower confidence — fallback results should go to needs_review
        result.confidence = Math.min(result.confidence || 0.5, 0.45);
        logger.info('Text-only fallback used — hot_moments/timestamps stripped, explicit tags removed, confidence lowered');
        return result;
      }
    }
  }

  if (!text) {
    const blockReason = candidate?.finishReason || data.promptFeedback?.blockReason || 'unknown';
    logger.warn(`Gemini fully blocked (reason: ${blockReason}), falling back to donor tags...`);
    return buildFallbackFromDonor(rawVideo);
  }
  let result;
  try {
    result = JSON.parse(text);
  } catch (parseErr) {
    // Try to fix common JSON issues (trailing commas, truncated output)
    logger.warn(`JSON parse failed: ${parseErr.message}, attempting fix...`);
    let fixed = text
      .replace(/,\s*}/g, '}')       // trailing comma before }
      .replace(/,\s*]/g, ']')       // trailing comma before ]
      .replace(/[\x00-\x1F]/g, ' '); // control characters
    // If still broken, try to find the last valid closing brace
    try {
      result = JSON.parse(fixed);
    } catch {
      // Truncated JSON — find last complete object
      const lastBrace = fixed.lastIndexOf('}');
      if (lastBrace > 0) {
        try {
          result = JSON.parse(fixed.substring(0, lastBrace + 1));
        } catch {
          throw new Error(`Gemini returned invalid JSON: ${parseErr.message}`);
        }
      } else {
        throw new Error(`Gemini returned invalid JSON: ${parseErr.message}`);
      }
    }
    logger.info('JSON fixed successfully');
  }
  // If Gemini didn't actually see the video, strip timestamps and explicit tags — they're fabricated
  if (!geminiFile) {
    result.hot_moments = [];
    result.best_thumbnail_sec = null;
    result.screenshot_timestamps = [];
    result._fallback = result._fallback || 'text_only';
    // Strip explicit tags that can't be confirmed without watching video
    const UNSAFE_TAGS_WITHOUT_VIDEO = new Set([
      'full-frontal', 'pussy', 'bush', 'explicit', 'blowjob', 'cunnilingus',
      'masturbation', 'group-sex', 'bdsm', 'threesome', 'see-through',
    ]);
    if (result.tags?.en) {
      const originalTags = [...result.tags.en];
      result.tags.en = result.tags.en.filter(t => !UNSAFE_TAGS_WITHOUT_VIDEO.has(t));
      if (result.tags.en.length === 0 || result.tags.en.every(t => ['movie', 'tv-series', 'photoshoot'].includes(t))) {
        result.tags.en.push('nude');
      }
      for (const loc of Object.keys(result.tags)) {
        if (loc !== 'en' && Array.isArray(result.tags[loc])) {
          result.tags[loc] = result.tags[loc].filter((_, i) => !UNSAFE_TAGS_WITHOUT_VIDEO.has(originalTags[i]));
          if (result.tags[loc].length === 0) result.tags[loc] = [result.tags.en[0] || 'nude'];
        }
      }
      const removed = originalTags.filter(t => UNSAFE_TAGS_WITHOUT_VIDEO.has(t));
      if (removed.length > 0) {
        logger.info(`Stripped ${removed.length} unverifiable tags (no video): ${removed.join(', ')}`);
      }
    }
    result.confidence = Math.min(result.confidence || 0.5, 0.45);
    logger.info('No video was analyzed — hot_moments/timestamps stripped, explicit tags removed, confidence lowered');
  }
  return result;
}

/**
 * Fallback: когда Gemini полностью отказал — строим результат из raw_tags донора
 */
function buildFallbackFromDonor(rawVideo) {
  const rawTags = rawVideo.raw_tags || [];
  const rawTitle = rawVideo.raw_title || 'Unknown Scene';
  const rawCelebs = rawVideo.raw_celebrities || [];
  const rawDesc = rawVideo.raw_description || '';

  // Map donor tags to our canonical taxonomy
  const TAG_MAP = {
    'real sex': 'explicit', 'blowjob scene': 'blowjob', 'blowjob': 'blowjob',
    'handjob': 'sex-scene', 'erotic scene': 'mainstream', 'explicit erotic': 'explicit',
    'explicit': 'explicit', 'erotic': 'mainstream', 'unsimulated': 'explicit',
    'unsimulated sex': 'explicit', 'sex scene': 'sex-scene', 'sex': 'sex-scene',
    'nude': 'nude', 'nude scene': 'nude', 'nudity': 'nude', 'naked': 'nude',
    'topless': 'topless', 'tits': 'topless', 'boobs': 'topless', 'breasts': 'topless',
    'bush': 'bush', 'pubic hair': 'bush', 'hairy': 'bush',
    'full frontal': 'full-frontal', 'full-frontal': 'full-frontal', 'frontal': 'full-frontal',
    'butt': 'butt', 'ass': 'butt', 'booty': 'butt',
    'pussy': 'pussy', 'vagina': 'pussy',
    'sideboob': 'sideboob', 'side boob': 'sideboob',
    'see-through': 'see-through', 'see through': 'see-through', 'transparent': 'see-through',
    'cleavage': 'cleavage',
    'implied nudity': 'implied-nudity', 'implied': 'implied-nudity',
    'lesbian': 'lesbian', 'lesbian scene': 'lesbian',
    'masturbation': 'masturbation', 'masturbating': 'masturbation',
    'striptease': 'striptease', 'strip': 'striptease',
    'threesome': 'threesome', '3some': 'threesome',
    'group sex': 'group-sex', 'orgy': 'group-sex',
    'bdsm': 'bdsm', 'bondage': 'bdsm',
    'romantic': 'romantic', 'love scene': 'romantic',
    'rape scene': 'rape-scene', 'rape': 'rape-scene', 'forced': 'rape-scene',
    'shower': 'shower', 'bath': 'bath', 'bathtub': 'bath',
    'pool': 'pool', 'swimming': 'pool',
    'beach': 'beach', 'outdoor': 'outdoor', 'outside': 'outdoor',
    'bed scene': 'bed-scene', 'bed': 'bed-scene', 'bedroom': 'bed-scene',
    'movie': 'movie', 'film': 'movie',
    'tv series': 'tv-series', 'tv show': 'tv-series', 'series': 'tv-series',
    'photoshoot': 'photoshoot', 'photo': 'photoshoot',
    'pregnant': 'pregnant', 'tattoo': 'tattoo',
    'cunnilingus': 'cunnilingus',
  };

  // Translate localized tags
  const TAG_LOCALIZED = {
    'topless': { ru: 'Топлес', de: 'Oben ohne', fr: 'Seins nus', es: 'Topless', pt: 'Topless', it: 'Topless', pl: 'Topless', nl: 'Topless', tr: 'Üstsüz' },
    'full-frontal': { ru: 'Полная обнажёнка', de: 'Vollständig nackt', fr: 'Nudité intégrale', es: 'Desnudo frontal', pt: 'Nudez frontal', it: 'Nudo integrale', pl: 'Pełna nagość', nl: 'Volledig naakt', tr: 'Tam çıplak' },
    'butt': { ru: 'Попа', de: 'Po', fr: 'Fesses', es: 'Trasero', pt: 'Bunda', it: 'Sedere', pl: 'Tyłek', nl: 'Billen', tr: 'Popo' },
    'pussy': { ru: 'Вагина', de: 'Vagina', fr: 'Sexe', es: 'Vagina', pt: 'Vagina', it: 'Vagina', pl: 'Wagina', nl: 'Vagina', tr: 'Vajina' },
    'nude': { ru: 'Обнажённая', de: 'Nackt', fr: 'Nue', es: 'Desnuda', pt: 'Nua', it: 'Nuda', pl: 'Naga', nl: 'Naakt', tr: 'Çıplak' },
    'sex-scene': { ru: 'Секс-сцена', de: 'Sexszene', fr: 'Scène de sexe', es: 'Escena de sexo', pt: 'Cena de sexo', it: 'Scena di sesso', pl: 'Scena seksu', nl: 'Seksscène', tr: 'Seks sahnesi' },
    'explicit': { ru: 'Откровенно', de: 'Explizit', fr: 'Explicite', es: 'Explícito', pt: 'Explícito', it: 'Esplicito', pl: 'Wyraźne', nl: 'Expliciet', tr: 'Açık' },
    'mainstream': { ru: 'Киносцена', de: 'Mainstream', fr: 'Grand écran', es: 'Mainstream', pt: 'Mainstream', it: 'Mainstream', pl: 'Mainstream', nl: 'Mainstream', tr: 'Ana akım' },
    'blowjob': { ru: 'Минет', de: 'Blowjob', fr: 'Fellation', es: 'Felación', pt: 'Boquete', it: 'Pompino', pl: 'Lodzik', nl: 'Pijpbeurt', tr: 'Oral seks' },
    'lesbian': { ru: 'Лесбийская', de: 'Lesbisch', fr: 'Lesbienne', es: 'Lésbica', pt: 'Lésbica', it: 'Lesbica', pl: 'Lesbijka', nl: 'Lesbisch', tr: 'Lezbiyen' },
    'movie': { ru: 'Фильм', de: 'Film', fr: 'Film', es: 'Película', pt: 'Filme', it: 'Film', pl: 'Film', nl: 'Film', tr: 'Film' },
    'tv-series': { ru: 'Сериал', de: 'Serie', fr: 'Série', es: 'Serie', pt: 'Série', it: 'Serie', pl: 'Serial', nl: 'Serie', tr: 'Dizi' },
    'bed-scene': { ru: 'Постельная сцена', de: 'Bettszene', fr: 'Scène de lit', es: 'Escena en la cama', pt: 'Cena na cama', it: 'Scena a letto', pl: 'Scena łóżkowa', nl: 'Bedscène', tr: 'Yatak sahnesi' },
    'shower': { ru: 'Душ', de: 'Dusche', fr: 'Douche', es: 'Ducha', pt: 'Chuveiro', it: 'Doccia', pl: 'Prysznic', nl: 'Douche', tr: 'Duş' },
    'bath': { ru: 'Ванна', de: 'Bad', fr: 'Bain', es: 'Baño', pt: 'Banho', it: 'Bagno', pl: 'Kąpiel', nl: 'Bad', tr: 'Banyo' },
    'masturbation': { ru: 'Мастурбация', de: 'Masturbation', fr: 'Masturbation', es: 'Masturbación', pt: 'Masturbação', it: 'Masturbazione', pl: 'Masturbacja', nl: 'Masturbatie', tr: 'Mastürbasyon' },
    'striptease': { ru: 'Стриптиз', de: 'Striptease', fr: 'Striptease', es: 'Striptease', pt: 'Striptease', it: 'Striptease', pl: 'Striptiz', nl: 'Striptease', tr: 'Striptiz' },
    'bush': { ru: 'Волосы', de: 'Busch', fr: 'Toison', es: 'Vello', pt: 'Pelos', it: 'Peluria', pl: 'Owłosienie', nl: 'Schaamhaar', tr: 'Kıllar' },
    'romantic': { ru: 'Романтика', de: 'Romantisch', fr: 'Romantique', es: 'Romántico', pt: 'Romântico', it: 'Romantico', pl: 'Romantyczny', nl: 'Romantisch', tr: 'Romantik' },
    'outdoor': { ru: 'На улице', de: 'Draußen', fr: 'Extérieur', es: 'Exterior', pt: 'Ao ar livre', it: 'Esterno', pl: 'Na zewnątrz', nl: 'Buiten', tr: 'Açık hava' },
  };

  // Match raw tags to canonical
  const matchedTags = new Set();
  for (const rawTag of rawTags) {
    const lower = rawTag.toLowerCase().trim();
    if (TAG_MAP[lower]) {
      matchedTags.add(TAG_MAP[lower]);
    }
  }

  // Ensure at least one source tag
  if (!matchedTags.has('movie') && !matchedTags.has('tv-series') && !matchedTags.has('photoshoot')) {
    // Guess from title
    if (/\b(s\d{2}e\d{2}|season|episode|series)\b/i.test(rawTitle)) {
      matchedTags.add('tv-series');
    } else {
      matchedTags.add('movie');
    }
  }

  // If no content tags matched, add basic ones
  if (matchedTags.size <= 1) {
    matchedTags.add('nude');
  }

  const enTags = [...matchedTags];

  // Build localized tags
  const tags = { en: enTags };
  for (const loc of LOCALES.filter(l => l !== 'en')) {
    tags[loc] = enTags.map(t => TAG_LOCALIZED[t]?.[loc] || t);
  }

  // Extract celebrity names from raw data
  let celebrities = rawCelebs.length > 0 ? rawCelebs : [];
  if (celebrities.length === 0) {
    // Try to extract from title (pattern: "Name Name - Movie Title (Year)")
    const titleMatch = rawTitle.match(/^([A-Z][a-z]+(?: [A-Z][a-z]+)+)\s*[-–]/);
    if (titleMatch) celebrities = [titleMatch[1]];
  }

  // Extract movie title and year from raw title
  let movieTitle = null;
  let year = null;
  const movieMatch = rawTitle.match(/[-–]\s*(.+?)\s*\((\d{4})\)/);
  if (movieMatch) {
    movieTitle = movieMatch[1].trim();
    year = parseInt(movieMatch[2]);
  }

  // Build basic title and review for all locales
  const celName = celebrities[0] || 'Unknown';
  const moviePart = movieTitle ? ` in ${movieTitle}` : '';
  const yearPart = year ? ` (${year})` : '';

  const title = {};
  const slug = {};
  const review = {};
  const seoTitle = {};
  const seoDesc = {};

  for (const loc of LOCALES) {
    title[loc] = rawTitle;
    slug[loc] = makeSlug(rawTitle);
    review[loc] = `${celName} nude scene${moviePart}${yearPart}.`;
    seoTitle[loc] = `${celName} nude${moviePart}${yearPart}`;
    seoDesc[loc] = `Watch ${celName} nude scene${moviePart}${yearPart} on celeb.skin`;
  }

  logger.info(`[Donor Fallback] Built result from ${rawTags.length} donor tags → ${enTags.length} canonical tags: ${enTags.join(', ')}`);

  return {
    title,
    slug,
    review,
    seo_title: seoTitle,
    seo_description: seoDesc,
    celebrities,
    movie_title: movieTitle,
    year,
    tags,
    hot_moments: [],
    best_thumbnail_sec: null,
    screenshot_timestamps: [],
    quality: null,
    duration_formatted: null,
    confidence: 0.3, // low confidence — will go to needs_review
    category: 'movie-scenes',
    _fallback: 'donor_tags', // marker for logging
  };
}

/**
 * Скачать видео для визуального анализа
 */
async function downloadVideoForRecognition(url, videoId) {
  const workDir = path.join(__dirname, 'tmp', videoId);
  await mkdir(workDir, { recursive: true });
  const videoPath = path.join(workDir, 'video.mp4');

  // Проверить если уже скачано
  try { await access(videoPath); return videoPath; } catch { }

  // Локальный файл?
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const localPath = path.join(__dirname, url);
    try { await access(localPath); return localPath; } catch { }
    return null;
  }

  const response = await axios({
    method: 'get', url, responseType: 'stream', timeout: 300000,
    headers: { 'User-Agent': 'CelebSkin-Pipeline/1.0' },
  });
  await streamPipeline(response.data, createWriteStream(videoPath));
  return videoPath;
}

async function processVideo(rawVideo) {
  logger.info(`Processing: ${rawVideo.raw_title}`, { id: rawVideo.id });

  let ai;
  let recognitionMethod = 'metadata';
  let recognitionData = null;
  let videoPath = null;

  // --- STEP 0: Download video for AI vision ---
  const videoUrl = rawVideo.video_file_url || rawVideo.embed_code;
  if (videoUrl && !SKIP_VISUAL) {
    try {
      videoPath = await downloadVideoForRecognition(videoUrl, rawVideo.id);
      if (videoPath) {
        logger.info(`Video downloaded for vision analysis: ${videoPath}`);
      }
    } catch (err) {
      logger.warn(`Video download failed, proceeding text-only: ${err.message}`);
    }
  }

  // --- УРОВЕНЬ 1: Анализ метаданных + полного видео через Gemini ---
  if (!VISUAL_ONLY) {
    ai = await callGemini(rawVideo, videoPath);
    logger.info(`AI result (Level 1): confidence=${ai.confidence}, celebrities=${(ai.celebrities || []).join(", ")}, tags=${(ai.tags?.en || []).join(", ")}`);
    if (ai.hot_moments?.length > 0) {
      logger.info(`Hot moments: ${ai.hot_moments.map(m => `${m.timestamp_sec}s (${m.intensity}/5: ${m.label})`).join(', ')}`);
    }
    if (ai.best_thumbnail_sec) {
      logger.info(`Best thumbnail at: ${ai.best_thumbnail_sec}s`);
    }
  }

  // --- УРОВЕНЬ 2: Визуальное распознавание актёров/фильмов (если Level 1 неуверен или --visual-only) ---
  if (!SKIP_VISUAL && (VISUAL_ONLY || !ai || ai.confidence < 0.5)) {
    if (videoPath) {
      try {
        logger.info(`[Visual] Low confidence (${ai?.confidence || 0}) — trying visual recognition for actors/movies...`);

        const visualResult = await smartRecognize(videoPath, rawVideo.id, extractBestFrame, extractKeyFrames);
        recognitionData = visualResult;

        if (visualResult.success && visualResult.confidence > (ai?.confidence || 0)) {
          logger.info(`[Visual] Recognition improved: ${ai?.confidence || 0} → ${visualResult.confidence}`);
          recognitionMethod = 'visual';

          ai = ai || {};

          if (visualResult.movie && visualResult.movie.confidence >= 0.7 && visualResult.movie.tmdb_id) {
            if (!ai.movie_title) {
              ai.movie_title = visualResult.movie.title;
              ai.year = parseInt(visualResult.movie.year) || ai.year;
              logger.info(`[Visual] Using movie from visual: "${visualResult.movie.title}" (confidence=${visualResult.movie.confidence})`);
            } else {
              logger.info(`[Visual] Keeping metadata movie "${ai.movie_title}", ignoring visual "${visualResult.movie.title}"`);
            }
          }

          if (visualResult.actors?.length > 0) {
            const highConfActors = visualResult.actors
              .filter(a => a.name && a.confidence >= 0.7)
              .map(a => a.name);
            if (highConfActors.length > 0 && (!ai.celebrities || ai.celebrities.length === 0)) {
              ai.celebrities = highConfActors;
              logger.info(`[Visual] Using actors from visual: ${highConfActors.join(', ')}`);
            } else if (highConfActors.length > 0) {
              logger.info(`[Visual] Keeping metadata actors, ignoring visual: ${highConfActors.join(', ')}`);
            }
          }

          ai.confidence = Math.max(ai.confidence || 0, visualResult.confidence);
        }
      } catch (err) {
        logger.warn(`[Visual] Visual recognition failed: ${err.message}`);
      }
    }

    // Если visual-only и нет AI результата — сгенерировать контент
    if (VISUAL_ONLY && !ai) {
      ai = await callGemini(rawVideo, videoPath);
    }
  }

  // Очистить кадры после всех этапов
  await cleanupFrames(rawVideo.id).catch(() => { });

  if (!ai) {
    throw new Error('AI processing produced no result');
  }

  // 2. Generate slugs if missing
  const slugs = ai.slug || {};
  for (const loc of LOCALES) {
    if (!slugs[loc]) {
      const title = ai.title?.[loc] || ai.title?.en || rawVideo.raw_title;
      slugs[loc] = makeSlug(title);
    }
  }

  // 3. Validate: video MUST have a video_url, otherwise skip
  if (!rawVideo.video_file_url) {
    logger.warn(`No video_file_url for raw_video ${rawVideo.id} — marking as failed`);
    await markRawVideoFailed(rawVideo.id, 'No video file URL found on source page');
    return null;
  }

  // 4. Determine status based on confidence
  let videoStatus;
  if (ai.confidence >= 0.8) {
    videoStatus = "enriched";
  } else if (ai.confidence >= 0.5) {
    videoStatus = "needs_review";
  } else if (recognitionData && (recognitionData.movie || recognitionData.actors?.length > 0)) {
    videoStatus = "unknown_with_suggestions";
  } else {
    videoStatus = "needs_review";
  }

  // 5. Insert video into DB
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
    video_url: rawVideo.video_file_url, // Source URL — replaced with CDN URL by upload-to-cdn.js
    thumbnail_url: rawVideo.thumbnail_url || null,
    ai_model: GEMINI_MODEL,
    ai_confidence: ai.confidence || 0,
    ai_raw_response: JSON.stringify(ai),
    status: videoStatus,
  });

  logger.info(`Video inserted: ${videoId} (status=${videoStatus}, method=${recognitionMethod})`);

  // 5. Save recognition data + hot moments
  if (recognitionData || recognitionMethod !== 'metadata') {
    await query(
      `UPDATE videos SET recognition_data = $1::jsonb, recognition_method = $2 WHERE id = $3`,
      [recognitionData ? JSON.stringify(recognitionData) : null, recognitionMethod, videoId]
    );
  }

  // 5b. Save hot moments — validate timestamps against video duration
  const duration = rawVideo.duration_seconds || 0;
  let hotMoments = (ai.hot_moments || []).filter(m => {
    if (!m.timestamp_sec || !duration) return false;
    return m.timestamp_sec > 0 && m.timestamp_sec <= duration;
  });
  if (hotMoments.length !== (ai.hot_moments || []).length) {
    const removed = (ai.hot_moments || []).length - hotMoments.length;
    if (removed > 0) logger.warn(`Removed ${removed} hot moments with timestamps exceeding duration (${duration}s)`);
  }
  if (hotMoments.length > 0) {
    await query(
      `UPDATE videos SET hot_moments = $1::jsonb WHERE id = $2`,
      [JSON.stringify(hotMoments), videoId]
    );
    logger.info(`Saved ${hotMoments.length} hot moments for video ${videoId}`);
  }

  // 5c. Save best thumbnail timestamp and screenshot timestamps in ai_raw_response
  // These will be used by generate-thumbnails.js later in the pipeline

  // 6. Link celebrities (auto-create if not exists)
  // SAFETY: only link celebrities that appear in source metadata to prevent AI hallucinations
  const rawCelebNames = new Set((rawVideo.raw_celebrities || []).map(n => n.toLowerCase().trim()));
  const rawTitle = (rawVideo.raw_title || '').toLowerCase();
  for (const celName of (ai.celebrities || [])) {
    const celSlug = makeSlug(celName);
    if (!celSlug) continue;
    // Skip generic/unknown names
    if (['unknown', 'Unknown', 'unknown actress', 'n/a'].includes(celName)) {
      logger.warn(`Skipping generic celebrity name: "${celName}"`);
      continue;
    }
    // Check if name appears in source metadata (raw_celebrities or title)
    const nameLower = celName.toLowerCase().trim();
    const nameInMeta = rawCelebNames.has(nameLower) ||
      [...rawCelebNames].some(rc => rc.includes(nameLower) || nameLower.includes(rc)) ||
      rawTitle.includes(nameLower) ||
      nameLower.split(' ').every(part => rawTitle.includes(part));
    if (!nameInMeta) {
      logger.warn(`Skipping AI-hallucinated celebrity: "${celName}" (not in source metadata)`);
      continue;
    }
    const celId = await findOrCreateCelebrity(celName, celSlug);
    await linkVideoCelebrity(videoId, celId);
    logger.info(`Linked celebrity: ${celName} (id=${celId})`);
  }

  // 7. Link AI tags — ONLY canonical tags from taxonomy, MAX 6
  const MAX_TAGS = 6;
  const enTags = (ai.tags?.en || []).slice(0, MAX_TAGS);
  if ((ai.tags?.en || []).length > MAX_TAGS) {
    logger.warn(`AI returned ${ai.tags.en.length} tags, trimmed to ${MAX_TAGS}: ${ai.tags.en.slice(MAX_TAGS).join(', ')} dropped`);
  }
  let linkedTags = 0;
  for (const tagSlugRaw of enTags) {
    const tagSlug = makeSlug(tagSlugRaw);
    if (!tagSlug) continue;

    // Only link canonical tags — reject anything not in the taxonomy
    const { rows } = await query(
      `SELECT id FROM tags WHERE slug = $1 AND is_canonical = true`,
      [tagSlug]
    );

    if (rows.length > 0) {
      await linkVideoTag(videoId, rows[0].id);
      linkedTags++;
    } else {
      logger.warn(`AI returned non-canonical tag "${tagSlugRaw}" (slug: ${tagSlug}) — skipping`);
    }
  }
  logger.info(`Linked ${linkedTags}/${enTags.length} canonical tags`);

  // NOTE: Source (boobsradar) tags are NOT inserted into tags table anymore.
  // They remain in raw_videos.raw_tags as metadata context for AI processing.

  if (rawVideo.raw_categories && rawVideo.raw_categories.length > 0) {
    for (const cat of rawVideo.raw_categories) {
      if (!cat) continue;
      const catSlug = makeSlug(cat);
      if (!catSlug) continue;
      const collId = await findOrCreateCollection(cat, catSlug, { en: cat, ru: cat });
      await linkVideoCollection(videoId, collId);
    }
    logger.info(`Linked ${rawVideo.raw_categories.length} source categories to collections`);
  }

  // 8. Link movie if identified
  if (ai.movie_title) {
    const movieSlug = makeSlug(ai.movie_title);
    const movieId = await findOrCreateMovie({
      title: ai.movie_title,
      title_localized: ai.movie_title_localized || {},
      slug: movieSlug,
      year: ai.year || null,
      studio: ai.studio || null,
      director: ai.director || null,
      genres: [],
      ai_matched: true,
    });
    await linkMovieScene(movieId, videoId);
    // Link celebrities to movie too
    for (const celName of (ai.celebrities || [])) {
      const celSlug = makeSlug(celName);
      const celId = await findOrCreateCelebrity(celName, celSlug);
      await linkMovieCelebrity(movieId, celId);
    }
    logger.info(`Linked movie: ${ai.movie_title} (id=${movieId})`);
  }

  // 9. Log processing
  await dbLog(videoId, "ai_process", "success", `Processed with ${GEMINI_MODEL}, confidence=${ai.confidence}, method=${recognitionMethod}`, {
    celebrities: ai.celebrities,
    movie: ai.movie_title,
    languages: LOCALES.length,
    recognition_method: recognitionMethod,
    visual_recognition: recognitionData ? true : false,
  });

  await markRawVideoProcessed(rawVideo.id);
  return videoId;
}

// ============================================
// Main
// ============================================
const args = process.argv.slice(2);
const limit = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] || "10");
const autoPublish = args.includes("--auto-publish");

logger.info(`=== CelebSkin AI Processing ===`);
logger.info(`Model: ${GEMINI_MODEL}, Limit: ${limit}, Auto-publish: ${autoPublish}`);
logger.info(`Visual: ${VISUAL_ONLY ? 'ONLY' : SKIP_VISUAL ? 'SKIP' : 'AUTO (if confidence < 0.5)'}`);

if (!GEMINI_API_KEY) {
  logger.error("GEMINI_API_KEY not set in .env");
  process.exit(1);
}

const pending = await getPendingVideos(limit);
logger.info(`Found ${pending.length} pending videos`);

const CONCURRENCY = 3;
const startedAt = Date.now();
let processed = 0, failed = 0;
const _completed = [];
const _errors = [];

for (let i = 0; i < pending.length; i += CONCURRENCY) {
  const batch = pending.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(async (raw) => {
    try {
      const _start = Date.now();
      setActiveItem(raw.id, { label: raw.raw_title || raw.id, subStep: 'Gemini API', pct: 0 });
      writeProgress({
        step: 'ai-process', stepLabel: 'AI Processing (Gemini)',
        videosTotal: pending.length, videosDone: processed + failed,
        currentVideo: { id: raw.id, title: raw.raw_title, subStep: 'Processing' },
        completedVideos: _completed.slice(-10),
        errors: _errors.slice(-10),
        elapsedMs: Date.now() - startedAt,
      });
      const result = await processVideo(raw);
      removeActiveItem(raw.id);
      if (result === null) {
        // Video skipped (no video_url) — already marked failed in processVideo
        failed++;
        _errors.push({ id: raw.id, title: raw.raw_title, error: 'No video file URL' });
        return;
      }
      processed++;
      _completed.push({ id: raw.id, title: raw.raw_title, status: 'ok', ms: Date.now() - _start });
      // Rate limit: ~2 sec between API calls
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      removeActiveItem(raw.id);
      logger.error(`Failed: ${raw.raw_title}`, { error: err.message });
      await markRawVideoFailed(raw.id, err.message);
      failed++;
      _errors.push({ id: raw.id, title: raw.raw_title, error: err.message });
    }
  }));
}

const elapsedMs = Date.now() - startedAt;
completeStep({
  videosDone: processed,
  videosTotal: pending.length,
  elapsedMs,
  completedVideos: _completed.slice(-20),
  errors: _errors.slice(-20),
  errorCount: failed,
});
logger.info(`=== Done: ${processed} processed, ${failed} failed ===`);
if (failed > 0) {
  logger.error(`⚠️  ${failed} video(s) failed AI processing:`);
  for (const e of _errors) {
    logger.error(`  - ${e.id} (${e.title}): ${e.error}`);
  }
}
