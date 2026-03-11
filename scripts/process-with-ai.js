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

import slugify from "slugify";
import { config } from "./lib/config.js";
import {
  getPendingVideos, markRawVideoProcessed, markRawVideoFailed,
  insertVideo, findOrCreateCelebrity, linkVideoCelebrity,
  findOrCreateTag, linkVideoTag, findOrCreateMovie,
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
import { mkdir, access } from "fs/promises";

const GEMINI_API_KEY = config.ai.geminiApiKey;
// CLI override: --model=gemini-2.5-pro | gemini-2.0-flash | gemini-2.0-pro
const _cliModel = process.argv.find(a => a.startsWith("--model="));
const GEMINI_MODEL = _cliModel ? _cliModel.split("=")[1] : config.ai.geminiModel;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const VISUAL_ONLY = process.argv.includes("--visual-only");
const SKIP_VISUAL = process.argv.includes("--skip-visual");

const LOCALES = ["en", "ru", "de", "fr", "es", "pt", "it", "pl", "nl", "tr"];

const SYSTEM_PROMPT = `You are an expert in cinema and celebrity content. Analyze video metadata and generate MULTILINGUAL structured data for a celebrity nude scenes platform (celeb.skin).

TASK: From the provided video metadata, generate content in ALL 10 languages: en, ru, de, fr, es, pt, it, pl, nl, tr.

OUTPUT FORMAT (strict JSON):
{
  "title": {"en": "...", "ru": "...", "de": "...", "fr": "...", "es": "...", "pt": "...", "it": "...", "pl": "...", "nl": "...", "tr": "..."},
  "slug": {"en": "scarlett-johansson-nude-scene-under-the-skin", "ru": "skarlett-johansson-obnazhennaya-scena", ...},
  "review": {"en": "150-300 word SEO review...", "ru": "...", ...},
  "seo_title": {"en": "up to 60 chars", "ru": "...", ...},
  "seo_description": {"en": "up to 160 chars", "ru": "...", ...},
  "celebrities": ["Scarlett Johansson", "Florence Pugh"],
  "movie_title": "Under the Skin",
  "movie_title_localized": {"ru": "Побудь в моей шкуре", "de": "Under the Skin", ...},
  "year": 2013,
  "studio": "Film4 Productions",
  "director": "Jonathan Glazer",
  "category": "movie-scenes",
  "tags": {"en": ["nude", "topless", "full frontal"], "ru": ["обнажённая", "топлес"], ...},
  "quality": "1080p",
  "duration_formatted": "3:45",
  "confidence": 0.92
}

RULES:
- Slugs must be URL-safe, transliterated (not translated) — use Latin chars for all languages
- Use your knowledge of celebrities to identify FULL names: "Scarlett Johansson" not "Scarlett"
- If movie title is in the video title (usually after a period or dash), identify it
- Confidence: 0.9+ if celebrity identified, 0.5-0.8 if unsure, <0.5 if unknown
- All localized fields must have ALL 10 language keys
- Tags: 5-10 per language, use adult industry terminology appropriate for each language
- Reviews should be unique per language, not just translations — adapt style for each audience
- RESPOND ONLY WITH VALID JSON, no markdown`;

function makeSlug(text) {
  return slugify(text, { lower: true, strict: true, locale: "en" });
}

async function callGemini(rawVideo) {
  const userPrompt = `Analyze this video and return multilingual JSON:

Title: ${rawVideo.raw_title || "unknown"}
Description: ${rawVideo.raw_description || "none"}
Source tags: ${(rawVideo.raw_tags || []).join(", ") || "none"}
Source categories: ${(rawVideo.raw_categories || []).join(", ") || "none"}
Celebrities/Models: ${(rawVideo.raw_celebrities || []).join(", ") || "unknown"}
Duration (sec): ${rawVideo.duration_seconds || "unknown"}
Source URL: ${rawVideo.source_url}`;

  const response = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\n" + userPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 65536,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini response");
  return JSON.parse(text);
}

/**
 * Скачать видео для визуального анализа
 */
