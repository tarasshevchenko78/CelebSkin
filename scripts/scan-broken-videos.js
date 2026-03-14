#!/usr/bin/env node
/**
 * scan-broken-videos.js — Scan published videos for encoding issues
 *
 * Checks all published videos on CDN for:
 *   - Non-standard SAR (sample aspect ratio) — causes Chrome PIPELINE_ERROR_DECODE on seek
 *   - Missing audio/video streams
 *   - Probe failures (corrupted files)
 *
 * Usage:
 *   node scan-broken-videos.js              # scan all published
 *   node scan-broken-videos.js --limit=50   # scan first 50
 *   node scan-broken-videos.js --fix        # output IDs suitable for reprocess script
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { query } from './lib/db.js';
import logger from './lib/logger.js';

const execFileAsync = promisify(execFile);

function parseArgs() {
    const args = { limit: 0, fix: false };
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1]);
        if (arg === '--fix') args.fix = true;
    }
    return args;
}

async function probeVideo(url) {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error',
            '-analyzeduration', '5000000',
            '-probesize', '5000000',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=codec_name,width,height,sample_aspect_ratio,level',
            '-print_format', 'json',
            url,
        ], { timeout: 30000 });

        const data = JSON.parse(stdout);
        const video = data.streams?.[0];
        if (!video) return { error: 'no_video_stream' };

        return {
            codec: video.codec_name,
            width: video.width,
            height: video.height,
            sar: video.sample_aspect_ratio || 'N/A',
            level: video.level,
        };
    } catch (err) {
        return { error: err.message.slice(0, 200) };
    }
}

async function probeAudio(url) {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error',
            '-analyzeduration', '5000000',
            '-probesize', '5000000',
            '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_name,sample_rate,channels',
            '-print_format', 'json',
            url,
        ], { timeout: 30000 });

        const data = JSON.parse(stdout);
        const audio = data.streams?.[0];
        if (!audio) return { error: 'no_audio_stream' };

        return {
            codec: audio.codec_name,
            sampleRate: audio.sample_rate,
            channels: audio.channels,
        };
    } catch (err) {
        return { error: err.message.slice(0, 200) };
    }
}

async function main() {
    const args = parseArgs();

    logger.info('='.repeat(60));
    logger.info('CelebSkin — Video Integrity Scanner');
    logger.info('='.repeat(60));

    // Get published videos
    const limitClause = args.limit > 0 ? `LIMIT ${args.limit}` : '';
    const { rows: videos } = await query(`
        SELECT v.id, v.video_url_watermarked, v.duration_seconds,
               COALESCE(v.title->>'en', v.id::text) as title
        FROM videos v
        WHERE v.status = 'published'
        AND v.video_url_watermarked LIKE '%b-cdn.net%'
        ORDER BY v.created_at ASC
        ${limitClause}
    `);

    logger.info(`Найдено ${videos.length} опубликованных видео для проверки`);

    const broken = [];
    const ok = [];
    const errors = [];
    let checked = 0;

    for (const video of videos) {
        checked++;
        const url = video.video_url_watermarked;

        // Probe video stream
        const videoInfo = await probeVideo(url);
        if (videoInfo.error) {
            errors.push({ id: video.id, title: video.title, reason: videoInfo.error });
            logger.error(`[${checked}/${videos.length}] ОШИБКА ${video.id} — ${video.title.slice(0, 50)}: ${videoInfo.error}`);
            continue;
        }

        // Probe audio stream
        const audioInfo = await probeAudio(url);
        if (audioInfo.error) {
            errors.push({ id: video.id, title: video.title, reason: audioInfo.error });
            logger.error(`[${checked}/${videos.length}] НЕТ АУДИО ${video.id} — ${video.title.slice(0, 50)}`);
            continue;
        }

        // Check SAR
        const sar = videoInfo.sar;
        const isBadSar = sar !== '1:1' && sar !== 'N/A' && sar !== '0:1';

        if (isBadSar) {
            broken.push({
                id: video.id,
                title: video.title,
                duration: video.duration_seconds,
                sar: videoInfo.sar,
                resolution: `${videoInfo.width}x${videoInfo.height}`,
                level: videoInfo.level,
            });
            if (checked % 10 === 0 || checked <= 5) {
                logger.warn(`[${checked}/${videos.length}] SAR≠1:1 ${video.id} — SAR=${sar} ${videoInfo.width}x${videoInfo.height}`);
            }
        } else {
            ok.push(video.id);
        }

        // Progress every 50
        if (checked % 50 === 0) {
            logger.info(`[${checked}/${videos.length}] Проверено... (${broken.length} с проблемами)`);
        }
    }

    // Summary
    logger.info('\n' + '='.repeat(60));
    logger.info('РЕЗУЛЬТАТ СКАНИРОВАНИЯ');
    logger.info('='.repeat(60));
    logger.info(`Всего проверено: ${checked}`);
    logger.info(`OK (SAR=1:1): ${ok.length}`);
    logger.info(`Нужна перекодировка (SAR≠1:1): ${broken.length}`);
    logger.info(`Ошибки проверки: ${errors.length}`);

    if (errors.length > 0) {
        logger.info('\n--- Ошибки проверки ---');
        for (const e of errors) {
            logger.error(`  ${e.id}: ${e.reason}`);
        }
    }

    if (broken.length > 0 && args.fix) {
        // Output IDs for reprocess script
        logger.info('\n--- ID для перекодировки ---');
        const ids = broken.map(b => b.id);
        console.log(JSON.stringify(ids, null, 2));
    }

    if (broken.length > 0) {
        logger.info(`\n💡 Для исправления запустите:`);
        logger.info(`   node reprocess-broken-videos.js --limit=10`);
    }

    // Log to DB
    try {
        await query(
            `INSERT INTO processing_log (step, status, metadata)
             VALUES ('scan-broken', 'completed', $1::jsonb)`,
            [JSON.stringify({
                total: checked,
                ok: ok.length,
                broken: broken.length,
                errors: errors.length,
                brokenIds: broken.map(b => b.id),
            })]
        );
    } catch { /* ignore */ }

    process.exit(0);
}

main().catch(err => {
    logger.error('Fatal:', err);
    process.exit(1);
});
