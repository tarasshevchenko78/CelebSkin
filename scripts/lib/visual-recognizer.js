/**
 * visual-recognizer.js — Визуальное распознавание фильмов и актёров через Gemini Vision
 *
 * 2-этапная стратегия:
 *   Этап 1: 1 кадр → gemini-2.5-flash (быстро, дёшево)
 *   Этап 2: 6 кадров → gemini-2.5-pro (точнее, если Этап 1 неуверен)
 *
 * Верификация через TMDB API
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFile } from 'fs/promises';
import https from 'https';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';

// Rate limiter: max 10 Gemini requests per minute
let _requestTimestamps = [];
const MAX_REQUESTS_PER_MIN = 10;

async function rateLimit() {
  const now = Date.now();
  _requestTimestamps = _requestTimestamps.filter(ts => now - ts < 60000);
  if (_requestTimestamps.length >= MAX_REQUESTS_PER_MIN) {
    const waitMs = 60000 - (now - _requestTimestamps[0]) + 100;
    await new Promise(r => setTimeout(r, waitMs));
  }
  _requestTimestamps.push(Date.now());
}

// ============================================
// TMDB API
// ============================================

function tmdbFetch(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${TMDB_BASE}${path}${sep}api_key=${TMDB_API_KEY}`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`TMDB parse error`)); }
      });
    }).on('error', reject);
  });
}

async function searchMovieTMDB(title, year) {
  if (!title) return null;
  try {
    const yearParam = year ? `&year=${year}` : '';
    const data = await tmdbFetch(`/search/movie?query=${encodeURIComponent(title)}${yearParam}`);
    return data.results?.[0] || null;
  } catch { return null; }
}

async function searchPersonTMDB(name) {
  if (!name) return null;
  try {
    const data = await tmdbFetch(`/search/person?query=${encodeURIComponent(name)}`);
    return data.results?.[0] || null;
  } catch { return null; }
}

async function getMovieDetailsTMDB(movieId) {
  try {
    return await tmdbFetch(`/movie/${movieId}?append_to_response=credits`);
  } catch { return null; }
}

// ============================================
// Gemini Vision Analysis
// ============================================

const VISION_PROMPT = `You are a movie and celebrity expert. Analyze these video frames and try to identify:

1. MOVIE/TV SHOW: What movie, TV show, or media content is this from?
   - Look for: scene style, costumes, set design, visual effects, color grading
   - Look for: any text on screen (titles, credits, watermarks, logos)
   - Look for: recognizable movie scenes or iconic moments

2. ACTORS/ACTRESSES: Who appears in these frames?
   - Describe their appearance in detail
   - If you can identify them, provide their full name
   - Focus on the most prominent person in the frames

3. ADDITIONAL CLUES:
   - Studio logos, production company names
   - Time period / era (based on costumes, technology visible)
   - Genre (action, drama, comedy, horror, etc.)
   - Any text visible in any language

IMPORTANT RULES:
- If you're NOT SURE about identity, say so and provide your best guess with lower confidence
- Provide confidence score 0.0 to 1.0 for each identification
- Multiple guesses are OK — rank them by confidence
- Read and report ANY text visible on screen, even partial

Return ONLY valid JSON (no markdown, no backticks):
{
  "movie_title": "Best guess movie/show title in English" or null,
  "movie_title_alternatives": ["alternative guess 1", "alternative guess 2"],
  "movie_year": 2024 or null,
  "movie_confidence": 0.0-1.0,
  "actors": [
    {
      "name": "Actor Name" or null,
      "description": "Short physical description: gender, approximate age, hair, distinguishing features",
      "confidence": 0.0-1.0
    }
  ],
  "genre": "action/drama/comedy/etc",
  "era": "modern/90s/80s/period",
  "visible_text": ["any text seen on screen"],
  "studio_logo": "studio name if visible" or null,
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of how you identified this"
}`;

/**
 * Отправка кадров в Gemini Vision для анализа
 */