async function downloadVideoForRecognition(url, videoId) {
  const workDir = path.join(__dirname, 'tmp', videoId);
  await mkdir(workDir, { recursive: true });
  const videoPath = path.join(workDir, 'video.mp4');

  // Проверить если уже скачано
  try { await access(videoPath); return videoPath; } catch {}

  // Локальный файл?
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const localPath = path.join(__dirname, url);
    try { await access(localPath); return localPath; } catch {}
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

  // --- УРОВЕНЬ 1: Анализ текстовых метаданных через Gemini ---
  if (!VISUAL_ONLY) {
    ai = await callGemini(rawVideo);
    logger.info(`AI result (Level 1): confidence=${ai.confidence}, celebrities=${(ai.celebrities || []).join(", ")}`);
  }

  // --- УРОВЕНЬ 2: Визуальное распознавание (если Level 1 неуверен или --visual-only) ---
  if (!SKIP_VISUAL && (VISUAL_ONLY || !ai || ai.confidence < 0.5)) {
    const videoUrl = rawVideo.video_file_url || rawVideo.embed_code;
    if (videoUrl) {
      try {
        logger.info(`[Visual] Low confidence (${ai?.confidence || 0}) — trying visual recognition...`);
        const videoPath = await downloadVideoForRecognition(videoUrl, rawVideo.id);

        if (videoPath) {
          const visualResult = await smartRecognize(videoPath, rawVideo.id, extractBestFrame, extractKeyFrames);
          recognitionData = visualResult;

          if (visualResult.success && visualResult.confidence > (ai?.confidence || 0)) {
            logger.info(`[Visual] Recognition improved: ${ai?.confidence || 0} → ${visualResult.confidence}`);
            recognitionMethod = 'visual';

            // Обновить AI результат визуальными данными
            // ВАЖНО: используем только данные с высоким confidence, чтобы не создавать ложные связи
            ai = ai || {};
            
            // Фильм — только если confidence >= 0.7 И TMDB верифицирован
            if (visualResult.movie && visualResult.movie.confidence >= 0.7 && visualResult.movie.tmdb_id) {
              // Не перезаписывать существующий фильм если он уже определён из метаданных
              if (!ai.movie_title) {
                ai.movie_title = visualResult.movie.title;
                ai.year = parseInt(visualResult.movie.year) || ai.year;
                logger.info(`[Visual] Using movie from visual: "${visualResult.movie.title}" (confidence=${visualResult.movie.confidence})`);
              } else {
                logger.info(`[Visual] Keeping metadata movie "${ai.movie_title}", ignoring visual "${visualResult.movie.title}"`);
              }
            }
            
            // Актёры — только с индивидуальным confidence >= 0.7
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

          // Очистить кадры
          await cleanupFrames(rawVideo.id).catch(() => {});
        }
      } catch (err) {
        logger.warn(`[Visual] Visual recognition failed: ${err.message}`);
      }
    }

    // Если visual-only и нет AI результата — сгенерировать контент
    if (VISUAL_ONLY && !ai) {
      ai = await callGemini(rawVideo);
    }
  }

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
    video_url: rawVideo.video_file_url,
    thumbnail_url: rawVideo.thumbnail_url || null,
    ai_model: GEMINI_MODEL,
    ai_confidence: ai.confidence || 0,
    ai_raw_response: JSON.stringify(ai),
    status: videoStatus,
  });

  logger.info(`Video inserted: ${videoId} (status=${videoStatus}, method=${recognitionMethod})`);

  // 5. Save recognition data to new columns
  if (recognitionData || recognitionMethod !== 'metadata') {
    await query(
      `UPDATE videos SET recognition_data = $1::jsonb, recognition_method = $2 WHERE id = $3`,
      [recognitionData ? JSON.stringify(recognitionData) : null, recognitionMethod, videoId]
    );
  }

  // 6. Link celebrities (auto-create if not exists)
  for (const celName of (ai.celebrities || [])) {
    const celSlug = makeSlug(celName);
    if (!celSlug) continue;
    const celId = await findOrCreateCelebrity(celName, celSlug);
    await linkVideoCelebrity(videoId, celId);
    logger.info(`Linked celebrity: ${celName} (id=${celId})`);
  }

  // 7. Link tags (auto-create with localized names)
  const enTags = ai.tags?.en || [];
  for (const tag of enTags) {
    const tagSlug = makeSlug(tag);
    if (!tagSlug) continue;
    const tagLocalized = {};
    for (const loc of LOCALES) {
      const locTags = ai.tags?.[loc] || [];
      const idx = enTags.indexOf(tag);
      tagLocalized[loc] = locTags[idx] || tag;
    }
    const tagId = await findOrCreateTag(tag, tagSlug, tagLocalized);
    await linkVideoTag(videoId, tagId);
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
