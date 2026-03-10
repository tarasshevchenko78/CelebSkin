#!/usr/bin/env node
/**
 * fix-broken-videos.js — Re-fetch download URLs for corrupted videos
 * and reset them for re-processing through the pipeline
 */

import BoobsRadarAdapter from './adapters/boobsradar-adapter.js';
import { query } from './lib/db.js';

const BROKEN_VIDEO_IDS = [
    '76602853-4ab6-4337-a695-de9b817f806e',
    '6b89de15-628b-4592-8244-577d235353bf',
    '6c80dcd6-b797-4a3d-92d8-d8236dab1484',
    '185e67bb-673b-4d16-af77-e0c22cfb0182',
    '0ff70874-a0f8-4ac9-bc50-bec496fb3899',
    '889fbaf5-ecb9-42cb-8842-dd4a68617686',
];

async function main() {
    const adapter = new BoobsRadarAdapter();
    let fixed = 0;
    let failed = 0;

    for (const videoId of BROKEN_VIDEO_IDS) {
        // Get source_url from raw_videos
        const { rows } = await query(
            `SELECT r.id as raw_id, r.source_url, r.video_file_url as old_url,
                    COALESCE(v.title->>'en', v.id::text) as title
             FROM videos v
             JOIN raw_videos r ON v.raw_video_id = r.id
             WHERE v.id = $1`,
            [videoId]
        );

        if (rows.length === 0) {
            console.log(`SKIP: ${videoId} — no raw_video found`);
            failed++;
            continue;
        }

        const { raw_id, source_url, title } = rows[0];
        console.log(`\n=== ${title} ===`);
        console.log(`  Source: ${source_url}`);

        try {
            // Re-fetch page to get fresh download URL
            console.log('  Fetching fresh download URL...');
            const metadata = await adapter.parseVideoPage(source_url);

            if (!metadata.video_file_url) {
                console.log('  FAILED: No video_file_url found on page');
                failed++;
                continue;
            }

            console.log(`  Fresh URL: ${metadata.video_file_url.substring(0, 80)}...`);

            // Verify the URL is accessible
            const response = await fetch(metadata.video_file_url, { method: 'HEAD' });
            if (!response.ok) {
                console.log(`  FAILED: URL not accessible (HTTP ${response.status})`);
                failed++;
                continue;
            }
            console.log(`  URL verified: HTTP ${response.status}, size: ${response.headers.get('content-length')}`);

            // Update raw_videos with fresh URL
            await query(
                `UPDATE raw_videos SET video_file_url = $2, updated_at = NOW() WHERE id = $1`,
                [raw_id, metadata.video_file_url]
            );

            // Reset video for re-processing:
            // - Set video_url to fresh source URL (watermark downloads from this)
            // - Clear watermarked URL (it's corrupted)
            // - Set status to 'enriched' so watermark picks it up
            await query(
                `UPDATE videos SET
                    video_url = $2,
                    video_url_watermarked = NULL,
                    status = 'enriched',
                    updated_at = NOW()
                 WHERE id = $1`,
                [videoId, metadata.video_file_url]
            );

            console.log(`  FIXED: Status → enriched, ready for re-watermarking`);
            fixed++;

            // Be nice to the server
            await adapter.delay(2000);

        } catch (err) {
            console.log(`  ERROR: ${err.message}`);
            failed++;
        }
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Fixed: ${fixed}, Failed: ${failed}`);

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
