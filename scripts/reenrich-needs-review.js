#!/usr/bin/env node
/**
 * reenrich-needs-review.js — Re-enrich needs_review videos
 *
 * Runs generate-multilang.js for each video missing translations.
 * Stops after 5 consecutive Gemini failures.
 *
 * Usage:
 *   node reenrich-needs-review.js                  # all needs_review without review
 *   node reenrich-needs-review.js --limit=50       # max 50
 *   node reenrich-needs-review.js --dry-run        # don't run, just show
 */

import { query, pool } from './lib/db.js';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

function getArg(name) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : '';
}
const LIMIT = parseInt(getArg('limit')) || 0;
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_CONSECUTIVE_FAILS = 5;

async function main() {
  console.log('═'.repeat(60));
  console.log(`Re-enrich needs_review videos — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('═'.repeat(60));

  // First: delete videos with no video_url (completely broken)
  const { rowCount: deleted } = await query(`
    DELETE FROM videos WHERE status = 'needs_review' AND video_url IS NULL
  `);
  if (deleted > 0) console.log(`Deleted ${deleted} videos with no video_url`);

  // Fix thumbnails: use first screenshot where thumbnail is missing
  const { rowCount: thumbFixed } = await query(`
    UPDATE videos SET thumbnail_url = screenshots->>0
    WHERE status = 'needs_review' AND thumbnail_url IS NULL
      AND screenshots IS NOT NULL AND jsonb_array_length(screenshots) > 0
  `);
  if (thumbFixed > 0) console.log(`Fixed ${thumbFixed} thumbnails from screenshots`);

  // Get videos needing multilang
  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
  const { rows: videos } = await query(`
    SELECT id, LEFT(original_title, 50) as title
    FROM videos
    WHERE status = 'needs_review'
      AND (review->>'en' IS NULL OR review->>'en' = '')
    ORDER BY created_at DESC
    ${limitClause}
  `);

  console.log(`\nVideos to enrich: ${videos.length}`);
  if (DRY_RUN) {
    videos.slice(0, 10).forEach(v => console.log(`  ${v.id} ${v.title}`));
    if (videos.length > 10) console.log(`  ... and ${videos.length - 10} more`);
    await pool.end();
    return;
  }

  let success = 0, failed = 0, consecutiveFails = 0;

  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    try {
      const { stdout, stderr } = await execFile('node', ['generate-multilang.js', `--video-id=${v.id}`], {
        cwd: '/opt/celebskin/site/scripts',
        timeout: 180000,
        env: { ...process.env, DB_HOST: process.env.DB_HOST || 'localhost' },
      });

      // Check if it actually worked
      const output = stdout + stderr;
      if (output.includes('DB updated') || output.includes('Generated content')) {
        success++;
        consecutiveFails = 0;
        if ((i + 1) % 25 === 0) {
          console.log(`Progress: ${i + 1}/${videos.length} | Success: ${success} | Failed: ${failed}`);
        }
      } else {
        throw new Error('No "DB updated" in output');
      }
    } catch (e) {
      failed++;
      const errMsg = e.stderr || e.message || '';
      const isKeyError = errMsg.includes('403') || errMsg.includes('429') || errMsg.includes('quota') ||
                         errMsg.includes('API key') || errMsg.includes('RESOURCE_EXHAUSTED');

      if (isKeyError) {
        consecutiveFails++;
        console.error(`  ❌ ${v.id} — Gemini failure #${consecutiveFails}/${MAX_CONSECUTIVE_FAILS}: ${errMsg.substring(0, 80)}`);
        if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
          console.error(`\n🛑 STOPPED: ${consecutiveFails} consecutive Gemini failures. Update keys in /admin/settings.`);
          break;
        }
      } else {
        console.error(`  ⚠ ${v.id} — ${errMsg.substring(0, 100)}`);
        consecutiveFails = 0; // non-key error, reset counter
      }
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`Enrichment: ${success} done, ${failed} failed out of ${videos.length}`);

  // Auto-publish: videos with video + thumbnail + review → published
  const { rowCount: published } = await query(`
    UPDATE videos SET status = 'published', updated_at = NOW()
    WHERE status = 'needs_review'
      AND video_url IS NOT NULL
      AND thumbnail_url IS NOT NULL
      AND review->>'en' IS NOT NULL AND review->>'en' != ''
      AND title->>'ru' IS NOT NULL AND title->>'ru' != ''
  `);
  console.log(`Auto-published: ${published} videos`);

  // Stats
  const { rows: [s] } = await query(`
    SELECT COUNT(*) as total,
      COUNT(*) FILTER (WHERE review->>'en' IS NOT NULL AND review->>'en' != '') as has_review
    FROM videos WHERE status = 'needs_review'
  `);
  console.log(`Remaining needs_review: ${s.total} (${s.total - s.has_review} without review)`);

  await pool.end();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
