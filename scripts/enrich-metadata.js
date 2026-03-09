#!/usr/bin/env node
/**
 * enrich-metadata.js — TMDB Enrichment for CelebSkin
 *
 * IMPORTANT: This script enriches ONLY the specific movie from each video's
 * AI response — NOT the full filmography of celebrities.
 *
 * Logic:
 * 1. For each video with AI data (ai_raw_response):
 *    a. Extract movie_title from AI response
 *    b. Search TMDB for that specific movie
 *    c. Create/update movie record with poster, description, year
 *    d. Link video → movie via movie_scenes
 *    e. Link movie → celebrity via movie_celebrities (only for celebrities in THIS video)
 * 2. For each celebrity without TMDB data:
 *    a. Search TMDB for celebrity by name
 *    b. Fetch photo, bio, birth_date, nationality
 *    c. DO NOT fetch filmography — we only care about movies linked to our videos
 *
 * Usage: node enrich-metadata.js [--limit=N] [--force]
 *
 * Deploy: copy to /opt/celebskin/scripts/ on Contabo
 */

import pg from 'pg';
const { Pool } = pg;
import https from 'https';
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { writeProgress, clearProgress } from "./lib/progress.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

// ============================================
// Config
// ============================================
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p';

const pool = new Pool({
    host: process.env.DB_HOST || "185.224.82.214",
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME || "celebskin",
    user: process.env.DB_USER || "celebskin",
    password: process.env.DB_PASSWORD || "",
});

