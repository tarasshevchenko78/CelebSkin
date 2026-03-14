#!/usr/bin/env node
/**
 * remove-watermark.js — Blur source watermarks from videos
 *
 * SearchCelebrityHD (and similar sites) place text watermarks that move
 * between corners. Instead of trying to detect which corner on each frame,
 * we blur ALL 4 corners with a consistent blur region.
 *
 * Strategy:
 *   1. Extract a frame, send to Gemini Vision to detect watermark position & size
 *   2. Apply gaussian blur to all 4 corners via FFmpeg (covers any position)
 *   3. Then overlay our own celeb.skin watermark on top
 *
 * The blur region is adaptive: AI tells us the approximate watermark size,
 * and we use that to set blur box dimensions.
 *
 * Usage:
 *   node remove-watermark.js --input=video.mp4 --output=clean.mp4
 *   node remove-watermark.js --input=video.mp4 --output=clean.mp4 --detect  # AI detection
 *   node remove-watermark.js --input=video.mp4 --output=clean.mp4 --width=250 --height=40
 */

import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, stat } from 'fs/promises';
import { config } from '../lib/config.js';
import logger from '../lib/logger.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const GEMINI_API_KEY = config.ai.geminiApiKey;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Default blur region: covers typical text watermarks like "SearchCelebrityHD.com"
const DEFAULT_BLUR = {
  width: 300,   // px width of blur zone in each corner
  height: 45,   // px height of blur zone
  margin: 5,    // px from edge
  strength: 20, // blur strength (higher = more blur)
};

// ============================================
// Detect watermark via AI (optional)
// ============================================

async function extractFrame(videoPath, timeSec = 5) {
  const framePath = videoPath.replace(/\.[^.]+$/, '_detect_frame.jpg');
  await execFileAsync('ffmpeg', [
    '-y', '-ss', String(timeSec),
    '-i', videoPath,
    '-vframes', '1', '-q:v', '2',
    framePath,
  ], { timeout: 30000 });
  return framePath;
}

export async function detectWatermark(videoPath) {
  // Extract a frame from the video
  const framePath = await extractFrame(videoPath, 5);
  const frameData = await readFile(framePath);
  const base64 = frameData.toString('base64');

  // Get video dimensions
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    videoPath,
  ]);
  const [videoWidth, videoHeight] = stdout.trim().split(',').map(Number);

  // Ask Gemini to detect watermark
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64,
            },
          },
          {
            text: `Look at this video frame (${videoWidth}x${videoHeight} pixels).
Is there a text watermark from a website? If yes, describe:
1. What text does it say?
2. Which corner is it in? (top-left, top-right, bottom-left, bottom-right)
3. Approximate dimensions in pixels (width x height of the text area)
4. How far from the edges (margin in pixels)

Return JSON only:
{
  "has_watermark": true/false,
  "text": "SearchCelebrityHD.com",
  "corner": "top-right",
  "width_px": 280,
  "height_px": 35,
  "margin_px": 10
}

If no watermark found, return {"has_watermark": false}. JSON ONLY.`,
          },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      ],
    }),
  });

  if (!response.ok) {
    logger.warn(`Watermark detection failed: ${response.status}`);
    return null;
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  try {
    const result = JSON.parse(text);
    if (result.has_watermark) {
      logger.info(`  Detected watermark: "${result.text}" in ${result.corner} (${result.width_px}x${result.height_px}px)`);
    } else {
      logger.info('  No watermark detected');
    }
    return result;
  } catch {
    return null;
  }
}

// ============================================
// Build FFmpeg filter to blur all 4 corners
// ============================================

