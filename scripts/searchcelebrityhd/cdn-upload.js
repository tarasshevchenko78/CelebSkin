#!/usr/bin/env node
/**
 * cdn-upload.js — Upload watermarked video + screenshots to BunnyCDN
 *
 * For searchcelebrityhd pipeline:
 *   1. Upload watermarked.mp4 from tmp/
 *   2. Download source screenshots and re-upload to CDN
 *   3. Update video_url, thumbnail_url, screenshots in DB
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { query } from '../lib/db.js';
import { uploadFile, uploadBuffer, getVideoPath } from '../lib/bunny.js';
import { config } from '../lib/config.js';
import logger from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(__dirname, '..', 'tmp');
const CDN_BASE = config.bunny.cdnUrl; // e.g. https://celebskin-cdn.b-cdn.net

const args = process.argv.slice(2);
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '20');

logger.info('=== SearchCelebrityHD CDN Upload ===');

// Get watermarked videos needing CDN upload
const { rows: videos } = await query(`
  SELECT v.id, v.video_url_watermarked, v.screenshots,
         v.slug->>'en' as slug_en,
         COALESCE(v.title->>'en', v.id::text) as title_en
  FROM videos v
  JOIN raw_videos rv ON rv.id = v.raw_video_id
  WHERE v.status = 'watermarked'
    AND v.video_url_watermarked IS NOT NULL
    AND v.video_url_watermarked NOT LIKE '%b-cdn.net%'
    AND rv.extra_data->>'source' = 'searchcelebrityhd'
  ORDER BY v.created_at ASC
  LIMIT $1
`, [limit]);

logger.info(`Found ${videos.length} videos to upload`);

let uploaded = 0, errors = 0;

for (const video of videos) {
  try {
    logger.info(`\n[${uploaded + errors + 1}/${videos.length}] ${video.title_en}`);
    const videoPath = getVideoPath(video.id);

    // 1. Upload watermarked video
    const localVideoPath = join(TMP_DIR, video.id, 'watermarked.mp4');
    logger.info('  Uploading watermarked video...');
    const videoUrl = await uploadFile(localVideoPath, `${videoPath}/video.mp4`);
    logger.info(`  Video → ${videoUrl}`);

    // 2. Upload screenshots from source URLs to CDN
    const screenshots = typeof video.screenshots === 'string'
      ? JSON.parse(video.screenshots) : (video.screenshots || []);
    const cdnScreenshots = [];

    for (let i = 0; i < screenshots.length; i++) {
      const srcUrl = screenshots[i];
      // Skip if already on CDN
      if (srcUrl.includes('b-cdn.net')) {
        cdnScreenshots.push(srcUrl);
        continue;
      }
      try {
        const resp = await axios.get(srcUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        const num = String(i + 1).padStart(2, '0');
        const cdnUrl = await uploadBuffer(
          resp.data,
          `${videoPath}/screenshot_${num}.jpg`,
          'image/jpeg'
        );
        cdnScreenshots.push(cdnUrl);
      } catch (err) {
        logger.warn(`  Screenshot ${i + 1} upload failed: ${err.message}`);
        cdnScreenshots.push(srcUrl); // keep source URL as fallback
      }
    }
    logger.info(`  ${cdnScreenshots.filter(u => u.includes('b-cdn')).length}/${screenshots.length} screenshots on CDN`);

    // 3. Update DB
    const thumbnailUrl = cdnScreenshots[0] || screenshots[0] || null;
    await query(
      `UPDATE videos SET
        video_url = $2,
        video_url_watermarked = $2,
        thumbnail_url = $3,
        screenshots = $4::jsonb,
        updated_at = NOW()
      WHERE id = $1`,
      [video.id, videoUrl, thumbnailUrl, JSON.stringify(cdnScreenshots)]
    );

    logger.info(`  ✓ Done`);
    uploaded++;
  } catch (err) {
    logger.error(`  ✗ ${video.title_en}: ${err.message}`);
    errors++;
  }
}

logger.info(`\n=== CDN Upload: ${uploaded} uploaded, ${errors} errors ===`);
