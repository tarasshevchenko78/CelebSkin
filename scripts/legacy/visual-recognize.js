#!/usr/bin/env node
/**
 * visual-recognize.js — Визуальное распознавание видео с низким confidence
 *
 * Обрабатывает видео со статусами needs_review / unknown_with_suggestions,
 * которые ещё не прошли визуальный анализ (recognition_method IS NULL OR = 'metadata')
 *
 * Usage:
 *   node visual-recognize.js                    # обработать все pending
 *   node visual-recognize.js --limit=10         # лимит
 *   node visual-recognize.js --force            # переанализировать даже уже проверенные
 */

import { query } from "./lib/db.js";
import logger from "./lib/logger.js";
import { writeProgress, clearProgress } from "./lib/progress.js";
import { smartRecognize } from "./lib/visual-recognizer.js";
import { extractBestFrame, extractKeyFrames, cleanupFrames } from "./lib/frame-extractor.js";
import axios from "axios";
import { createWriteStream } from "fs";
import { pipeline as streamPipeline } from "stream/promises";
import { mkdir, access } from "fs/promises";
import slugify from "slugify";

function makeSlug(text) {
  return slugify(text, { lower: true, strict: true, locale: "en" });
}

const args = process.argv.slice(2);
const LIMIT = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] || "20");
const FORCE = args.includes("--force");

async function downloadVideo(url, videoId) {
  const workDir = join(__dirname, 'tmp', videoId);
  await mkdir(workDir, { recursive: true });
  const videoPath = join(workDir, 'video.mp4');

  try { await access(videoPath); return videoPath; } catch {}

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const localPath = join(__dirname, url);
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

async function main() {
  logger.info('='.repeat(60));
  logger.info('CelebSkin — Visual Recognition Pipeline');
  logger.info('='.repeat(60));

  // Получить видео, которые нуждаются в визуальном распознавании
  const statusFilter = FORCE
    ? `status IN ('needs_review', 'unknown_with_suggestions', 'enriched')`
    : `status IN ('needs_review', 'unknown_with_suggestions') AND (recognition_method IS NULL OR recognition_method = 'metadata')`;

  const { rows: videos } = await query(
    `SELECT id, video_url, video_url_watermarked, original_title, ai_confidence,
            recognition_method, recognition_data
     FROM videos
     WHERE ${statusFilter}
       AND (video_url IS NOT NULL OR video_url_watermarked IS NOT NULL)
     ORDER BY ai_confidence ASC, created_at DESC
     LIMIT $1`,
    [LIMIT]
  );

  logger.info(`Found ${videos.length} videos for visual recognition`);

  const startedAt = Date.now();
  let processed = 0, improved = 0, failed = 0;
  const _completed = [];
  const _errors = [];

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const num = i + 1;

    logger.info(`\n[${num}/${videos.length}] Video: ${video.original_title || video.id} (current confidence: ${video.ai_confidence})`);

    writeProgress({
      step: 'visual-recognize', stepLabel: 'Visual Recognition (Gemini Vision)',
      videosTotal: videos.length, videosDone: i,
      currentVideo: { id: video.id, title: video.original_title || video.id, subStep: 'Analyzing frames' },
      completedVideos: _completed.slice(-10),
      errors: _errors.slice(-10),
      elapsedMs: Date.now() - startedAt,
    });

    try {
      const videoUrl = video.video_url_watermarked || video.video_url;
      const videoPath = await downloadVideo(videoUrl, video.id);

      if (!videoPath) {
        logger.warn(`  Skipped: no video file available`);
        continue;
      }

      const result = await smartRecognize(videoPath, video.id, extractBestFrame, extractKeyFrames);

      // Сохранить результат
      const updates = {
        recognition_data: JSON.stringify(result),
        recognition_method: 'visual',
      };

      // Обновить confidence и статус если визуальное распознавание лучше
      if (result.success && result.confidence > (video.ai_confidence || 0)) {
        updates.ai_confidence = result.confidence;
        improved++;

        if (result.confidence >= 0.8) {
          updates.status = 'auto_recognized';
        } else if (result.confidence >= 0.5) {
          updates.status = 'needs_review';
        }

        // НЕ создаём связи celebrities/movies напрямую из visual recognition.
        // visual-recognize.js только сохраняет recognition_data в БД.
        // Связи создаются:
        //   - process-with-ai.js (при первичной обработке, с проверкой confidence)
        //   - Модератором через админку (при ручной проверке)
        // Это предотвращает создание ложных связей при низком confidence.

        logger.info(`  IMPROVED: ${video.ai_confidence} → ${result.confidence} (${result.movie?.title || 'no movie'}, actors: ${result.actors?.map(a => a.name).join(', ') || 'none'})`);
      } else if (result.gemini_raw) {
        // Сохранить варианты даже если confidence не улучшился
        if (!result.success && result.gemini_raw?.movie_title) {
          updates.status = 'unknown_with_suggestions';
        }
        logger.info(`  No improvement (visual: ${result.confidence}, current: ${video.ai_confidence})`);
      }

      // Применить обновления
      const setClauses = [];
      const values = [video.id];
      let idx = 2;
      for (const [key, val] of Object.entries(updates)) {
        if (key === 'recognition_data') {
          setClauses.push(`${key} = $${idx}::jsonb`);
        } else {
          setClauses.push(`${key} = $${idx}`);
        }
        values.push(val);
        idx++;
      }

      await query(
        `UPDATE videos SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1`,
        values
      );

      // Логировать
      await query(
        `INSERT INTO processing_log (video_id, step, status, message, metadata)
         VALUES ($1, 'visual-recognize', $2, $3, $4::jsonb)`,
        [video.id, result.success ? 'success' : 'no_match',
         `Visual recognition: confidence=${result.confidence}, method=${result.recognition_method}`,
         JSON.stringify({ confidence: result.confidence, movie: result.movie?.title, actors: result.actors?.length || 0 })]
      );

      // Очистить кадры
      await cleanupFrames(video.id).catch(() => {});

      processed++;
      _completed.push({ id: video.id, title: video.original_title || video.id, status: 'ok', ms: Date.now() - startedAt });

    } catch (err) {
      failed++;
      logger.error(`  Error: ${err.message}`);
      _errors.push({ id: video.id, title: video.original_title || video.id, error: err.message });
    }

    // Пауза между видео
    await new Promise(r => setTimeout(r, 1000));
  }

  clearProgress();

  logger.info('\n' + '='.repeat(60));
  logger.info('VISUAL RECOGNITION SUMMARY');
  logger.info(`Processed: ${processed}`);
  logger.info(`Improved: ${improved}`);
  logger.info(`Failed: ${failed}`);
  logger.info('='.repeat(60));
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
