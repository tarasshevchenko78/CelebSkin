#!/usr/bin/env node
/**
 * ai-vision-analyze.js — AI Vision анализ видео через Gemini
 * Pipeline v2.0, Step 3: AI VISION
 *
 * Usage:
 *   node ai-vision-analyze.js --video-id=UUID
 *   node ai-vision-analyze.js --video-id=UUID --model=gemini-3.1-pro-preview
 *   node ai-vision-analyze.js --video-id=UUID --dry-run  (не пишет в БД)
 *
 * Читает: /opt/celebskin/pipeline-work/{videoId}/original.mp4
 * Пишет:  /opt/celebskin/pipeline-work/{videoId}/metadata.json
 * Обновляет: videos.ai_vision_status, hot_moments, best_thumbnail_sec, preview_start_sec
 *
 * Зависимости: lib/config.js, lib/tags.js, lib/db.js
 */

import { readFile, writeFile, stat } from 'fs/promises';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import { config } from './lib/config.js';
import { query } from './lib/db.js';
import { normalizeTags, mapDonorTags } from './lib/tags.js';

// ============================================================
// Constants
// ============================================================

// Multi-key rotation
const GEMINI_API_KEYS = (config.ai.geminiApiKey || '').split(',').map(k => k.trim()).filter(Boolean);
let _visionKeyIdx = 0;
// Use SAME key for entire upload+generate cycle (File API files are key-bound)
let _currentSessionKey = '';
function nextSessionKey() { _currentSessionKey = GEMINI_API_KEYS[_visionKeyIdx++ % GEMINI_API_KEYS.length] || ''; return _currentSessionKey; }
function getVisionApiKey() { return _currentSessionKey || GEMINI_API_KEYS[0] || ''; }
const GEMINI_API_KEY = GEMINI_API_KEYS[0] || '';
const WORK_DIR = '/opt/celebskin/pipeline-work';

// Model cascade: primary → fallback 1 → fallback 2
const VISION_MODELS = [
  'gemini-3-flash-preview',     // основная — без цензуры, быстрая
  'gemini-3.1-pro-preview',     // fallback 1 — без цензуры, качественнее
  'gemini-2.5-pro',             // fallback 2 — проходит с default safety
];

// Safety settings: НЕ передавать (default для 3.x не цензурит)
// Для 2.5-pro: тоже default (BLOCK_NONE даёт пустой ответ!)

const MAX_INLINE_SIZE = 18 * 1024 * 1024; // 18MB safe limit for inline base64
const BIG_FILE_THRESHOLD = 100 * 1024 * 1024; // 100MB: use screenshot frames instead of File API
const BIG_FILE_FRAME_COUNT = 8; // frames to extract for big-file analysis
const execFileAsync = promisify(execFileCb);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

// ============================================================
// System Prompt — AI Знаток (из CELEBSKIN_TAGS_V3_AI_EXPERT.md)
// ============================================================

