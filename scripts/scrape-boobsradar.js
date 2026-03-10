#!/usr/bin/env node
/**
 * scrape-boobsradar.js — Полный скрапер boobsradar.com
 *
 * Скачивает все ролики, раскидывает по категориям,
 * сохраняет превью и JSON с метаданными.
 *
 * Структура вывода:
 *   output/
 *     {category-slug}/
 *       {video-slug}/
 *         video.mp4          — видеофайл
 *         preview.jpg        — превью-изображение
 *         metadata.json      — все метаданные
 *
 * Usage:
 *   node scripts/scrape-boobsradar.js                              # все категории
 *   node scripts/scrape-boobsradar.js --category=celebrity         # одна категория
 *   node scripts/scrape-boobsradar.js --max-pages=3                # макс. страниц на категорию
 *   node scripts/scrape-boobsradar.js --max-videos=100             # макс. видео всего
 *   node scripts/scrape-boobsradar.js --skip-download              # только метаданные, без скачивания
 *   node scripts/scrape-boobsradar.js --skip-video                 # метаданные + превью, без видео
 *   node scripts/scrape-boobsradar.js --dry-run                    # только показать что будет скачано
 *   node scripts/scrape-boobsradar.js --resume                     # продолжить с того где остановились
 *   node scripts/scrape-boobsradar.js --with-ai                    # обогатить данные через Gemini AI
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, writeFile, access, readFile, stat } from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import { config } from './lib/config.js';
import BoobsRadarAdapter from './adapters/boobsradar-adapter.js';
import logger from './lib/logger.js';
import { insertRawVideo, query, log as dbLog } from './lib/db.js';
import { writeProgress, clearProgress } from './lib/progress.js';

// Ensure source 'boobsradar' exists in DB; cache the ID
let _sourceId = null;
async function getSourceId() {
  if (_sourceId) return _sourceId;
  try {
    const { rows } = await query(
      `INSERT INTO sources (name, base_url, adapter_name)
       VALUES ('BoobsRadar', 'https://boobsradar.com', 'boobsradar')
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    _sourceId = rows[0].id;
  } catch {
    _sourceId = null;
  }
  return _sourceId;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'output');
const PROGRESS_FILE = join(OUTPUT_DIR, '.progress.json');

// ============================================
// Конфигурация
// ============================================

const DEFAULT_CONFIG = {
  maxPagesPerCategory: 999,     // все страницы
  maxVideosTotal: Infinity,
  parallelDownloads: 3,         // параллельные загрузки
  delayBetweenRequests: 1000,   // 1 сек между запросами метаданных
  delayBetweenDownloads: 500,   // 0.5 сек между стартами загрузок
  downloadTimeout: 300000,      // 5 минут на скачивание видео
  skipDownload: false,          // пропустить скачивание (только метаданные)
  skipVideo: false,             // пропустить видео (метаданные + превью)
  dryRun: false,
  resume: false,
  withAi: false,
  filterCategory: null,
};

// ============================================
// Утилиты
// ============================================

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100)
    .replace(/^-|-$/g, '');
}

function extractSlugFromUrl(url) {
  const match = url.match(/\/(?:videos|nudes)\/([^/?]+)/);
  return match ? match[1] : slugify(url);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Active downloads tracker for progress reporting
const activeDownloads = new Map(); // id → { label, downloaded, total, pct }
const scrapeStartedAt = Date.now();

function emitProgress(videosDone, videosTotal) {
  const downloads = [...activeDownloads.values()];
  // Structured JSON line — frontend parses these for visual progress bars
  console.log(`PROGRESS:${JSON.stringify({ videosDone, videosTotal, downloads })}`);
  const elapsedMs = Date.now() - scrapeStartedAt;
  writeProgress({
      step: 'scrape', stepLabel: 'Scraping (boobsradar)',
      videosTotal: videosTotal, videosDone: videosDone,
      currentVideo: downloads.length > 0 ? {
          id: downloads[0].id || '',
          title: downloads[0].label || '',
          subStep: downloads[0].total > 0
              ? `Downloading ${formatBytes(downloads[0].downloaded)} / ${formatBytes(downloads[0].total)}`
              : 'Downloading...',
          pct: downloads[0].pct || 0,
      } : null,
      downloads: downloads.map(d => ({
          id: d.id || d.label,
          label: d.label,
          downloaded: d.downloaded,
          total: d.total,
          pct: d.pct || 0,
      })),
      completedVideos: [],
      errors: [],
      elapsedMs,
  });
}

async function downloadFile(url, destPath, timeout = 300000, { label = '', id = '' } = {}) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://boobsradar.com/',
    },
  });

  const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
  let downloaded = 0;
  let lastLogTime = 0;
  const dlId = id || label || Math.random().toString(36).slice(2);

  if (totalBytes > 100000) {
    // Only track significant downloads (>100KB = video files)
    activeDownloads.set(dlId, { label, downloaded: 0, total: totalBytes, pct: 0 });
  }

  response.data.on('data', (chunk) => {
    downloaded += chunk.length;
    const now = Date.now();
    if (now - lastLogTime >= 2000) {
      lastLogTime = now;
      if (totalBytes > 0) {
        const pct = Math.round((downloaded / totalBytes) * 100);
        activeDownloads.set(dlId, { label, downloaded, total: totalBytes, pct });
        // Human-readable progress line for the pipeline log viewer
        logger.info(`  ⬇ ${label || 'file'}: ${formatBytes(downloaded)} / ${formatBytes(totalBytes)} (${pct}%)`);
      } else {
        logger.info(`  ⬇ ${label || 'file'}: ${formatBytes(downloaded)}`);
      }
    }
  });

  const writer = createWriteStream(destPath);
  await pipeline(response.data, writer);

  // Log completion
  if (totalBytes > 100000) {
    logger.info(`  ✓ ${label || 'file'}: ${formatBytes(downloaded)} — готово`);
  }

  activeDownloads.delete(dlId);
  return downloaded || totalBytes;
}

// ============================================
// Progress tracking (для --resume)
// ============================================

async function loadProgress() {
  try {
    const data = await readFile(PROGRESS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { processedVideos: [], processedCategories: [], stats: {} };
  }
}

async function saveProgress(progress) {
  await writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ============================================
// AI-обогащение метаданных (опционально)
// ============================================

async function enrichWithAI(metadata) {
  const apiKey = config.ai.geminiApiKey;
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY не задан, AI-обогащение пропущено');
    return metadata;
  }

  const model = config.ai.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `Проанализируй метаданные видеоролика и верни JSON с полями:
- title_ru: привлекательный заголовок на русском (до 100 символов)
- celebrities: массив имён актрис (определи из заголовка и тегов)
- movie_title: название фильма/сериала (если можно определить)
- year: год выхода
- genre: жанр (драма, триллер, комедия и т.д.)
- description_ru: описание на русском (100-200 слов)
- tags_ru: 5-10 тегов на русском

Данные видео:
Заголовок: ${metadata.raw_title}
Категории: ${metadata.categories?.join(', ')}
Теги: ${metadata.tags?.join(', ')}
Актрисы (найдены): ${metadata.celebrities?.join(', ')}
Фильм (найден): ${metadata.movie_title || 'не определён'}
Год: ${metadata.year || 'не определён'}

Ответь ТОЛЬКО валидным JSON.`;

  try {
    const response = await axios.post(url, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    }, { timeout: 30000 });

    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      metadata.ai_enriched = JSON.parse(text);
      metadata.ai_model = model;
      logger.info(`    AI: "${metadata.ai_enriched.title_ru}"`);
    }
  } catch (err) {
    logger.warn(`    AI ошибка: ${err.message}`);
  }

  return metadata;
}

// ============================================
// Основной скрапер
// ============================================

async function main() {
  const config = { ...DEFAULT_CONFIG, ...parseArgs() };
  const adapter = new BoobsRadarAdapter();

  logger.info('='.repeat(60));
  logger.info('BoobsRadar Scraper');
  logger.info('='.repeat(60));
  logger.info(`Настройки: ${JSON.stringify({
    category: config.filterCategory || 'все',
    maxPages: config.maxPagesPerCategory,
    maxVideos: config.maxVideosTotal === Infinity ? 'все' : config.maxVideosTotal,
    skipDownload: config.skipDownload,
    skipVideo: config.skipVideo,
    dryRun: config.dryRun,
    resume: config.resume,
    withAi: config.withAi,
  })}`);

  // Создаём выходную директорию
  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(join(__dirname, '..', 'logs'), { recursive: true });

  // Загружаем прогресс (для --resume)
  const progress = config.resume ? await loadProgress() : {
    processedVideos: [],
    processedCategories: [],
    stats: { totalVideos: 0, totalDownloaded: 0, totalFailed: 0, totalSkipped: 0 },
  };

  // STEP 1: Получаем все категории
  let categories;
  try {
    categories = await adapter.getCategories();
  } catch (err) {
    logger.error(`Ошибка загрузки категорий: ${err.message}`);
    process.exit(1);
  }

  if (config.filterCategory) {
    // Support comma-separated slugs: --category=celebrity,amateur,topless
    const filterSlugs = config.filterCategory.split(',').map(s => s.trim().toLowerCase());
    categories = categories.filter(c =>
      filterSlugs.includes(c.slug.toLowerCase()) ||
      filterSlugs.some(f => c.title.toLowerCase().includes(f))
    );
    if (categories.length === 0) {
      logger.error(`Категории "${config.filterCategory}" не найдены`);
      process.exit(1);
    }
    logger.info(`Выбрано категорий: ${categories.length} (${categories.map(c => c.slug).join(', ')})`);
  }

  logger.info(`\nКатегорий для обработки: ${categories.length}`);

  let totalProcessed = 0;

  // STEP 2: Обходим каждую категорию
  for (const category of categories) {
    if (totalProcessed >= config.maxVideosTotal) break;

    const catSlug = category.slug;
    const catDir = join(OUTPUT_DIR, catSlug);

    logger.info(`\n${'─'.repeat(50)}`);
    logger.info(`Категория: ${category.title} (${catSlug})`);
    logger.info(`URL: ${category.url}`);

    await mkdir(catDir, { recursive: true });

    // Получаем первую страницу для определения кол-ва страниц
    let firstPage;
    try {
      firstPage = await adapter.getVideoList(category.url, 1);
    } catch (err) {
      logger.error(`  Ошибка загрузки категории: ${err.message}`);
      continue;
    }

    const maxPages = Math.min(firstPage.lastPage, config.maxPagesPerCategory);
    logger.info(`  Страниц: ${maxPages}, видео на 1-й: ${firstPage.videos.length}`);

    if (config.dryRun) {
      logger.info(`  [DRY RUN] ~${firstPage.videos.length * maxPages} видео`);
      continue;
    }

    // Обходим все страницы категории
    for (let page = 1; page <= maxPages; page++) {
      if (totalProcessed >= config.maxVideosTotal) break;

      let pageData;
      if (page === 1) {
        pageData = firstPage;
      } else {
        await adapter.delay(config.delayBetweenRequests);
        try {
          pageData = await adapter.getVideoList(category.url, page);
        } catch (err) {
          logger.error(`  Страница ${page}: ошибка — ${err.message}`);
          continue;
        }
      }

      logger.info(`  Страница ${page}/${maxPages}: ${pageData.videos.length} видео`);

      // Emit progress even during parsing phase
      emitProgress(totalProcessed, config.maxVideosTotal === Infinity ? 0 : config.maxVideosTotal);

      // --- Собираем задачи для параллельной загрузки ---
      const tasks = [];

      for (const videoItem of pageData.videos) {
        if (totalProcessed + tasks.length >= config.maxVideosTotal) break;

        const videoSlug = extractSlugFromUrl(videoItem.url);

        // Пропускаем уже обработанные (для --resume)
        if (progress.processedVideos.includes(videoSlug)) {
          logger.debug(`    Пропуск (уже обработано): ${videoSlug}`);
          progress.stats.totalSkipped++;
          continue;
        }

        // Проверяем в БД — не скачано ли уже (raw_videos + videos)
        try {
          const { rows: existingRows } = await query(
            `SELECT 'raw' as src, id, status FROM raw_videos
             WHERE source_video_id = $1 OR source_url = $2
             UNION ALL
             SELECT 'video' as src, id, status FROM videos
             WHERE original_title ILIKE $3
             LIMIT 1`,
            [videoSlug, videoItem.url, `%${videoItem.title.substring(0, 40)}%`]
          );
          if (existingRows.length > 0) {
            const r = existingRows[0];
            logger.info(`    Пропуск (уже в БД [${r.src}], status=${r.status}): ${videoSlug}`);
            progress.processedVideos.push(videoSlug);
            progress.stats.totalSkipped++;
            continue;
          }
        } catch (dbErr) {
          logger.warn(`    Ошибка проверки дубликата: ${dbErr.message}`);
        }

        const videoDir = join(catDir, videoSlug);
        const metadataPath = join(videoDir, 'metadata.json');

        // Пропускаем если уже скачано
        if (await fileExists(metadataPath)) {
          logger.debug(`    Пропуск (существует): ${videoSlug}`);
          progress.processedVideos.push(videoSlug);
          progress.stats.totalSkipped++;
          continue;
        }

        // Задержка перед парсингом страницы
        await adapter.delay(config.delayBetweenRequests);

        try {
          const taskNum = totalProcessed + tasks.length + 1;
          logger.info(`    [${taskNum}] ${videoItem.title.substring(0, 60)}...`);

          const metadata = await adapter.parseVideoPage(videoItem.url);
          metadata.found_in_category = { title: category.title, slug: catSlug };

          // Вторичная проверка дубликатов по video_file_url (тот же файл в разных категориях)
          if (metadata.video_file_url) {
            // Извлекаем уникальный ID файла из URL (напр. /38000/38091/38091.mp4)
            const fileIdMatch = metadata.video_file_url.match(/\/(\d+)\/(\d+)\.mp4/);
            const fileId = fileIdMatch ? fileIdMatch[2] : null;
            if (fileId) {
              try {
                const { rows: dupRows } = await query(
                  `SELECT id FROM raw_videos WHERE video_file_url LIKE $1 LIMIT 1`,
                  [`%/${fileId}.mp4%`]
                );
                if (dupRows.length > 0) {
                  logger.info(`    Пропуск (дубль по video_file: ID ${fileId}): ${videoSlug}`);
                  progress.processedVideos.push(videoSlug);
                  progress.stats.totalSkipped++;
                  continue;
                }
              } catch { /* ignore */ }
            }
          }

          if (config.withAi) {
            await enrichWithAI(metadata);
            await adapter.delay(1000);
          }

          tasks.push({ videoItem, videoSlug, videoDir, metadataPath, metadata, taskNum });
        } catch (err) {
          logger.error(`    Ошибка парсинга: ${err.message}`);
          progress.stats.totalFailed++;
        }
      }

      // --- Скачиваем параллельно батчами ---
      const BATCH = config.parallelDownloads;
      const totalTasks = tasks.length;
      for (let i = 0; i < totalTasks; i += BATCH) {
        const batch = tasks.slice(i, i + BATCH);

        // Emit progress with timer while batch downloads
        const progressTimer = setInterval(() => {
          emitProgress(totalProcessed, config.maxVideosTotal === Infinity ? totalTasks : config.maxVideosTotal);
        }, 1500);

        await Promise.all(batch.map(async (task) => {
          const { videoItem, videoSlug, videoDir, metadataPath, metadata, taskNum } = task;
          const tag = `    [${taskNum}]`;
          const shortTitle = (metadata.raw_title || videoItem.title || '').substring(0, 40);
          try {
            await mkdir(videoDir, { recursive: true });

            // Превью
            if (!config.skipDownload && metadata.thumbnail_url) {
              try {
                const previewPath = join(videoDir, 'preview.jpg');
                await downloadFile(metadata.thumbnail_url, previewPath, 30000, { label: shortTitle, id: `preview-${taskNum}` });
                metadata.local_preview = 'preview.jpg';
              } catch (err) {
                logger.warn(`${tag} Превью: ошибка — ${err.message}`);
              }
            }

            // Пропускаем если на странице нет ссылки на видео
            if (!metadata.video_file_url) {
              logger.warn(`${tag} Пропуск: нет video_file_url на странице`);
              progress.stats.totalSkipped++;
              return;
            }

            // Видео
            if (!config.skipDownload && !config.skipVideo && metadata.video_file_url) {
              try {
                const videoPath = join(videoDir, 'video.mp4');
                const fileSize = await downloadFile(metadata.video_file_url, videoPath, config.downloadTimeout, { label: shortTitle, id: `video-${taskNum}` });
                metadata.local_video = 'video.mp4';
                logger.info(`${tag} Скачано: ${shortTitle} (${formatBytes(fileSize)})`);
                progress.stats.totalDownloaded++;
              } catch (err) {
                logger.warn(`${tag} Видео: ошибка скачивания — ${err.message}`);
              }
            }

            // Метаданные в файл
            await writeFile(metadataPath, JSON.stringify(metadata, null, 2));

            // БД
            try {
              const sourceId = await getSourceId();
              const dbId = await insertRawVideo({
                source_id: sourceId,
                source_url: metadata.source_url || videoItem.url,
                source_video_id: videoSlug,
                raw_title: metadata.raw_title || videoItem.title,
                raw_description: metadata.description || null,
                thumbnail_url: metadata.thumbnail_url || null,
                duration_seconds: metadata.duration_seconds || null,
                raw_tags: metadata.tags || [],
                raw_categories: metadata.categories || [],
                raw_celebrities: metadata.celebrities || [],
                video_file_url: metadata.video_file_url || null,
                extra_data: metadata,
                local_video_path: metadata.local_video ? `${catSlug}/${videoSlug}/video.mp4` : null,
                local_preview_path: metadata.local_preview ? `${catSlug}/${videoSlug}/preview.jpg` : null,
              });
              if (dbId) {
                logger.info(`${tag} В БД: ${shortTitle}`);
                await dbLog(null, 'scrape', 'completed', `Scraped: ${shortTitle}`, {
                    raw_video_id: dbId, source_video_id: videoSlug,
                    has_video: !!metadata.local_video, has_preview: !!metadata.local_preview,
                    category: catSlug, file_url: metadata.video_file_url || null,
                });
              }
            } catch (dbErr) {
              logger.warn(`${tag} БД: ошибка — ${dbErr.message}`);
              await dbLog(null, 'scrape', 'error', `DB insert failed: ${shortTitle}: ${dbErr.message}`, {
                  source_video_id: videoSlug, category: catSlug,
              }).catch(() => {});
            }

            // Прогресс
            totalProcessed++;
            progress.processedVideos.push(videoSlug);
            progress.stats.totalVideos++;
          } catch (err) {
            logger.error(`${tag} Ошибка: ${err.message}`);
            progress.stats.totalFailed++;
            await dbLog(null, 'scrape', 'error', `Scrape failed: ${shortTitle}: ${err.message}`, {
                source_video_id: videoSlug, category: catSlug,
            }).catch(() => {});
          }
        }));

        clearInterval(progressTimer);
        // Final progress update after batch
        emitProgress(totalProcessed, config.maxVideosTotal === Infinity ? totalTasks : config.maxVideosTotal);

        await saveProgress(progress);
      }
    }

    progress.processedCategories.push(catSlug);
  }

  // Финальное сохранение прогресса
  await saveProgress(progress);

  // Итоги
  clearProgress();
  logger.info('\n' + '='.repeat(60));
  logger.info('ИТОГИ');
  logger.info('='.repeat(60));
  logger.info(`Обработано видео: ${progress.stats.totalVideos}`);
  logger.info(`Скачано видео: ${progress.stats.totalDownloaded}`);
  logger.info(`Пропущено: ${progress.stats.totalSkipped}`);
  logger.info(`Ошибок: ${progress.stats.totalFailed}`);
  logger.info(`Выходная папка: ${OUTPUT_DIR}`);
}

// ============================================
// Парсинг аргументов
// ============================================

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg === '--skip-download') args.skipDownload = true;
    if (arg === '--skip-video') args.skipVideo = true;
    if (arg === '--dry-run') args.dryRun = true;
    if (arg === '--resume') args.resume = true;
    if (arg === '--with-ai') args.withAi = true;
    if (arg.startsWith('--category=')) args.filterCategory = arg.split('=')[1];
    if (arg.startsWith('--max-pages=')) args.maxPagesPerCategory = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--max-videos=')) args.maxVideosTotal = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--limit=')) args.maxVideosTotal = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--parallel=')) args.parallelDownloads = parseInt(arg.split('=')[1]);
  }
  return args;
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