async function analyzeFramesWithGemini(frames, modelName = 'gemini-2.5-flash') {
  await rateLimit();

  const model = genAI.getGenerativeModel({ model: modelName });

  // Подготовить изображения (максимум 6)
  const selectedFrames = frames.slice(0, 6);
  const parts = [{ text: VISION_PROMPT }];

  for (const frame of selectedFrames) {
    const imageData = await readFile(frame.path);
    parts.push({
      inlineData: {
        data: imageData.toString('base64'),
        mimeType: 'image/jpeg',
      },
    });
  }

  try {
    const result = await model.generateContent(parts);
    const text = result.response.text();
    const cleanJson = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (err) {
    console.error(`[VisualRecognizer] Gemini Vision (${modelName}) failed:`, err.message);
    return null;
  }
}

/**
 * Верификация результатов Gemini через TMDB
 */
async function verifyWithTMDB(geminiResult) {
  const result = { found: false, movie: null, actors: [], suggested_cast: null };

  // --- Верификация фильма ---
  if (geminiResult.movie_title) {
    let tmdbMovie = await searchMovieTMDB(geminiResult.movie_title, geminiResult.movie_year);

    // Если не найден — попробовать альтернативные варианты
    if (!tmdbMovie && geminiResult.movie_title_alternatives) {
      for (const alt of geminiResult.movie_title_alternatives) {
        tmdbMovie = await searchMovieTMDB(alt, geminiResult.movie_year);
        if (tmdbMovie) break;
      }
    }

    if (tmdbMovie) {
      result.movie = {
        tmdb_id: tmdbMovie.id,
        title: tmdbMovie.title,
        year: tmdbMovie.release_date?.substring(0, 4),
        poster_path: tmdbMovie.poster_path,
        confidence: geminiResult.movie_confidence,
      };
      result.found = true;
    }
  }

  // --- Верификация актёров ---
  if (geminiResult.actors) {
    for (const actor of geminiResult.actors) {
      if (actor.name && actor.confidence > 0.3) {
        const tmdbPerson = await searchPersonTMDB(actor.name);
        if (tmdbPerson) {
          result.actors.push({
            tmdb_id: tmdbPerson.id,
            name: tmdbPerson.name,
            confidence: actor.confidence,
            description: actor.description,
            profile_path: tmdbPerson.profile_path,
          });
          result.found = true;
        }
      }
    }
  }

  // --- Если нашли фильм, но не актёров — подтянуть каст из TMDB ---
  if (result.movie && result.actors.length === 0) {
    const movieDetails = await getMovieDetailsTMDB(result.movie.tmdb_id);
    if (movieDetails?.credits?.cast) {
      result.suggested_cast = movieDetails.credits.cast.slice(0, 5).map(c => ({
        tmdb_id: c.id,
        name: c.name,
        character: c.character,
        profile_path: c.profile_path,
        gender: c.gender,
      }));
    }
  }

  return result;
}

/**
 * Обратный матчинг: если Gemini описал актёра но не назвал имя,
 * попробовать найти через описание + каст фильма из TMDB
 */
async function matchActorByDescription(description, movieTmdbId) {
  if (!movieTmdbId || !description) return null;

  const movieDetails = await getMovieDetailsTMDB(movieTmdbId);
  const cast = movieDetails?.credits?.cast;
  if (!cast || cast.length === 0) return null;

  await rateLimit();

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const castInfo = cast.slice(0, 10).map(c => ({
    name: c.name,
    character: c.character,
    gender: c.gender,
  }));

  const prompt = `A person in a video frame is described as: "${description}"
This video appears to be from the movie with TMDB ID ${movieTmdbId}.
The cast of this movie includes:
${JSON.stringify(castInfo, null, 2)}

Based on the description, which cast member is most likely this person?
Return JSON only:
{
  "best_match": "Actor Name" or null,
  "confidence": 0.0-1.0,
  "reasoning": "why"
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

/**
 * Главная функция: 2-этапное визуальное распознавание
 *
 * @param {string} videoPath - путь к видео файлу
 * @param {string} videoId - ID видео
 * @param {Function} extractBestFrame - функция для извлечения 1 кадра
 * @param {Function} extractKeyFrames - функция для извлечения N кадров
 * @returns {Object} результат распознавания
 */
export async function smartRecognize(videoPath, videoId, extractBestFrame, extractKeyFrames) {
  console.log(`[VisualRecognizer] Starting smart recognition for video ${videoId}`);

  // --- ЭТАП 1: 1 кадр → Flash (быстро, дёшево) ---
  let bestFramePath;
  try {
    bestFramePath = await extractBestFrame(videoPath, videoId);
  } catch (err) {
    console.error(`[VisualRecognizer] Frame extraction failed:`, err.message);
    return { success: false, reason: 'frame_extraction_failed' };
  }

  const quickResult = await analyzeFramesWithGemini(
    [{ path: bestFramePath }],
    'gemini-2.5-flash'
  );

  if (!quickResult) {
    return { success: false, reason: 'gemini_failed' };
  }

  console.log(`[VisualRecognizer] Quick analysis: movie="${quickResult.movie_title}", confidence=${quickResult.confidence}`);

  // Высокая уверенность → готово
  if (quickResult.confidence >= 0.8) {
    const verified = await verifyWithTMDB(quickResult);
    return buildResult(quickResult, verified, 'flash_single');
  }

  // Низкая уверенность → не стоит тратить токены
  if (quickResult.confidence < 0.3) {
    const verified = await verifyWithTMDB(quickResult);
    return buildResult(quickResult, verified, 'flash_single');
  }

  // --- ЭТАП 2: 6 кадров → Pro (точнее) ---
  console.log(`[VisualRecognizer] Confidence ${quickResult.confidence} — escalating to deep analysis`);

  let allFrames;
  try {
    allFrames = await extractKeyFrames(videoPath, videoId);
  } catch (err) {
    console.error(`[VisualRecognizer] Key frames extraction failed:`, err.message);
    // Fallback to quick result
    const verified = await verifyWithTMDB(quickResult);
    return buildResult(quickResult, verified, 'flash_single');
  }

  const deepResult = await analyzeFramesWithGemini(
    allFrames,
    'gemini-2.5-pro'
  );

  if (!deepResult) {
    // Fallback to quick result
    const verified = await verifyWithTMDB(quickResult);
    return buildResult(quickResult, verified, 'flash_single');
  }

  console.log(`[VisualRecognizer] Deep analysis: movie="${deepResult.movie_title}", confidence=${deepResult.confidence}`);

  const verified = await verifyWithTMDB(deepResult);

  // Попробовать обратный матчинг актёров если фильм найден но актёры нет
  if (verified.movie && verified.actors.length === 0 && deepResult.actors) {
    for (const actor of deepResult.actors) {
      if (!actor.name && actor.description) {
        const match = await matchActorByDescription(actor.description, verified.movie.tmdb_id);
        if (match?.best_match && match.confidence > 0.5) {
          const tmdbPerson = await searchPersonTMDB(match.best_match);
          if (tmdbPerson) {
            verified.actors.push({
              tmdb_id: tmdbPerson.id,
              name: tmdbPerson.name,
              confidence: match.confidence,
              description: actor.description,
              profile_path: tmdbPerson.profile_path,
              matched_by: 'description',
            });
            verified.found = true;
          }
        }
      }
    }
  }

  return buildResult(deepResult, verified, 'pro_multi');
}

/**
 * Простой анализ N кадров (без 2-этапной стратегии)
 */
export async function recognizeFromFrames(frames, videoId) {
  console.log(`[VisualRecognizer] Analyzing ${frames.length} frames for video ${videoId}`);

  const geminiResult = await analyzeFramesWithGemini(frames);
  if (!geminiResult) {
    return { success: false, reason: 'gemini_failed' };
  }

  const verified = await verifyWithTMDB(geminiResult);
  return buildResult(geminiResult, verified, 'direct');
}

/**
 * Собрать финальный результат
 */
function buildResult(geminiResult, verified, method) {
  return {
    success: verified.found,
    confidence: geminiResult.confidence || 0,
    movie: verified.movie || null,
    actors: verified.actors || [],
    suggested_cast: verified.suggested_cast || null,
    gemini_raw: geminiResult,
    needs_review: geminiResult.confidence < 0.8,
    recognition_method: method,
    visible_text: geminiResult.visible_text || [],
    genre: geminiResult.genre || null,
    era: geminiResult.era || null,
    studio_logo: geminiResult.studio_logo || null,
  };
}

export {
  analyzeFramesWithGemini,
  verifyWithTMDB,
  matchActorByDescription,
};
