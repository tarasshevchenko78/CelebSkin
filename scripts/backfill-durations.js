#!/usr/bin/env node
/**
 * backfill-durations.js — Fill missing duration for published videos via ffprobe
 * Uses Bunny Storage API with auth header since CDN returns 403
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { query, pool } from './lib/db.js';
import { config } from './lib/config.js';

const execAsync = promisify(exec);

const BUNNY_STORAGE_KEY = config.bunny.storageKey;
const BUNNY_STORAGE_ZONE = config.bunny.storageZone;

function formatDuration(seconds) {
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Convert CDN URL to Bunny Storage API URL
 * https://celebskin-cdn.b-cdn.net/videos/UUID/video.mp4
 *  → https://storage.bunnycdn.com/celebskin-media/videos/UUID/video.mp4
 */
function toStorageUrl(cdnUrl) {
    const path = cdnUrl.replace(/^https?:\/\/[^/]+\//, '');
    return `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${path}`;
}

async function getVideoDuration(cdnUrl) {
    const storageUrl = toStorageUrl(cdnUrl);
    try {
        const { stdout } = await execAsync(
            `ffprobe -headers "AccessKey: ${BUNNY_STORAGE_KEY}\r\n" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${storageUrl}"`,
            { timeout: 60000 }
        );
        const duration = parseFloat(stdout.trim());
        if (!isNaN(duration) && duration > 0) return duration;
    } catch (e) {
        console.error(`  Failed: ${e.message.slice(0, 100)}`);
    }
    return null;
}

async function run() {
    const res = await query(`
        SELECT id, video_url_watermarked, video_url
        FROM videos
        WHERE (duration_seconds IS NULL OR duration_seconds = 0)
          AND status = 'published'
        ORDER BY id
    `);
    console.log(`Found ${res.rows.length} videos to backfill`);

    let updated = 0, failed = 0;
    for (const row of res.rows) {
        const url = row.video_url_watermarked || row.video_url;
        if (!url) { failed++; continue; }

        const dur = await getVideoDuration(url);
        if (dur) {
            const formatted = formatDuration(dur);
            const seconds = Math.round(dur);
            await query('UPDATE videos SET duration_seconds=$1, duration_formatted=$2 WHERE id=$3', [seconds, formatted, row.id]);
            updated++;
            if (updated % 20 === 0) console.log(`  Progress: ${updated}/${res.rows.length}`);
        } else {
            failed++;
            console.log(`  FAIL video ${row.id}`);
        }
    }
    console.log(`Done! Updated: ${updated}, Failed: ${failed}`);
    await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