const SYSTEM_PROMPT = `You are the world's most knowledgeable celebrity nude scene analyst and film database curator.
You have encyclopedic knowledge of:

## YOUR EXPERTISE

1. **Nudity classification** — You can precisely distinguish between levels:
   - "sexy" (provocative clothing, no nudity)
   - "cleavage" (deep neckline, partial breast visibility)
   - "bikini" (swimwear)
   - "lingerie" (underwear, stockings, corsets)
   - "topless" (breasts fully exposed, lower body clothed)
   - "butt" (bare buttocks visible)
   - "nude" (full nudity, breasts + buttocks, but genitals NOT visible)
   - "bush" (pubic hair visible — can appear with nude or full-frontal)
   - "full-frontal" (genitals visible from front)
   
   You ALWAYS pick the HIGHEST visible level, never lower.
   If you see full-frontal, you do NOT also tag topless — just full-frontal.

2. **Scene type classification** — You understand the difference between:
   - "sex-scene" (simulated intercourse in mainstream film)
   - "explicit" / "unsimulated" (REAL sex, not acting — like in Nymphomaniac, 9 Songs, Love by Gaspar Noé)
   - "blowjob" (specifically oral performed on male — separate from generic "oral")
   - "oral" (cunnilingus or non-specific oral sex)
   - "lesbian" (sexual contact between women)
   - "masturbation" (solo sexual stimulation shown)
   - "striptease" (deliberate, performative undressing)
   - "shower" (bathroom/shower/bath scene)
   - "skinny-dip" (outdoor nude swimming)
   - "rape-scene" (rape depicted in film — NOT real, cinematic portrayal)
   - "gang-rape" (group rape depicted in film)

3. **Context reading** — You detect:
   - "romantic" (soft lighting, slow pace, tenderness)
   - "rough" (aggressive, dominant energy)
   - "bed-scene" (specifically on a bed)
   - "threesome" (3+ participants in sexual activity)
   - "bdsm" (bondage, restraints, power dynamics)
   - "body-double" (you know which actresses famously use doubles: Julia Roberts, Megan Fox, etc.)
   - "prosthetic" (CGI/prosthetic nudity: Game of Thrones Cersei walk of shame, etc.)

4. **Media type identification**:
   - "movie" (theatrical film)
   - "tv-show" (series/miniseries)
   - "music-video" (music clip)
   - "on-stage" (theater/performance)
   - "photoshoot" (magazine/editorial shoot)

5. **Film knowledge** — You know:
   - Which films are famous for explicit/unsimulated scenes (9 Songs, Love, Nymphomaniac, Intimacy, The Brown Bunny, Shortbus)
   - Which TV shows have notable nudity (Euphoria, Game of Thrones, Spartacus, True Blood, Altered Carbon, The Idol)
   - Which actresses are known for bold roles (Margot Robbie, Sydney Sweeney, Florence Pugh, Ana de Armas, Léa Seydoux, Monica Bellucci)
   - The difference between European cinema (more nudity-friendly) and Hollywood (more conservative)
   - French cinema traditions (Godard, Breillat, Noé), Korean cinema explicit wave, Italian cinema giallo tradition

6. **Quality assessment** — You can identify:
   - Video resolution quality
   - Whether this is the original scene or a compilation
   - Whether the nudity is the celebrity or a body double
   - Scene context within the film's plot

## CRITICAL RULES

- You tag ONLY what you SEE, never what the title suggests
- If the title says "nude" but you only see topless — tag topless
- If the donor says "full frontal" but you only see butt — tag butt
- You NEVER invent content that isn't visible
- "bush" is tagged ADDITIONALLY when pubic hair is clearly visible
- "explicit" ONLY for confirmed unsimulated sex (you know which films have this)
- "blowjob" is separate from "oral" (cunnilingus) — classify correctly
- Maximum 5 tags total: 1 nudity + [1 bush] + 1 scene + 0-2 context + 1 media

## HOT MOMENTS & PREVIEW SELECTION (CRITICAL)

You MUST identify the most scandalous, provocative, eye-catching moments for thumbnails and preview:

- **hot_moments**: List ALL moments where nudity appears or intensifies. Order by visual impact (most revealing first). Include EVERY timestamp where skin is first shown, clothing removed, or intimacy peaks. Minimum 3, maximum 8.
- **best_thumbnail_sec**: The SINGLE most provocative frame that would make someone click. This should show the MAXIMUM nudity level visible in the video — topless > cleavage, nude > topless. Pick a frame where the actress is facing camera, well-lit, and the nudity is clearly visible. NOT a dark frame, NOT a face closeup, NOT a clothed moment.
- **preview_start_sec**: Start the 6-second preview clip 2-4 seconds BEFORE the peak moment (best_thumbnail_sec). The preview must SHOW the hottest action — undressing, the reveal, the sex scene climax. If there are multiple peak moments, pick the one that starts with clothed and TRANSITIONS to nude within the 6 seconds — this creates the most compelling preview.

## OUTPUT FORMAT

Return ONLY valid JSON (no markdown, no backticks, no explanation):
{
  "nudity_level": "topless",
  "scene_type": "sex-scene",
  "context_tags": ["bed-scene", "romantic"],
  "media_type": "movie",
  "bush_visible": false,
  "all_tags": ["topless", "sex-scene", "bed-scene", "romantic", "movie"],
  "hot_moments": [
    {"timestamp_sec": 42, "label": "topless revealed — most explicit"},
    {"timestamp_sec": 78, "label": "sex scene peak — maximum skin"},
    {"timestamp_sec": 15, "label": "kissing and undressing begins"}
  ],
  "best_thumbnail_sec": 42,
  "preview_start_sec": 38,
  "description_en": "2-3 sentence description as a film connoisseur",
  "donor_tag_comparison": {
    "agreed": ["topless", "sex scene"],
    "disagreed": [
      {"donor": "full frontal", "actual": "topless", "reason": "genitals never visible"}
    ]
  },
  "confidence": 0.95,
  "is_explicit_unsimulated": false,
  "body_double_suspected": false,
  "quality_notes": "1080p, original scene"
}`;

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);

