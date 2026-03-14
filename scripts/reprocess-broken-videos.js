#!/usr/bin/env node
/**
 * reprocess-broken-videos.js — Перекодировка сломанных видео
 *
 * Скачивает watermarked версию с CDN, перекодирует с правильными
 * параметрами (SAR=1:1, фиксированные ключевые кадры, resample аудио),
 * и заливает обратно на CDN.
 *
 * НЕ требует оригинальных исходников — работает с уже опубликованными видео.
 * Водяной знак уже встроен, перекодировка лишь исправляет encoding issues.
 *
 * Usage:
 *   node reprocess-broken-videos.js              # все с SAR≠1:1
 *   node reprocess-broken-videos.js --limit=10   # первые 10
 *   node reprocess-broken-videos.js --id=UUID    # конкретное видео
 *   node reprocess-broken-videos.js --dry-run    # только показать список
 */

import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, rm, stat } from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import { config } from './lib/config.js';
import { query } from './lib/db.js';
import logger from './lib/logger.js';
import { uploadFile, getVideoPath } from './lib/bunny.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(config.pipeline.tmpDir, '_reprocess');

function parseArgs() {
    const args = { limit: 0, dryRun: false, id: null };
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1]);
        if (arg === '--dry-run') args.dryRun = true;
        if (arg.startsWith('--id=')) args.id = arg.split('=')[1];
    }
    return args;
}

/**
 * Скачать видео с CDN во временный файл
 */
async function downloadFromCDN(url, destPath) {
    const response = await axios({
        method: 'get',
        url,
        responseType: 'stream',
        timeout: 600000, // 10 мин
        headers: { 'User-Agent': 'CelebSkin-Pipeline/1.0' },
    });
    await pipeline(response.data, createWriteStream(destPath));
    return true;
}

/**
 * Проверить SAR видео через ffprobe
 */
async function probeSAR(url) {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error',
            '-analyzeduration', '5000000',
            '-probesize', '5000000',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=sample_aspect_ratio',
            '-print_format', 'csv=p=0',
            url,
        ], { timeout: 30000 });
        return stdout.trim();
    } catch {
        return 'error';
    }
}

/**
 * Перекодировать видео с правильными параметрами
 */