// Processing log helper (uses local pool, not shared lib/db.js)
async function dbLog(videoId, step, status, message = null, metadata = null) {
    await pool.query(
        `INSERT INTO processing_log (video_id, step, status, message, metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [videoId, step, status, message, metadata ? JSON.stringify(metadata) : null]
    );
}

// Parse CLI args
const args = process.argv.slice(2);
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '50');
const FORCE = args.includes('--force');

// ============================================
// TMDB API helper
// ============================================
function tmdbFetch(path) {
    const url = `${TMDB_BASE}${path}`;
    const parsedUrl = new URL(url);
    const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
            'Authorization': `Bearer ${TMDB_API_KEY}`,
            'Accept': 'application/json',
        },
    };

    return new Promise((resolve, reject) => {
        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`TMDB parse error: ${data.slice(0, 200)}`));
                }
            });
        }).on('error', reject);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 200);
}

// ============================================
// Movie enrichment — search TMDB for specific movie title
// ============================================
export async function findOrCreateMovie(movieTitle, year) {
    if (!movieTitle || movieTitle.trim().length < 2) return null;

    const cleanTitle = movieTitle.trim();

    // Check if movie already exists in DB (fuzzy match)
    const existing = await pool.query(
        `SELECT * FROM movies WHERE
            LOWER(title) = LOWER($1)
            OR similarity(title, $1) > 0.6
         ORDER BY similarity(title, $1) DESC
         LIMIT 1`,
        [cleanTitle]
    );

    if (existing.rows.length > 0 && !FORCE) {
        console.log(`  Movie already exists: "${existing.rows[0].title}" (id=${existing.rows[0].id})`);
        return existing.rows[0];
    }

    // Multi-strategy TMDB search to maximize match rate
    const tmdbResult = await searchTmdbMovie(cleanTitle, year);
    if (tmdbResult) {
        return await enrichMovieFromTmdb(tmdbResult.result, tmdbResult.type, existing.rows[0] || null);
    }

    console.log(`  TMDB: no results for "${cleanTitle}" after all strategies`);
    return null;
}

/**
 * Search TMDB with multiple fallback strategies:
 * 1. Movie search with year
 * 2. Movie search without year
 * 3. Movie search with year ±1 (release year can differ from production year)
 * 4. Movie search without diacritics (Feketerigó → Feketerigo)
 * 5. TV show search
 * Returns { result, type } or null
 */
async function searchTmdbMovie(title, year) {
    const query = encodeURIComponent(title);

    // Strategy 1: exact search with year
    if (year) {
        const r = await tmdbFetch(`/search/movie?query=${query}&year=${year}&language=en-US`);
        if (r.results?.length > 0) return { result: r.results[0], type: 'movie' };
    }

    // Strategy 2: search without year
    const r2 = await tmdbFetch(`/search/movie?query=${query}&language=en-US`);
    if (r2.results?.length > 0) return { result: r2.results[0], type: 'movie' };

    // Strategy 3: search with year ±1 (production vs release year)
    if (year) {
        for (const offset of [1, -1]) {
            const r = await tmdbFetch(`/search/movie?query=${query}&year=${parseInt(year) + offset}&language=en-US`);
            if (r.results?.length > 0) {
                console.log(`  TMDB: found "${title}" with year ${parseInt(year) + offset} (original: ${year})`);
                return { result: r.results[0], type: 'movie' };
            }
        }
    }

    // Strategy 4: strip diacritics and retry (Feketerigó → Feketerigo, Château → Chateau)
    const stripped = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (stripped !== title) {
        console.log(`  TMDB: retrying without diacritics: "${stripped}"`);
        const queryStripped = encodeURIComponent(stripped);
        const r = await tmdbFetch(`/search/movie?query=${queryStripped}&language=en-US`);
        if (r.results?.length > 0) return { result: r.results[0], type: 'movie' };
    }

    // Strategy 5: TV show search
    const tvR = await tmdbFetch(`/search/tv?query=${query}&language=en-US`);
    if (tvR.results?.length > 0) return { result: tvR.results[0], type: 'tv' };

    return null;
}

async function enrichMovieFromTmdb(tmdbResult, type, existingMovie) {
    const tmdbId = tmdbResult.id;
    const title = tmdbResult.title || tmdbResult.name || '';
    const year = (tmdbResult.release_date || tmdbResult.first_air_date || '').slice(0, 4) || null;
    const posterPath = tmdbResult.poster_path;
    const posterUrl = posterPath ? `${TMDB_IMG_BASE}/w500${posterPath}` : null;
    const overview = tmdbResult.overview || '';

    // Fetch detailed info for genres, director, studio
    let director = null;
    let studio = null;
    let genres = [];

    try {
        const details = await tmdbFetch(`/${type}/${tmdbId}?append_to_response=credits&language=en-US`);
        genres = (details.genres || []).map(g => g.name);
        studio = (details.production_companies || [])[0]?.name || null;

        if (type === 'movie' && details.credits?.crew) {
            const dir = details.credits.crew.find(c => c.job === 'Director');
            director = dir?.name || null;
        }
    } catch (err) {
        console.log(`  TMDB details fetch failed: ${err.message}`);
    }

    // Build localized description
    const description = { en: overview };
    // Fetch descriptions in other languages
    const locales = ['ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];
    for (const locale of locales) {
        try {
            await sleep(100); // Rate limiting
            const localized = await tmdbFetch(`/${type}/${tmdbId}?language=${locale}`);
            if (localized.overview) {
                description[locale] = localized.overview;
            }
        } catch {
            // Skip failed locale
        }
    }

    // Build localized title
    const titleLocalized = { en: title };
    // Title translations usually come from alternative_titles endpoint but overview fetch already gives us the localized title
    // For simplicity, keep English title for all locales (TMDB title translations are unreliable)

    const slug = slugify(title + (year ? `-${year}` : ''));

    if (existingMovie) {
        // Update existing
        await pool.query(
            `UPDATE movies SET
                tmdb_id = COALESCE($1, tmdb_id),
                poster_url = COALESCE($2, poster_url),
                description = COALESCE($3::jsonb, description),
                year = COALESCE($4, year),
                director = COALESCE($5, director),
                studio = COALESCE($6, studio),
                genres = COALESCE($7, genres),
                title_localized = COALESCE($8::jsonb, title_localized),
                updated_at = NOW()
             WHERE id = $9`,
            [tmdbId, posterUrl, JSON.stringify(description), year ? parseInt(year) : null,
             director, studio, genres, JSON.stringify(titleLocalized), existingMovie.id]
        );
        console.log(`  Updated movie: "${title}" (id=${existingMovie.id})`);
        return { ...existingMovie, tmdb_id: tmdbId };
    } else {
        // Create new movie
        const result = await pool.query(
            `INSERT INTO movies (title, title_localized, slug, year, poster_url, description, studio, director, genres, tmdb_id, ai_matched)
             VALUES ($1, $2::jsonb, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, true)
             ON CONFLICT (slug) DO UPDATE SET
                tmdb_id = COALESCE(EXCLUDED.tmdb_id, movies.tmdb_id),
                poster_url = COALESCE(EXCLUDED.poster_url, movies.poster_url),
                description = COALESCE(EXCLUDED.description, movies.description),
                year = COALESCE(EXCLUDED.year, movies.year),
                director = COALESCE(EXCLUDED.director, movies.director),
                studio = COALESCE(EXCLUDED.studio, movies.studio),
                genres = COALESCE(EXCLUDED.genres, movies.genres)
             RETURNING *`,
            [title, JSON.stringify(titleLocalized), slug, year ? parseInt(year) : null,
             posterUrl, JSON.stringify(description), studio, director, genres, tmdbId]
        );
        console.log(`  Created movie: "${title}" (id=${result.rows[0].id})`);
        return result.rows[0];
    }
}

// ============================================
// Celebrity enrichment — TMDB profile only, NO filmography
// ============================================
export async function enrichCelebrity(celebrity) {
    if (celebrity.tmdb_id && !FORCE) {
        console.log(`  Celebrity already enriched: "${celebrity.name}" (tmdb_id=${celebrity.tmdb_id})`);
        return;
    }

    // Search TMDB for person
    const searchQuery = encodeURIComponent(celebrity.name);
    const searchResult = await tmdbFetch(`/search/person?query=${searchQuery}&language=en-US`);

    if (!searchResult.results || searchResult.results.length === 0) {
        console.log(`  TMDB: no person results for "${celebrity.name}"`);
        await dbLog(null, 'tmdb-enrich-celebrity', 'not_found', `TMDB: no results for "${celebrity.name}"`, {
            celebrity_id: celebrity.id, name: celebrity.name,
        });
        return;
    }

    const person = searchResult.results[0];
    const tmdbId = person.id;

    // Fetch full person details
    let details;
    try {
        details = await tmdbFetch(`/person/${tmdbId}?language=en-US`);
    } catch (err) {
        console.log(`  TMDB person details failed: ${err.message}`);
        return;
    }

    const photoPath = details.profile_path;
    const photoUrl = photoPath ? `${TMDB_IMG_BASE}/w500${photoPath}` : null;
    const bio = { en: details.biography || '' };

    // Fetch localized bios
    const locales = ['ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];
    for (const locale of locales) {
        try {
            await sleep(100);
            const localized = await tmdbFetch(`/person/${tmdbId}?language=${locale}`);
            if (localized.biography) {
                bio[locale] = localized.biography;
            }
        } catch {
            // Skip
        }
    }

    const birthDate = details.birthday || null;
    const nationality = details.place_of_birth || null;
    const imdbId = details.imdb_id || null;
    const aliases = details.also_known_as || [];

    await pool.query(
        `UPDATE celebrities SET
            tmdb_id = $1,
            photo_url = COALESCE($2, photo_url),
            bio = COALESCE($3::jsonb, bio),
            birth_date = COALESCE($4, birth_date),
            nationality = COALESCE($5, nationality),
            imdb_id = COALESCE($6, imdb_id),
            aliases = COALESCE($7, aliases),
            external_ids = jsonb_set(COALESCE(external_ids, '{}'::jsonb), '{tmdb_id}', $8::jsonb),
            updated_at = NOW()
         WHERE id = $9`,
        [tmdbId, photoUrl, JSON.stringify(bio), birthDate, nationality, imdbId,
         aliases.length > 0 ? aliases : null,
         JSON.stringify(tmdbId), celebrity.id]
    );

    console.log(`  Enriched celebrity: "${celebrity.name}" (tmdb_id=${tmdbId})`);
    await dbLog(null, 'tmdb-enrich-celebrity', 'completed', `Enriched: "${celebrity.name}"`, {
        celebrity_id: celebrity.id, name: celebrity.name, tmdb_id: tmdbId,
        has_photo: !!photoUrl, has_bio: !!bio.en, birth_date: birthDate,
    });

    // NOTE: We do NOT fetch filmography here.
    // Movies are only linked when they appear in video titles processed by AI.
}

// ============================================
// Main: process videos and link specific movies
// ============================================
async function main() {
    if (!TMDB_API_KEY) {
        console.error('ERROR: TMDB_API_KEY environment variable is required');
        process.exit(1);
    }

    const startedAt = Date.now();
    console.log(`\n=== CelebSkin TMDB Enrichment ===`);
    console.log(`Mode: Single-movie per video (no full filmography)`);
    console.log(`Limit: ${LIMIT}, Force: ${FORCE}\n`);

    // Step 1: Enrich videos that have AI data with movie info
    console.log('--- Step 1: Link movies from AI responses ---');

    const videosResult = await pool.query(`
        SELECT v.id, v.ai_raw_response, v.original_title
        FROM videos v
        WHERE v.ai_raw_response IS NOT NULL
          AND v.status NOT IN ('rejected', 'dmca_removed')
          ${FORCE ? '' : `AND NOT EXISTS (SELECT 1 FROM movie_scenes ms WHERE ms.video_id = v.id)`}
        ORDER BY v.created_at DESC
        LIMIT $1
    `, [LIMIT]);

    console.log(`Found ${videosResult.rows.length} videos to process\n`);

    let moviesLinked = 0;
    let moviesCreated = 0;
    let celebsEnriched = 0;
    let _done = 0;
    const _completed = [];
    const _errors = [];

    for (const video of videosResult.rows) {
        _done++;
        const _start = Date.now();
        writeProgress({
            step: 'tmdb-enrich', stepLabel: 'TMDB Enrichment',
            videosTotal: videosResult.rows.length, videosDone: _done,
            currentVideo: { id: video.id, title: video.original_title, subStep: 'Processing' },
            completedVideos: _completed.slice(-10),
            errors: _errors.slice(-10),
            elapsedMs: Date.now() - startedAt,
        });
        const aiData = video.ai_raw_response;
        // AI response may have movie_title, movie_name, or movie field
        const movieTitle = aiData?.movie_title || aiData?.movie_name || aiData?.movie || null;

        if (!movieTitle) {
            console.log(`[${video.id.slice(0, 8)}] No movie title in AI response, skipping`);
            await dbLog(video.id, 'tmdb-enrich', 'skipped', 'No movie title in AI response');
            continue;
        }

        const movieYear = aiData?.movie_year || aiData?.year || null;
        console.log(`[${video.id.slice(0, 8)}] Processing movie: "${movieTitle}" (${movieYear || '?'})`);

        try {
            const movie = await findOrCreateMovie(movieTitle, movieYear);

            if (movie) {
                // Link video → movie via movie_scenes
                await pool.query(
                    `INSERT INTO movie_scenes (movie_id, video_id, scene_number)
                     VALUES ($1, $2, 1)
                     ON CONFLICT (movie_id, video_id) DO NOTHING`,
                    [movie.id, video.id]
                );
                moviesLinked++;
                _completed.push({ id: video.id, title: video.original_title, status: 'ok', ms: Date.now() - _start });
                await dbLog(video.id, 'tmdb-enrich', 'completed', `Movie linked: "${movie.title || movieTitle}"`, {
                    movie_id: movie.id, tmdb_id: movie.tmdb_id, poster: !!movie.poster_url,
                });

                // Update scenes_count
                await pool.query(
                    `UPDATE movies SET scenes_count = (
                        SELECT COUNT(*) FROM movie_scenes WHERE movie_id = $1
                    ) WHERE id = $1`,
                    [movie.id]
                );

                // Link celebrities from this video to the movie
                const celebs = await pool.query(
                    `SELECT c.id, c.name FROM celebrities c
                     JOIN video_celebrities vc ON vc.celebrity_id = c.id
                     WHERE vc.video_id = $1`,
                    [video.id]
                );

                for (const celeb of celebs.rows) {
                    await pool.query(
                        `INSERT INTO movie_celebrities (movie_id, celebrity_id)
                         VALUES ($1, $2)
                         ON CONFLICT (movie_id, celebrity_id) DO NOTHING`,
                        [movie.id, celeb.id]
                    );
                }
            }

            if (!movie) {
                await dbLog(video.id, 'tmdb-enrich', 'warning', `Movie not found on TMDB: "${movieTitle}"`, { movieTitle, year: movieYear });
            }

            await sleep(300); // TMDB rate limit: ~40 req/10s
        } catch (err) {
            console.error(`  ERROR processing movie "${movieTitle}": ${err.message}`);
            _errors.push({ id: video.id, title: video.original_title, error: err.message });
            await dbLog(video.id, 'tmdb-enrich', 'error', `Movie enrichment failed: ${err.message}`, { movieTitle, year: movieYear });
        }
    }

    // Step 2: Enrich celebrities without TMDB data
    console.log('\n--- Step 2: Enrich celebrities (profile only, no filmography) ---');

    // NOTE: Don't filter by videos_count > 0 — in conveyor mode,
    // counts aren't updated until publish step, so new celebrities would be skipped
    const celebsResult = await pool.query(`
        SELECT * FROM celebrities
        WHERE ${FORCE ? 'TRUE' : 'tmdb_id IS NULL'}
        ORDER BY created_at DESC
        LIMIT $1
    `, [LIMIT]);

    console.log(`Found ${celebsResult.rows.length} celebrities to enrich\n`);

    for (const celeb of celebsResult.rows) {
        try {
            await enrichCelebrity(celeb);
            celebsEnriched++;
            await sleep(300);
        } catch (err) {
            console.error(`  ERROR enriching "${celeb.name}": ${err.message}`);
            await dbLog(null, 'tmdb-enrich-celebrity', 'error', `Celebrity enrichment failed: "${celeb.name}": ${err.message}`, {
                celebrity_id: celeb.id, name: celeb.name,
            });
        }
    }

    // Step 3: Re-enrich movies with tmdb_id but missing poster
    console.log('\n--- Step 3: Re-enrich movies with tmdb_id but no poster ---');
    let moviesReEnriched = 0;
    const moviesNoPoster = await pool.query(`
        SELECT * FROM movies
        WHERE tmdb_id IS NOT NULL AND (poster_url IS NULL OR poster_url = '')
        LIMIT 50
    `);
    console.log(`Found ${moviesNoPoster.rows.length} movies with tmdb_id but no poster`);
    for (const movie of moviesNoPoster.rows) {
        try {
            const details = await tmdbFetch(`/movie/${movie.tmdb_id}?language=en-US`);
            if (details.poster_path) {
                const posterUrl = `${TMDB_IMG_BASE}/w500${details.poster_path}`;
                await pool.query(`UPDATE movies SET poster_url = $2, updated_at = NOW() WHERE id = $1 AND (poster_url IS NULL OR poster_url = '')`, [movie.id, posterUrl]);
                console.log(`  Updated poster for "${movie.title}": ${posterUrl}`);
                moviesReEnriched++;
            } else {
                console.log(`  "${movie.title}" (tmdb=${movie.tmdb_id}) — still no poster on TMDB`);
            }
            await sleep(300);
        } catch (err) {
            console.error(`  ERROR re-enriching movie "${movie.title}": ${err.message}`);
        }
    }

    // Step 4: Re-check celebrities with tmdb_id but no photo
    console.log('\n--- Step 4: Re-check celebrities with tmdb_id but no photo ---');
    let celebsReEnriched = 0;
    const celebsNoPhoto = await pool.query(`
        SELECT * FROM celebrities
        WHERE tmdb_id IS NOT NULL AND (photo_url IS NULL OR photo_url = '')
        LIMIT 50
    `);
    console.log(`Found ${celebsNoPhoto.rows.length} celebrities with tmdb_id but no photo`);
    for (const celeb of celebsNoPhoto.rows) {
        try {
            const details = await tmdbFetch(`/person/${celeb.tmdb_id}?language=en-US`);
            if (details.profile_path) {
                const photoUrl = `${TMDB_IMG_BASE}/w500${details.profile_path}`;
                await pool.query(`UPDATE celebrities SET photo_url = $2, updated_at = NOW() WHERE id = $1 AND (photo_url IS NULL OR photo_url = '')`, [celeb.id, photoUrl]);
                console.log(`  Updated photo for "${celeb.name}": ${photoUrl}`);
                celebsReEnriched++;
            } else {
                console.log(`  "${celeb.name}" (tmdb=${celeb.tmdb_id}) — still no photo on TMDB`);
            }
            await sleep(300);
        } catch (err) {
            console.error(`  ERROR re-checking celebrity "${celeb.name}": ${err.message}`);
        }
    }

    // Summary
    clearProgress();
    console.log('\n=== Enrichment Complete ===');
    console.log(`Movies linked: ${moviesLinked}`);
    console.log(`Celebrities enriched: ${celebsEnriched}`);
    console.log(`Movies posters re-enriched: ${moviesReEnriched}`);
    console.log(`Celebrity photos re-enriched: ${celebsReEnriched}`);

    // Log to processing_log
    await pool.query(
        `INSERT INTO processing_log (step, status, metadata) VALUES ($1, $2, $3::jsonb)`,
        [
            'tmdb-enrich',
            'completed',
            JSON.stringify({
                moviesLinked,
                moviesCreated,
                celebsEnriched,
                videosProcessed: videosResult.rows.length,
                celebsProcessed: celebsResult.rows.length,
                completedAt: new Date().toISOString(),
            }),
        ]
    );

    await pool.end();
    console.log('Done.\n');
}

const _isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (_isMain) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}