export function buildCornerBlurFilter(videoWidth, videoHeight, opts = {}) {
  const w = opts.width || DEFAULT_BLUR.width;
  const h = opts.height || DEFAULT_BLUR.height;
  const m = opts.margin || DEFAULT_BLUR.margin;
  const blur = opts.strength || DEFAULT_BLUR.strength;

  // Scale blur region proportionally to video resolution
  // Reference: 1280px wide → default sizes. Scale for other resolutions.
  const scale = videoWidth / 1280;
  const bw = Math.round(w * scale);
  const bh = Math.round(h * scale);
  const bm = Math.round(m * scale);
  const bs = Math.max(10, Math.round(blur * scale));

  // FFmpeg complex filter: crop each corner → blur → overlay back
  // 4 corners: TL, TR, BL, BR
  const corners = [
    { name: 'tl', x: bm, y: bm },                                           // top-left
    { name: 'tr', x: videoWidth - bw - bm, y: bm },                         // top-right
    { name: 'bl', x: bm, y: videoHeight - bh - bm },                        // bottom-left
    { name: 'br', x: videoWidth - bw - bm, y: videoHeight - bh - bm },      // bottom-right
  ];

  // Build filter chain:
  // [0:v] → crop corner → boxblur → overlay back (repeat for each corner)
  const filters = [];
  let prevLabel = '0:v';

  for (const corner of corners) {
    const cropLabel = `${corner.name}_crop`;
    const blurLabel = `${corner.name}_blur`;
    const outLabel = `${corner.name}_out`;

    // Crop the corner region
    filters.push(`[${prevLabel}]crop=${bw}:${bh}:${corner.x}:${corner.y}[${cropLabel}]`);
    // Apply blur to cropped region
    filters.push(`[${cropLabel}]boxblur=${bs}:${bs}[${blurLabel}]`);
    // Overlay blurred region back
    filters.push(`[${prevLabel}][${blurLabel}]overlay=${corner.x}:${corner.y}[${outLabel}]`);

    prevLabel = outLabel;
  }

  return { filter: filters.join(';'), outputLabel: prevLabel };
}

// ============================================
// Apply corner blur to video
// ============================================

export async function blurCorners(inputPath, outputPath, opts = {}) {
  // Get video dimensions
  const { stdout: probeOut } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    inputPath,
  ]);
  const [videoWidth, videoHeight] = probeOut.trim().split(',').map(Number);
  logger.info(`  Video: ${videoWidth}x${videoHeight}`);

  // Detect watermark if requested
  let blurOpts = { ...DEFAULT_BLUR, ...opts };
  if (opts.detect) {
    const detection = await detectWatermark(inputPath);
    if (detection?.has_watermark) {
      blurOpts.width = Math.max(detection.width_px + 40, DEFAULT_BLUR.width); // add padding
      blurOpts.height = Math.max(detection.height_px + 20, DEFAULT_BLUR.height);
      blurOpts.margin = detection.margin_px || DEFAULT_BLUR.margin;
    }
  }

  const { filter, outputLabel } = buildCornerBlurFilter(videoWidth, videoHeight, blurOpts);

  logger.info(`  Blurring corners: ${blurOpts.width}x${blurOpts.height}px, strength=${blurOpts.strength}`);

  // FFmpeg: apply blur filter + copy audio
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-filter_complex', filter,
    '-map', `[${outputLabel}]`,
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    outputPath,
  ], {
    timeout: 600000, // 10 min
  });

  const inputStat = await stat(inputPath);
  const outputStat = await stat(outputPath);
  logger.info(`  ✓ Corners blurred (${(inputStat.size / 1024 / 1024).toFixed(1)}MB → ${(outputStat.size / 1024 / 1024).toFixed(1)}MB)`);

  return { videoWidth, videoHeight, blurOpts };
}

// ============================================
// CLI
// ============================================

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const input = args.find(a => a.startsWith('--input='))?.split('=').slice(1).join('=');
  const output = args.find(a => a.startsWith('--output='))?.split('=').slice(1).join('=');
  const detect = args.includes('--detect');
  const width = parseInt(args.find(a => a.startsWith('--width='))?.split('=')[1] || '0') || undefined;
  const height = parseInt(args.find(a => a.startsWith('--height='))?.split('=')[1] || '0') || undefined;

  if (!input || !output) {
    console.error('Usage: node remove-watermark.js --input=video.mp4 --output=clean.mp4 [--detect] [--width=300] [--height=45]');
    process.exit(1);
  }

  await blurCorners(input, output, { detect, width, height });
  logger.info('Done!');
}
