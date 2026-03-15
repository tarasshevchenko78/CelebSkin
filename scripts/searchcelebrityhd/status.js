#!/usr/bin/env node
/**
 * status.js — SearchCelebrityHD Pipeline Status Monitor
 *
 * Shows current state of every pipeline step with video counts and details.
 */

import { query } from '../lib/db.js';

const STEPS = [
  { name: '1. RAW (pending)',     status: 'pending',     table: 'raw' },
  { name: '2. RAW (processing)',  status: 'processing',  table: 'raw' },
  { name: '3. RAW (processed)',   status: 'processed',   table: 'raw' },
  { name: '4. ENRICHED',         status: 'enriched',    table: 'video' },
  { name: '5. WATERMARKED',      status: 'watermarked', table: 'video' },
  { name: '6. PUBLISHED',        status: 'published',   table: 'video' },
  { name: '7. NEEDS_REVIEW',     status: 'needs_review', table: 'video' },
];

const showDetails = process.argv.includes('--details') || process.argv.includes('-d');

console.log('\n' + '═'.repeat(70));
console.log('  SearchCelebrityHD Pipeline Status');
console.log('  ' + new Date().toISOString());
console.log('═'.repeat(70));

// Raw videos stats
const { rows: rawStats } = await query(`
  SELECT status, COUNT(*) as count
  FROM raw_videos
  WHERE extra_data->>'source' = 'searchcelebrityhd'
  GROUP BY status ORDER BY status
`);

console.log('\n┌─ RAW VIDEOS ────────────────────────────────────────────┐');
for (const r of rawStats) {
  console.log(`│  ${r.status.padEnd(15)} ${String(r.count).padStart(5)} videos │`);
}
const totalRaw = rawStats.reduce((s, r) => s + parseInt(r.count), 0);
console.log(`│  ${'TOTAL'.padEnd(15)} ${String(totalRaw).padStart(5)} videos │`);
console.log('└────────────────────────────────────────────────────────┘');

// Video statuses
const { rows: videoStats } = await query(`
  SELECT v.status, COUNT(*) as count,
         COUNT(CASE WHEN v.video_url LIKE '%b-cdn%' THEN 1 END) as on_cdn,
         COUNT(CASE WHEN v.preview_gif_url IS NOT NULL AND v.preview_gif_url != '' THEN 1 END) as has_gif,
         COUNT(CASE WHEN v.preview_url IS NOT NULL AND v.preview_url != '' THEN 1 END) as has_preview,
         COUNT(CASE WHEN v.thumbnail_url IS NOT NULL THEN 1 END) as has_thumb
  FROM videos v
  JOIN raw_videos rv ON rv.id = v.raw_video_id
  WHERE rv.extra_data->>'source' = 'searchcelebrityhd'
  GROUP BY v.status ORDER BY v.status
`);

console.log('\n┌─ VIDEOS ────────────────────────────────────────────────┐');
console.log('│  Status          Count  CDN  GIF  Preview  Thumb       │');
console.log('│  ─────────────── ───── ──── ──── ──────── ─────       │');
for (const r of videoStats) {
  console.log(`│  ${r.status.padEnd(16)} ${String(r.count).padStart(5)} ${String(r.on_cdn).padStart(4)} ${String(r.has_gif).padStart(4)} ${String(r.has_preview).padStart(8)} ${String(r.has_thumb).padStart(5)}       │`);
}
const totalVid = videoStats.reduce((s, r) => s + parseInt(r.count), 0);
console.log(`│  ${'TOTAL'.padEnd(16)} ${String(totalVid).padStart(5)}                              │`);
console.log('└────────────────────────────────────────────────────────┘');

// Show details if --details flag
if (showDetails) {
  console.log('\n┌─ VIDEO DETAILS ─────────────────────────────────────────┐');

  const { rows: details } = await query(`
    SELECT v.id, v.status,
           COALESCE(v.title->>'en', 'untitled') as title,
           v.video_url IS NOT NULL AND v.video_url LIKE '%b-cdn%' as on_cdn,
           v.preview_gif_url IS NOT NULL AND v.preview_gif_url != '' as has_gif,
           v.preview_url IS NOT NULL AND v.preview_url != '' as has_preview,
           v.video_url_watermarked IS NOT NULL as has_wm,
           (SELECT COUNT(*) FROM video_celebrities vc WHERE vc.video_id = v.id) as celebs,
           (SELECT COUNT(*) FROM video_tags vt WHERE vt.video_id = v.id) as tags,
           v.created_at::date as created
    FROM videos v
    JOIN raw_videos rv ON rv.id = v.raw_video_id
    WHERE rv.extra_data->>'source' = 'searchcelebrityhd'
    ORDER BY v.status, v.created_at DESC
  `);

  for (const d of details) {
    const flags = [
      d.on_cdn ? 'CDN' : '',
      d.has_wm ? 'WM' : '',
      d.has_gif ? 'GIF' : '',
      d.has_preview ? 'PREV' : '',
    ].filter(Boolean).join(',');

    const title = d.title.length > 45 ? d.title.substring(0, 42) + '...' : d.title;
    console.log(`│  [${d.status.padEnd(13)}] ${title.padEnd(45)} ${flags.padEnd(15)} C:${d.celebs} T:${d.tags}`);
  }
  console.log('└────────────────────────────────────────────────────────┘');
}

// Pipeline health
console.log('\n┌─ PIPELINE HEALTH ───────────────────────────────────────┐');
const pendingRaw = rawStats.find(r => r.status === 'pending')?.count || 0;
const enriched = videoStats.find(r => r.status === 'enriched')?.count || 0;
const watermarked = videoStats.find(r => r.status === 'watermarked')?.count || 0;
const published = videoStats.find(r => r.status === 'published')?.count || 0;
const review = videoStats.find(r => r.status === 'needs_review')?.count || 0;
const noGif = videoStats.reduce((s, r) => s + parseInt(r.count) - parseInt(r.has_gif), 0);

console.log(`│  Pending scrape:     ${String(pendingRaw).padStart(5)}  (waiting for AI)             │`);
console.log(`│  Enriched:           ${String(enriched).padStart(5)}  (waiting for watermark)        │`);
console.log(`│  Watermarked:        ${String(watermarked).padStart(5)}  (waiting for CDN upload)     │`);
console.log(`│  Published:          ${String(published).padStart(5)}  ✓                             │`);
console.log(`│  Needs review:       ${String(review).padStart(5)}  ⚠                             │`);
console.log(`│  Missing GIF:        ${String(noGif).padStart(5)}  (need generate-preview)       │`);
console.log('└────────────────────────────────────────────────────────┘');

process.exit(0);