async function reencodeVideo(inputPath, outputPath, onProgress) {
    // Получить длительность для прогресса
    let durationSec = 0;
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'quiet', '-show_entries', 'format=duration',
            '-of', 'csv=p=0', inputPath,
        ], { timeout: 30000 });
        durationSec = parseFloat(stdout.trim()) || 0;
    } catch { /* ignore */ }

    return new Promise((resolve, reject) => {
        const ffmpegArgs = [
            '-fflags', '+genpts+discardcorrupt',
            '-i', inputPath,
            // Аудио: перекодировка с правильными timestamps
            '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
            '-af', 'aresample=async=1:first_pts=0',
            // Видео: перекодировка с фиксированным SAR и ключевыми кадрами
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-sar', '1:1',
            '-preset', 'veryfast', '-crf', '20',
            '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
            '-bf', '2', '-threads', '0',
            '-max_muxing_queue_size', '4096',
            '-movflags', '+faststart',
            '-progress', 'pipe:1',
            '-y', outputPath,
        ];

        const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';

        proc.stdout.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                const match = line.match(/out_time_us=(\d+)/);
                if (match && durationSec > 0 && onProgress) {
                    const currentSec = parseInt(match[1]) / 1000000;
                    const pct = Math.min(99, Math.round((currentSec / durationSec) * 100));
                    onProgress(pct);
                }
            }
        });

        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-500)}`));
        });

        // Таймаут 60 мин на перекодировку
        const timer = setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error('FFmpeg timeout (60min)'));
        }, 3600000);
        proc.on('close', () => clearTimeout(timer));
    });
}

async function main() {
    const args = parseArgs();

    logger.info('='.repeat(60));
    logger.info('CelebSkin — Перекодировка сломанных видео');
    logger.info('='.repeat(60));

    // Проверить FFmpeg
    try {
        await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
    } catch {
        logger.error('FFmpeg не найден!');
        process.exit(1);
    }

    await mkdir(TMP_DIR, { recursive: true });

    // Получить список видео для обработки
    let videos;
    if (args.id) {
        const { rows } = await query(`
            SELECT v.id, v.video_url_watermarked, v.duration_seconds,
                   COALESCE(v.title->>'en', v.id::text) as title
            FROM videos v
            WHERE v.id = $1
        `, [args.id]);
        videos = rows;
    } else {
        // Все опубликованные видео на CDN — проверим SAR при обработке
        const limitClause = args.limit > 0 ? `LIMIT ${args.limit}` : '';
        const { rows } = await query(`
            SELECT v.id, v.video_url_watermarked, v.duration_seconds,
                   COALESCE(v.title->>'en', v.id::text) as title
            FROM videos v
            WHERE v.status = 'published'
            AND v.video_url_watermarked LIKE '%b-cdn.net%'
            ORDER BY v.duration_seconds DESC
            ${limitClause}
        `);
        videos = rows;
    }

    if (videos.length === 0) {
        logger.info('Нет видео для обработки');
        process.exit(0);
    }

    logger.info(`Найдено ${videos.length} видео для проверки`);

    if (args.dryRun) {
        logger.info('\n--- DRY RUN — список видео ---');
        for (const v of videos) {
            const sar = await probeSAR(v.video_url_watermarked);
            const needsFix = sar !== '1:1' && sar !== 'N/A' && sar !== '0:1';
            logger.info(`  ${v.id} | ${v.duration_seconds}s | SAR=${sar} | ${needsFix ? 'НУЖНА ПЕРЕКОДИРОВКА' : 'OK'} | ${v.title.slice(0, 50)}`);
        }
        process.exit(0);
    }

    let fixed = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        const url = video.video_url_watermarked;

        logger.info(`\n[${i + 1}/${videos.length}] ${video.id}`);
        logger.info(`  Название: ${video.title.slice(0, 60)}`);

        // Проверить SAR
        const sar = await probeSAR(url);
        if (sar === '1:1') {
            logger.info(`  SAR=1:1 — OK, пропуск`);
            skipped++;
            continue;
        }

        logger.info(`  SAR=${sar} — нужна перекодировка`);

        const workDir = join(TMP_DIR, video.id);
        await mkdir(workDir, { recursive: true });

        try {
            // 1. Скачать с CDN
            const inputPath = join(workDir, 'source.mp4');
            logger.info(`  Скачивание с CDN...`);
            await downloadFromCDN(url, inputPath);

            const inputInfo = await stat(inputPath);
            logger.info(`  Размер: ${(inputInfo.size / 1024 / 1024).toFixed(1)}MB`);

            // 2. Перекодировать
            const outputPath = join(workDir, 'fixed.mp4');
            logger.info(`  Перекодировка...`);

            let lastPct = 0;
            await reencodeVideo(inputPath, outputPath, (pct) => {
                if (pct >= lastPct + 10) {
                    logger.info(`    Прогресс: ${pct}%`);
                    lastPct = pct;
                }
            });

            const outputInfo = await stat(outputPath);
            logger.info(`  Результат: ${(outputInfo.size / 1024 / 1024).toFixed(1)}MB`);

            // 3. Проверить что SAR теперь 1:1
            const newSar = await probeSAR(outputPath);
            if (newSar !== '1:1') {
                logger.error(`  ОШИБКА: SAR после перекодировки = ${newSar}, ожидали 1:1`);
                errors++;
                continue;
            }

            // 4. Загрузить на CDN (перезаписывает существующий файл)
            logger.info(`  Загрузка на CDN...`);
            const cdnUrl = await uploadFile(outputPath, `${getVideoPath(video.id)}/watermarked.mp4`, {
                videoId: video.id,
                step: 'reprocess-video',
                timeout: 600000,
            });
            logger.info(`  ✓ Загружено: ${cdnUrl}`);

            // 5. Лог в БД
            await query(
                `INSERT INTO processing_log (video_id, step, status, metadata)
                 VALUES ($1, 'reprocess-sar', 'completed', $2::jsonb)`,
                [video.id, JSON.stringify({
                    oldSar: sar,
                    newSar: '1:1',
                    originalSize: inputInfo.size,
                    fixedSize: outputInfo.size,
                })]
            );

            fixed++;
            logger.info(`  ✓ ИСПРАВЛЕНО (SAR ${sar} → 1:1)`);

        } catch (err) {
            logger.error(`  ✗ ОШИБКА: ${err.message}`);
            errors++;

            await query(
                `INSERT INTO processing_log (video_id, step, status, metadata)
                 VALUES ($1, 'reprocess-sar', 'failed', $2::jsonb)`,
                [video.id, JSON.stringify({ error: err.message, oldSar: sar })]
            ).catch(() => { });
        } finally {
            // Очистка временных файлов
            try {
                await rm(workDir, { recursive: true, force: true });
            } catch { /* ignore */ }
        }
    }

    logger.info('\n' + '='.repeat(60));
    logger.info('РЕЗУЛЬТАТ');
    logger.info(`Исправлено: ${fixed}`);
    logger.info(`Пропущено (SAR OK): ${skipped}`);
    logger.info(`Ошибки: ${errors}`);

    process.exit(0);
}

main().catch(err => {
    logger.error('Fatal:', err);
    process.exit(1);
});
