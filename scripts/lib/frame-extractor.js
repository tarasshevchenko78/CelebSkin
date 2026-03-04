/**
 * frame-extractor.js — Извлечение ключевых кадров из видео для визуального распознавания
 *
 * Стратегия:
 *   1. Фиксированные точки (10%, 25%, 50%, 75%, 90%) — 5 кадров
 *   2. Scene change detection (FFmpeg select filter) — до 3 кадров
 *   3. Один "лучший" кадр (50%) для быстрого анализа
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, rm, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = join(__dirname, '..', 'tmp', 'frames');

/**
 * Получить длительность видео через ffprobe
 */
async function getDuration(videoPath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      videoPath,
    ], { timeout: 15000 });
    return parseFloat(stdout.trim()) || 60;
  } catch {
    return 60;
  }
}

/**
 * Извлечь один кадр в указанный момент времени
 */
async function extractSingleFrame(videoPath, timestamp, outputPath) {
  await execFileAsync('ffmpeg', [
    '-ss', String(Math.max(0, timestamp)),
    '-i', videoPath,
    '-vframes', '1',
    '-vf', 'scale=640:-2',
    '-q:v', '2',
    '-y',
    outputPath,
  ], { timeout: 30000 });
}

/**
 * Извлекает ключевые кадры из видео для анализа
 *
 * 5 кадров из фиксированных точек + до 3 кадров по scene change detection
 * Возвращает массив: [{ path, timestamp, position, type }]
 */
export async function extractKeyFrames(videoPath, videoId) {
  const outputDir = join(FRAMES_DIR, `video_${videoId}`);
  await mkdir(outputDir, { recursive: true });

  const duration = await getDuration(videoPath);
  const frames = [];

  // --- МЕТОД 1: Фиксированные точки ---
  const timePoints = [0.10, 0.25, 0.50, 0.75, 0.90];

  for (let i = 0; i < timePoints.length; i++) {
    const timestamp = Math.floor(duration * timePoints[i]);
    const outputPath = join(outputDir, `frame_${i}_at_${timestamp}s.jpg`);

    try {
      await extractSingleFrame(videoPath, timestamp, outputPath);
      frames.push({
        path: outputPath,
        timestamp,
        position: timePoints[i],
        type: 'fixed',
      });
    } catch {
      // Пропускаем если кадр не извлёкся
    }
  }

  // --- МЕТОД 2: Scene change detection (до 3 кадров) ---
  const sceneDir = join(outputDir, 'scenes');
  await mkdir(sceneDir, { recursive: true });

  try {
    await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-vf', "select='gt(scene,0.3)',showinfo",
      '-vsync', 'vfr',
      '-vf', "select='gt(scene,0.3)',scale=640:-2",
      '-q:v', '2',
      '-frames:v', '3',
      '-y',
      join(sceneDir, 'scene_%03d.jpg'),
    ], { timeout: 60000 });

    const sceneFiles = await readdir(sceneDir);
    for (const file of sceneFiles.slice(0, 3)) {
      if (file.endsWith('.jpg')) {
        frames.push({
          path: join(sceneDir, file),
          timestamp: null,
          position: null,
          type: 'scene_change',
        });
      }
    }
  } catch {
    // Scene detection не критична
  }

  return frames;
}

/**
 * Извлекает один "лучший" кадр из середины видео для быстрого анализа
 */
export async function extractBestFrame(videoPath, videoId) {
  const outputDir = join(FRAMES_DIR, `video_${videoId}`);
  await mkdir(outputDir, { recursive: true });

  const duration = await getDuration(videoPath);
  const timestamp = Math.floor(duration * 0.5);
  const outputPath = join(outputDir, 'best_frame.jpg');

  await extractSingleFrame(videoPath, timestamp, outputPath);
  return outputPath;
}

/**
 * Удалить извлечённые кадры после обработки
 */
export async function cleanupFrames(videoId) {
  const outputDir = join(FRAMES_DIR, `video_${videoId}`);
  try {
    await rm(outputDir, { recursive: true, force: true });
  } catch {
    // Не критично
  }
}

export { getDuration, FRAMES_DIR };
