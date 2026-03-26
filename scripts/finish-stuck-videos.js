#!/usr/bin/env node
/**
 * finish-stuck-videos.js — Process videos stuck after watermark through media → cdn → publish
 * Does NOT clean up workdirs. Does NOT run scraper. Just finishes what was interrupted.
 *
 * Usage: node scripts/finish-stuck-videos.js
 */
import 'dotenv/config';
import { join } from 'path';
import { existsSync } from 'fs';

// Re-use pipeline v2 modules
const WORK_DIR = '/opt/celebskin/pipeline-work';

// Simple DB connection
import pg from 'pg';
const pool = new pg.Pool({
  host: process.env.DB_HOST || '185.224.82.214',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'celebskin',
  user: process.env.DB_USER || 'celebskin',
  password: process.env.DB_PASSWORD,
  max: 5,
});
const query = (sql, params) => pool.query(sql, params);

async function main() {
  // Find videos that passed watermark but didn't finish
  const { rows } = await query(`
    SELECT id, title->>'en' as title, status, pipeline_step,
           video_url_watermarked IS NOT NULL as has_cdn_watermark
    FROM videos
    WHERE status NOT IN ('published', 'failed', 'needs_review')
      AND (
        pipeline_step IN ('watermarked', 'media', 'media_generated', 'cdn_upload')
        OR (status IN ('watermarking', 'watermarking_home') AND pipeline_step IN ('watermarked', 'media', 'media_generated'))
      )
    ORDER BY created_at ASC
  `);

  console.log(`Found ${rows.length} videos to finish`);

  if (rows.length === 0) {
    console.log('Nothing to do');
    process.exit(0);
  }

  // Check which have local watermarked.mp4
  let canProcess = 0;
  let noFile = 0;

  for (const v of rows) {
    const workDir = join(WORK_DIR, v.id);
    const hasLocal = existsSync(join(workDir, 'watermarked.mp4'));
    const hasCdn = v.has_cdn_watermark;

    if (hasLocal || hasCdn) {
      canProcess++;
      // Reset status so pipeline can pick them up
      await query(
        `UPDATE videos SET status = 'watermarked', pipeline_step = 'media', updated_at = NOW() WHERE id = $1`,
        [v.id]
      );
      console.log(`  ✅ ${v.id.substring(0,8)} → media queue: ${v.title?.substring(0,60)}`);
    } else {
      noFile++;
      console.log(`  ❌ ${v.id.substring(0,8)} — no watermarked.mp4 (local or CDN): ${v.title?.substring(0,60)}`);
    }
  }

  console.log(`\nResult: ${canProcess} ready for media→cdn→publish, ${noFile} missing watermark`);
  console.log('\nNow run pipeline with: node run-pipeline-v2.js --step=media');
  console.log('Or start full pipeline — these videos will be picked up by auto-resume.');

  await pool.end();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