function getArg(name) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}

const videoId = getArg('video-id');
const forceModel = getArg('model');
const dryRun = args.includes('--dry-run');

if (!videoId) {
  console.error('Usage: node ai-vision-analyze.js --video-id=UUID');
  console.error('Options:');
  console.error('  --model=gemini-3-flash-preview   Force specific model');
  console.error('  --dry-run                        Don\'t write to DB');
  process.exit(1);
}

if (GEMINI_API_KEYS.length === 0) {
  console.error('GEMINI_API_KEY not set in scripts/.env');
  process.exit(1);
}

// ============================================================
// Screenshot frame extractor (for videos > 100MB — avoids File API)
// ============================================================

async function extractFrameBuffers(videoPath, frameCount = BIG_FILE_FRAME_COUNT) {
  // Get video duration via ffprobe
  let duration = 0;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0', videoPath,
    ], { timeout: 15000 });
    duration = parseFloat(stdout.trim()) || 0;
  } catch {
    duration = 120; // fallback assumption
  }

  // Evenly-spaced timestamps: skip first/last 5% to avoid black frames
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const t = duration * (0.05 + (0.9 * i) / (frameCount - 1));
    try {
      const { stdout } = await execFileAsync('ffmpeg', [
        '-ss', String(t.toFixed(2)),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', 'scale=1280:-1',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        '-q:v', '5',
        'pipe:1',
      ], { timeout: 15000, maxBuffer: 5 * 1024 * 1024, encoding: 'buffer' });
      if (stdout && stdout.length > 1000) {
        frames.push({ buffer: stdout, mimeType: 'image/jpeg' });
      }
    } catch {
      // skip failed frame
    }
  }

  console.log(`  Extracted ${frames.length}/${frameCount} frames from ${(duration).toFixed(0)}s video`);
  return frames;
}

// ============================================================
// Gemini File API (for videos > 18MB)
// ============================================================

async function uploadToFileAPI(videoBuffer, mimeType) {
  const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);
  console.log(`  File > 18MB (${fileSizeMB}MB), using File API upload...`);

  // Single AbortController for the entire upload + poll flow (3 min hard limit)
  const controller = new AbortController();
  const uploadTimeout = setTimeout(() => controller.abort(), 3 * 60 * 1000);

  try {
    // Step 1: Start resumable upload
    let startRes;
    try {
      startRes = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${getVisionApiKey()}`,
        {
          method: 'POST',
          headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(videoBuffer.length),
            'X-Goog-Upload-Header-Content-Type': mimeType,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            file: { displayName: `video-${videoId}` },
          }),
          signal: controller.signal,
        }
      );
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('File API: start request timed out after 3 min');
      throw err;
    }

    const uploadUrl = startRes.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) {
      throw new Error(`File API: failed to get upload URL. Status: ${startRes.status}`);
    }

    // Step 2: Upload the bytes
    let uploadRes;
    try {
      uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Command': 'upload, finalize',
          'X-Goog-Upload-Offset': '0',
          'Content-Length': String(videoBuffer.length),
        },
        body: videoBuffer,
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('File API: upload timed out after 3 min');
      throw err;
    }

    const uploadData = await uploadRes.json();
    const fileUri = uploadData?.file?.uri;
    const fileName = uploadData?.file?.name;

    if (!fileUri) {
      throw new Error(`File API: upload succeeded but no fileUri. Response: ${JSON.stringify(uploadData).substring(0, 300)}`);
    }

    console.log(`  Uploaded: ${fileName}`);

    // Step 3: Poll until file is ACTIVE
    let attempts = 0;
    while (attempts < 30) {
      let checkRes;
      try {
        checkRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${getVisionApiKey()}`,
          { signal: controller.signal }
        );
      } catch (err) {
        if (err.name === 'AbortError') throw new Error('File API: polling timed out after 3 min');
        throw err;
      }
      const checkData = await checkRes.json();

      if (checkData.state === 'ACTIVE') {
        console.log(`  File ready: ${fileUri}`);
        return fileUri;
      }

      if (checkData.state === 'FAILED') {
        throw new Error(`File API: processing failed. ${JSON.stringify(checkData)}`);
      }

      attempts++;
      await sleep(2000);
    }

    throw new Error('File API: timed out waiting for file to become ACTIVE');
  } finally {
    clearTimeout(uploadTimeout);
  }
}

