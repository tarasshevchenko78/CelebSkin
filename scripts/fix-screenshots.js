#!/usr/bin/env node
/**
 * fix-screenshots.js — Fix videos with broken (tmp/) screenshot paths
 * Downloads video from CDN, extracts screenshots, uploads to BunnyCDN, updates DB
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const execFileAsync = promisify(execFile);

// Config
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || 'celebskin-media';
const BUNNY_STORAGE_KEY = process.env.BUNNY_STORAGE_KEY || '9499e5aa-b190-4956-948aac8f1a77-68ba-4f90';
const BUNNY_CDN_URL = process.env.BUNNY_CDN_URL || 'https://celebskin-cdn.b-cdn.net';
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';

const DB_PASSWORD = process.env.DB_PASSWORD || '35dwYElzsMhiXx7QabEy0Zen';

import pg from 'pg';
const pool = new pg.Pool({
    host: '127.0.0.1',
    port: 5432,
    database: 'celebskin',
    user: 'celebskin',
    password: DB_PASSWORD,
});

async function uploadFile(localPath, remotePath) {
    const data = await readFile(localPath);
    const url = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`;
    const resp = await fetch(url, {
        method: 'PUT',
        headers: {
            'AccessKey': BUNNY_STORAGE_KEY,
            'Content-Type': 'image/jpeg',
        },
        body: data,
    });
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status} ${resp.statusText}`);
    return `${BUNNY_CDN_URL}/${remotePath}`;
}

async function fixVideo(videoId) {
    const { rows } = await pool.query(
        `SELECT id, title->>'en' as title, video_url, video_url_watermarked,
                duration_seconds, ai_raw_response, hot_moments
         FROM videos WHERE id = $1`, [videoId]
    );
    if (!rows.length) { console.error('Video not found:', videoId); return; }

    const video = rows[0];
    const videoUrl = video.video_url_watermarked || video.video_url;
    if (!videoUrl || !videoUrl.startsWith('http')) {
        console.error('No valid CDN video URL for', videoId);
        return;
    }

    console.log(`Fixing: ${video.title}`);
    console.log(`  Video URL: ${videoUrl}`);

    const tmpDir = `/tmp/fix-${videoId}`;
    await mkdir(tmpDir, { recursive: true });

    try {
        // Get duration
        let duration = video.duration_seconds;
        if (!duration) {
            const { stdout } = await execFileAsync('ffprobe', [
                '-v', 'quiet', '-show_entries', 'format=duration',
                '-of', 'csv=p=0', videoUrl
            ]);
            duration = parseFloat(stdout.trim());
        }
        console.log(`  Duration: ${duration}s`);

        // Determine timestamps from AI data or evenly spaced
        const thumbCount = 20;
        const aiResponse = video.ai_raw_response;
        const aiTimestamps = aiResponse?.screenshot_timestamps;
        const bestThumbnailSec = aiResponse?.best_thumbnail_sec;
        let timestamps = [];

        if (aiTimestamps && aiTimestamps.length >= 4) {
            timestamps = aiTimestamps.filter(t => t > 0 && t < duration);
            if (bestThumbnailSec && !timestamps.includes(bestThumbnailSec)) {
                timestamps.push(bestThumbnailSec);
            }
            // Fill remaining with evenly spaced
            while (timestamps.length < thumbCount) {
                const ts = duration * (timestamps.length + 1) / (thumbCount + 1);
                if (!timestamps.some(t => Math.abs(t - ts) < 2)) timestamps.push(ts);
            }
            timestamps.sort((a, b) => a - b);
            timestamps = timestamps.slice(0, thumbCount);
        } else {
            for (let i = 0; i < thumbCount; i++) {
                timestamps.push(Math.max(0.5, duration * (i + 1) / (thumbCount + 1)));
            }
        }

        // Extract screenshots
        const screenshotPaths = [];
        for (let i = 0; i < timestamps.length; i++) {
            const ts = timestamps[i];
            const fileName = `thumb_${String(i + 1).padStart(3, '0')}.jpg`;
            const outPath = join(tmpDir, fileName);

            try {
                await execFileAsync('ffmpeg', [
                    '-ss', String(ts),
                    '-i', videoUrl,
                    '-vframes', '1',
                    '-vf', 'scale=1280:-2',
                    '-q:v', '3',
                    '-y', outPath
                ], { timeout: 30000 });

                if (existsSync(outPath)) {
                    screenshotPaths.push({ path: outPath, name: fileName });
                }
            } catch (e) {
                console.warn(`  Failed frame at ${ts}s:`, e.message);
            }
        }

        console.log(`  Extracted ${screenshotPaths.length} screenshots`);

        // Upload to CDN
        const cdnUrls = [];
        for (const { path, name } of screenshotPaths) {
            const cdnPath = `screenshots/${videoId}/${name}`;
            const cdnUrl = await uploadFile(path, cdnPath);
            cdnUrls.push(cdnUrl);
        }
        console.log(`  Uploaded ${cdnUrls.length} to CDN`);

        // Pick best thumbnail
        let thumbnailUrl = cdnUrls[0];
        if (bestThumbnailSec && timestamps.length > 0) {
            let closestIdx = 0;
            let closestDiff = Infinity;
            for (let i = 0; i < timestamps.length; i++) {
                const diff = Math.abs(timestamps[i] - bestThumbnailSec);
                if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
            }
            if (cdnUrls[closestIdx]) thumbnailUrl = cdnUrls[closestIdx];
        }

        // Create sprite sheet
        let spriteUrl = null;
        try {
            const spriteFile = join(tmpDir, 'sprite.jpg');
            const filterComplex = screenshotPaths.map((_, i) => `[${i}:v]scale=160:-2[s${i}]`).join(';')
                + ';' + screenshotPaths.map((_, i) => `[s${i}]`).join('') + `hstack=inputs=${screenshotPaths.length}`;

            // Simpler: use tile filter
            const cols = Math.min(screenshotPaths.length, 10);
            const rows = Math.ceil(screenshotPaths.length / cols);

            const inputArgs = [];
            for (const { path } of screenshotPaths) {
                inputArgs.push('-i', path);
            }

            await execFileAsync('ffmpeg', [
                ...inputArgs,
                '-filter_complex', `${screenshotPaths.map((_, i) => `[${i}:v]scale=160:-2[s${i}]`).join(';')};${screenshotPaths.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${screenshotPaths.length}:layout=${screenshotPaths.map((_, i) => `${(i % cols) * 160}_${Math.floor(i / cols) * 90}`).join('|')}`,
                '-q:v', '5',
                '-y', spriteFile
            ], { timeout: 30000 });

            if (existsSync(spriteFile)) {
                spriteUrl = await uploadFile(spriteFile, `screenshots/${videoId}/sprite.jpg`);
                console.log(`  Sprite uploaded`);
            }
        } catch (e) {
            console.warn(`  Sprite creation failed:`, e.message?.substring(0, 100));
        }

        // Update DB
        const spriteData = spriteUrl ? JSON.stringify({
            url: spriteUrl,
            frameWidth: 160,
            frameHeight: 90,
            framesPerRow: Math.min(screenshotPaths.length, 10),
            totalFrames: screenshotPaths.length,
        }) : null;

        let updateQuery = `UPDATE videos SET
            screenshots = $1::jsonb,
            thumbnail_url = $2`;
        const values = [JSON.stringify(cdnUrls), thumbnailUrl];
        let idx = 3;

        if (spriteUrl) {
            updateQuery += `, sprite_url = $${idx++}`;
            values.push(spriteUrl);
            updateQuery += `, sprite_data = $${idx++}::jsonb`;
            values.push(spriteData);
        }

        updateQuery += ` WHERE id = $${idx}`;
        values.push(videoId);

        await pool.query(updateQuery, values);
        console.log(`  DB updated: ${cdnUrls.length} screenshots, thumbnail: ${thumbnailUrl}`);

    } finally {
        await rm(tmpDir, { recursive: true, force: true });
    }
}

async function main() {
    // Find videos with broken screenshots
    const { rows } = await pool.query(`
        SELECT id, title->>'en' as title
        FROM videos
        WHERE (screenshots::text LIKE '%tmp/%' OR thumbnail_url LIKE 'tmp/%')
          AND status = 'published'
    `);

    // Also accept specific video ID as argument
    const specificId = process.argv[2];

    if (specificId) {
        await fixVideo(specificId);
    } else if (rows.length > 0) {
        console.log(`Found ${rows.length} videos with broken screenshots`);
        for (const row of rows) {
            console.log(`\nProcessing: ${row.title}`);
            await fixVideo(row.id);
        }
    } else {
        console.log('No videos with broken screenshots found');
    }

    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