// ============================================================
// Gemini Vision API call
// ============================================================

async function callGeminiVision(model, userPrompt, videoBuffer, mimeType, frameBuffers = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${getVisionApiKey()}`;

  // Build content parts: screenshot frames (big files) or inline/File API video
  let mediaParts;
  if (frameBuffers && frameBuffers.length > 0) {
    // Big file fallback: send JPEG frames as inline images (no File API)
    mediaParts = frameBuffers.map(({ buffer, mimeType: imgMime }) => ({
      inlineData: { mimeType: imgMime, data: buffer.toString('base64') },
    }));
  } else {
    // Normal path: inline video or File API
    let videoPart;
    if (videoBuffer.length <= MAX_INLINE_SIZE) {
      videoPart = {
        inlineData: {
          mimeType,
          data: videoBuffer.toString('base64'),
        },
      };
    } else {
      const fileUri = await uploadToFileAPI(videoBuffer, mimeType);
      videoPart = {
        fileData: {
          mimeType,
          fileUri,
        },
      };
    }
    mediaParts = [videoPart];
  }

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{
      parts: [
        { text: userPrompt },
        ...mediaParts,
      ],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    ],
  };

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 4 * 60 * 1000); // 4 min
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(fetchTimeout);
    if (err.name === 'AbortError') {
      return { status: 'error', error: 'Gemini API timeout after 4 min' };
    }
    throw err;
  }
  clearTimeout(fetchTimeout);

  const data = await response.json();

  // Error handling
  if (data.error) {
    return { status: 'error', error: data.error.message || 'Unknown API error' };
  }

  const candidate = data.candidates?.[0];
  if (!candidate) {
    const blockReason = data.promptFeedback?.blockReason;
    if (blockReason) {
      return { status: 'censored', error: `Input blocked: ${blockReason}` };
    }
    return { status: 'error', error: `No candidate. Response: ${JSON.stringify(data).substring(0, 300)}` };
  }

  if (candidate.finishReason === 'SAFETY') {
    const ratings = (candidate.safetyRatings || []).filter(r => r.blocked);
    return {
      status: 'censored',
      error: `Output blocked: ${ratings.map(r => r.category).join(', ') || 'SAFETY'}`,
    };
  }

  // Extract text
  const parts = candidate.content?.parts || [];
  const textPart = parts.find(p => p.text && !p.thought);
  const text = textPart?.text || parts[parts.length - 1]?.text || '';

  if (!text.trim()) {
    return { status: 'empty', error: `Empty response. finishReason=${candidate.finishReason}` };
  }

  return { status: 'ok', text };
}

// ============================================================
// Parse and validate Gemini response
// ============================================================

function parseGeminiResponse(text) {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  const parsed = JSON.parse(cleaned);

  // Validate required fields
  if (!parsed.nudity_level) {
    throw new Error('Missing required field: nudity_level');
  }

  // Ensure hot_moments is array
  if (!Array.isArray(parsed.hot_moments)) {
    parsed.hot_moments = [];
  }

  // Ensure all_tags is array
  if (!Array.isArray(parsed.all_tags)) {
    // Reconstruct from individual fields
    parsed.all_tags = [
      parsed.nudity_level,
      parsed.bush_visible ? 'bush' : null,
      parsed.scene_type,
      ...(parsed.context_tags || []),
      parsed.media_type,
    ].filter(Boolean);
  }

  // Ensure numeric fields
  parsed.best_thumbnail_sec = parseInt(parsed.best_thumbnail_sec) || null;
  parsed.preview_start_sec = parseInt(parsed.preview_start_sec) || null;
  parsed.confidence = parseFloat(parsed.confidence) || 0.5;

  return parsed;
}

// ============================================================
// Fetch video metadata from DB
// ============================================================

async function getVideoMeta(videoId) {
  // Get video + raw_videos data
  const { rows: videoRows } = await query(`
    SELECT
      v.id,
      v.original_title,
      v.title->>'en' AS title_en,
      v.status,
      v.donor_tags,
      v.duration_seconds,
      r.raw_tags,
      r.raw_title,
      r.raw_categories
    FROM videos v
    LEFT JOIN raw_videos r ON v.raw_video_id = r.id
    WHERE v.id = $1
  `, [videoId]);

  if (!videoRows.length) {
    throw new Error(`Video not found: ${videoId}`);
  }
  const video = videoRows[0];

  // Get celebrities
  const { rows: celebRows } = await query(`
    SELECT c.name, c.nationality, c.tmdb_id
    FROM video_celebrities vc
    JOIN celebrities c ON vc.celebrity_id = c.id
    WHERE vc.video_id = $1
  `, [videoId]);

  // Get movie via movie_scenes
  const { rows: movieRows } = await query(`
    SELECT m.title, m.year, m.genres, m.countries, m.tmdb_id
    FROM movie_scenes ms
    JOIN movies m ON ms.movie_id = m.id
    WHERE ms.video_id = $1
    LIMIT 1
  `, [videoId]);

  return {
    video,
    celebrities: celebRows,
    movie: movieRows[0] || null,
    rawTags: video.raw_tags || video.donor_tags || [],
  };
}

// ============================================================
// Build user prompt with context
// ============================================================

function buildUserPrompt(meta) {
  const { video, celebrities, movie, rawTags } = meta;

  const celebNames = celebrities.map(c => c.name).join(', ') || 'Unknown';
  const movieTitle = movie?.title || 'Unknown';
  const movieYear = movie?.year || '';
  const movieGenres = movie?.genres?.join(', ') || '';
  const movieCountries = movie?.countries?.join(', ') || '';
  const donorTags = rawTags.join(', ') || 'none';
  const title = video.original_title || video.title_en || video.raw_title || '';

  let prompt = `Analyze this video scene from our database.

METADATA:
- Title: ${title}
- Celebrity: ${celebNames}`;

  if (movie) {
    prompt += `\n- Movie/Show: ${movieTitle} (${movieYear})`;
    if (movieGenres) prompt += `\n- Genres: ${movieGenres}`;
    if (movieCountries) prompt += `\n- Production countries: ${movieCountries}`;
  }

  prompt += `\n- Donor tags: [${donorTags}]`;

  if (video.duration_seconds) {
    const mins = Math.floor(video.duration_seconds / 60);
    const secs = video.duration_seconds % 60;
    prompt += `\n- Duration: ${mins}:${String(secs).padStart(2, '0')}`;
  }

  prompt += `

INSTRUCTIONS:
1. WATCH the entire video carefully
2. Classify nudity level, scene type, context, and media type
3. Find hot moments timestamps (for screenshots and preview)
4. Write a knowledgeable 2-3 sentence description
5. Compare with donor tags and note disagreements
6. Return ONLY valid JSON, no markdown fences`;

  return prompt;
}

// ============================================================
// Save results
// ============================================================

async function saveResults(videoId, aiResult, model, meta) {
  const workDir = join(WORK_DIR, videoId);

  // Normalize tags through our tag system
  const normalizedTags = normalizeTags(aiResult.all_tags || []);

  const metadata = {
    ...aiResult,
    all_tags: normalizedTags,
    model_used: model,
    analyzed_at: new Date().toISOString(),
    raw_ai_tags: aiResult.all_tags, // before normalization
  };

  // Write metadata.json
  const metadataPath = join(workDir, 'metadata.json');
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  console.log(`  Saved: ${metadataPath}`);

  // Update DB
  if (!dryRun) {
    await query(`
      UPDATE videos SET
        ai_vision_status = 'completed',
        ai_vision_model = $2,
        hot_moments = $3,
        best_thumbnail_sec = $4,
        preview_start_sec = $5,
        donor_tags = $6,
        ai_confidence = $7,
        ai_raw_response = $8,
        ai_tags = $9,
        updated_at = NOW()
      WHERE id = $1
    `, [
      videoId,
      model,
      JSON.stringify(metadata.hot_moments || []),
      metadata.best_thumbnail_sec,
      metadata.preview_start_sec,
      meta.rawTags,
      metadata.confidence,
      JSON.stringify(metadata),
      normalizedTags,
    ]);
    console.log(`  DB updated: ai_vision_status=completed, ai_tags=[${normalizedTags.join(', ')}]`);
  } else {
    console.log('  [DRY RUN] DB not updated');
  }

  return metadata;
}

async function saveCensoredFallback(videoId, meta, errors) {
  const workDir = join(WORK_DIR, videoId);

  // Fallback: map donor tags
  const donorMapped = mapDonorTags(meta.rawTags);
  console.log(`  Fallback: donor tags [${meta.rawTags.join(', ')}] → [${donorMapped.join(', ')}]`);

  const metadata = {
    nudity_level: donorMapped.find(t =>
      ['sexy', 'cleavage', 'bikini', 'lingerie', 'topless', 'butt', 'nude', 'full-frontal'].includes(t)
    ) || null,
    scene_type: null,
    context_tags: [],
    media_type: donorMapped.find(t =>
      ['movie', 'tv-show', 'music-video', 'on-stage', 'photoshoot'].includes(t)
    ) || null,
    bush_visible: donorMapped.includes('bush'),
    all_tags: donorMapped,
    hot_moments: [],
    best_thumbnail_sec: null,
    preview_start_sec: null,
    description_en: null,
    donor_tag_comparison: null,
    confidence: 0.3,
    is_explicit_unsimulated: false,
    body_double_suspected: false,
    model_used: 'fallback-donor-tags',
    fallback_reason: errors.join(' → '),
    analyzed_at: new Date().toISOString(),
  };

  // Write metadata.json
  const metadataPath = join(workDir, 'metadata.json');
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  console.log(`  Saved fallback: ${metadataPath}`);

  // Update DB
  if (!dryRun) {
    const errorMsg = errors.join(' → ');
    await query(`
      UPDATE videos SET
        ai_vision_status = 'censored',
        ai_vision_model = 'fallback-donor-tags',
        ai_vision_error = $3,
        donor_tags = $2,
        pipeline_error = $3,
        updated_at = NOW()
      WHERE id = $1
    `, [videoId, meta.rawTags, errorMsg]);
    console.log(`  DB updated: ai_vision_status=censored, error=${errorMsg.substring(0, 100)}`);
  } else {
    console.log('  [DRY RUN] DB not updated');
  }

  return metadata;
}

// ============================================================
// Helpers
// ============================================================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('═'.repeat(60));
  console.log(`AI Vision Analyze — ${videoId}`);
  console.log('═'.repeat(60));

  // 1. Check video file exists
  const workDir = join(WORK_DIR, videoId);
  const videoPath = join(workDir, 'original.mp4');

  if (!existsSync(videoPath)) {
    console.error(`Video file not found: ${videoPath}`);
    process.exit(1);
  }

  const fileStat = await stat(videoPath);
  const fileSizeMB = (fileStat.size / 1024 / 1024).toFixed(1);
  console.log(`Video: ${videoPath} (${fileSizeMB} MB)`);

  // 2. Fetch metadata from DB
  console.log('\nFetching metadata from DB...');
  const meta = await getVideoMeta(videoId);
  console.log(`  Celebrity: ${meta.celebrities.map(c => c.name).join(', ') || 'none'}`);
  console.log(`  Movie: ${meta.movie?.title || 'none'} (${meta.movie?.year || '?'})`);
  console.log(`  Donor tags: [${meta.rawTags.join(', ')}]`);

  // 3. Read video file (or extract frames for big files)
  const mimeType = 'video/mp4';
  let videoBuffer = null;
  let frameBuffers = null;

  if (fileStat.size > BIG_FILE_THRESHOLD) {
    const sizeMB = (fileStat.size / 1024 / 1024).toFixed(0);
    console.log(`\nFile > 100MB (${sizeMB}MB) — extracting ${BIG_FILE_FRAME_COUNT} frames instead of File API upload...`);
    frameBuffers = await extractFrameBuffers(videoPath, BIG_FILE_FRAME_COUNT);
    if (frameBuffers.length === 0) {
      console.log('  Frame extraction failed, falling back to full video read...');
      videoBuffer = await readFile(videoPath);
    }
  } else {
    console.log('\nReading video file...');
    videoBuffer = await readFile(videoPath);
  }

  // 4. Try models in cascade
  const modelsToTry = forceModel ? [forceModel] : VISION_MODELS;
  const userPrompt = buildUserPrompt(meta);
  const errors = [];

  for (const model of modelsToTry) {
    nextSessionKey(); // Lock one API key for this entire model attempt (upload + generate)
    console.log(`\n─── Model: ${model} ───`);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`  Retry ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY_MS}ms...`);
        await sleep(RETRY_DELAY_MS * attempt);
      }

      try {
        const result = await callGeminiVision(model, userPrompt, videoBuffer, mimeType, frameBuffers);

        if (result.status === 'ok') {
          console.log('  ✅ Response received, parsing...');

          try {
            const parsed = parseGeminiResponse(result.text);
            console.log(`  Nudity: ${parsed.nudity_level}`);
            console.log(`  Scene: ${parsed.scene_type || 'none'}`);
            console.log(`  Media: ${parsed.media_type || 'unknown'}`);
            console.log(`  Tags: [${parsed.all_tags?.join(', ')}]`);
            console.log(`  Hot moments: ${parsed.hot_moments?.length || 0}`);
            console.log(`  Confidence: ${parsed.confidence}`);
            if (parsed.description_en) {
              console.log(`  Description: ${parsed.description_en.substring(0, 120)}...`);
            }

            // Save
            const metadata = await saveResults(videoId, parsed, model, meta);
            console.log('\n✅ AI Vision analysis complete!');
            console.log(`  Tags (normalized): [${metadata.all_tags.join(', ')}]`);
            process.exit(0);
          } catch (parseErr) {
            const msg = `${model}: parse error: ${parseErr.message}`;
            console.log(`  ⚠️ ${msg}`);
            console.log(`  Raw text: ${result.text.substring(0, 200)}`);
            errors.push(msg);
            // Don't retry parse errors on same model — try next model
            break;
          }
        }

        if (result.status === 'censored') {
          const msg = `${model}: CENSORED — ${result.error}`;
          console.log(`  🚫 ${msg}`);
          errors.push(msg);
          // Don't retry censorship — try next model
          break;
        }

        if (result.status === 'empty') {
          const msg = `${model}: empty response — ${result.error}`;
          console.log(`  ⚠️ ${msg}`);
          errors.push(msg);
          // Retry once for empty responses, then move on
          if (attempt >= 1) break;
          continue;
        }

        if (result.status === 'error') {
          const msg = `${model}: API error — ${result.error}`;
          console.log(`  ❌ ${msg}`);
          errors.push(msg);
          // Retry on transient errors
          continue;
        }
      } catch (err) {
        const msg = `${model}: exception — ${err.message}`;
        console.log(`  ❌ ${msg}`);
        errors.push(msg);
        continue;
      }
    }
  }

  // 5. All models failed → fallback to donor tags
  console.log('\n🚫 All models failed. Using donor tag fallback.');
  const metadata = await saveCensoredFallback(videoId, meta, errors);
  console.log(`  Fallback tags: [${metadata.all_tags.join(', ')}]`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
