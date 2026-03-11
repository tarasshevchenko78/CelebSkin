#!/usr/bin/env node
/**
 * auto-import.js — Automatic xcadr pipeline orchestrator
 *
 * Runs the full xcadr import pipeline in sequence:
 *   parse → translate → match → map-tags → auto-import → auto-download
 *
 * Usage:
 *   node xcadr/auto-import.js
 *   node xcadr/auto-import.js --parse-pages 5 --translate-limit 100 --match-limit 100
 *   node xcadr/auto-import.js --skip-parse
 *   node xcadr/auto-import.js --auto-import             (auto-import matched known celebrities)
 *   node xcadr/auto-import.js --auto-download           (also download + process imported videos)
 *   node xcadr/auto-import.js --download-limit 10       (how many videos to download, default 5)
 *   node xcadr/auto-import.js --dry-run                 (show what would happen, no DB changes)
 *
 * Cron setup (add on CONTABO: ssh root@161.97.142.117, then crontab -e):
 *   # Daily at 4:00 AM — full pipeline (parse + translate + match + import + download)
 *   0 4 * * * cd /opt/celebskin/scripts && node xcadr/auto-import.js --parse-pages 5 --auto-import --auto-download --download-limit 5 >> /opt/celebskin/scripts/logs/xcadr-auto.log 2>&1
 */

import { spawn } from 'child_process';
import slugify from 'slugify';
import { query, pool } from '../lib/db.js';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name) {
    const idx = args.indexOf(name);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    const eq = args.find((a) => a.startsWith(name + '='));
    return eq ? eq.split('=').slice(1).join('=') : null;
}

function hasFlag(name) {
    return args.includes(name);
}

const PARSE_PAGES     = parseInt(getArg('--parse-pages')     || '3');
const TRANSLATE_LIMIT = parseInt(getArg('--translate-limit') || '100');
const MATCH_LIMIT     = parseInt(getArg('--match-limit')     || '100');
const SKIP_PARSE      = hasFlag('--skip-parse');
const AUTO_IMPORT     = hasFlag('--auto-import');
const AUTO_DOWNLOAD   = hasFlag('--auto-download');
const DOWNLOAD_LIMIT  = parseInt(getArg('--download-limit') || '5');
const DRY_RUN         = hasFlag('--dry-run');

const SCRIPTS_CWD = '/opt/celebskin/site/scripts';
const LOCALES     = ['en', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'nl', 'tr', 'ru'];

const startTime = Date.now();
const stats = {
    parsed:       0,
    translated:   0,
    matched:      0,
    duplicates:   0,
    noMatch:      0,
    autoImported: 0,
    errors:       [],
};

// ── Child process runner ──────────────────────────────────────────────────────

function runScript(scriptPath, scriptArgs = []) {
    return new Promise((resolve, reject) => {
        console.log(`\n[${new Date().toISOString()}] Running: node ${scriptPath} ${scriptArgs.join(' ')}`);

        const child = spawn('node', [scriptPath, ...scriptArgs], {
            cwd: SCRIPTS_CWD,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let output = '';
        child.stdout.on('data', (d) => { output += d; process.stdout.write(d); });
        child.stderr.on('data', (d) => { output += d; process.stderr.write(d); });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(output);
            } else {
                reject(new Error(`${scriptPath} exited with code ${code}\n${output.slice(-300)}`));
            }
        });

        child.on('error', reject);
    });
}

// ── DB count helper ──────────────────────────────────────────────────────────

async function countByStatus() {
    const res = await query(
        `SELECT status, COUNT(*)::int AS n FROM xcadr_imports GROUP BY status`
    );
    const counts = {};
    for (const row of res.rows) counts[row.status] = row.n;
    return counts;
}

// ── Slug helper ───────────────────────────────────────────────────────────────

function toSlug(text) {
    return slugify(text || '', { lower: true, strict: true }).substring(0, 190);
}

function buildJsonb(obj) {
    return JSON.stringify(obj);
}

function allLocalesOf(value) {
    const obj = {};
    for (const l of LOCALES) obj[l] = value;
    return obj;
}

// ── Auto-import step ─────────────────────────────────────────────────────────

async function autoImportMatched() {
    console.log('\n[Auto-Import] Querying matched items with known celebrities...');

    const items = await query(`
        SELECT xi.*
        FROM xcadr_imports xi
        WHERE xi.status = 'matched'
          AND xi.matched_celebrity_id IS NOT NULL
          AND xi.matched_video_id IS NULL
        ORDER BY xi.created_at ASC
        LIMIT 50
    `);

    console.log(`[Auto-Import] Found ${items.rows.length} items to process`);

    for (const item of items.rows) {
        try {
            if (DRY_RUN) {
                console.log(`  [DRY-RUN] Would import: "${item.title_en || item.title_ru}" (celeb_id=${item.matched_celebrity_id})`);
                stats.autoImported++;
                continue;
            }

            await importOneItem(item);
            stats.autoImported++;
            console.log(`  ✓ Imported: "${item.title_en || item.title_ru}"`);
        } catch (err) {
            console.warn(`  ✗ Failed to import id=${item.id}: ${err.message}`);
            stats.errors.push(`auto-import id=${item.id}: ${err.message}`);
        }
    }
}

async function importOneItem(item) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const celebId  = item.matched_celebrity_id;
        const titleEn  = item.title_en || item.title_ru || 'Untitled';

        // ── Find or create movie ────────────────────────────────────────────
        let movieId = null;
        if (item.movie_title_en || item.movie_title_ru) {
            const movieTitle = item.movie_title_en || item.movie_title_ru;
            const movieSlug  = toSlug(movieTitle);

            // Try exact slug match
            const existing = await client.query(
                'SELECT id FROM movies WHERE slug = $1', [movieSlug]
            );

            if (existing.rows.length > 0) {
                movieId = existing.rows[0].id;
            } else {
                // Try ILIKE on title
                const fuzzy = await client.query(
                    `SELECT id FROM movies WHERE title ILIKE $1 LIMIT 1`,
                    [movieTitle]
                );
                if (fuzzy.rows.length > 0) {
                    movieId = fuzzy.rows[0].id;
                } else {
                    // Create movie (draft — promoted to published when video publishes)
                    const titleLocalizedJson = buildJsonb({ en: movieTitle });
                    const ins = await client.query(
                        `INSERT INTO movies (title, slug, year, title_localized, description, status)
                         VALUES ($1, $2, $3, $4::jsonb, '{}'::jsonb, 'draft')
                         ON CONFLICT (slug) DO NOTHING
                         RETURNING id`,
                        [movieTitle, movieSlug, item.movie_year || null, titleLocalizedJson]
                    );
                    if (ins.rows.length > 0) {
                        movieId = ins.rows[0].id;
                    } else {
                        // Conflict — get id
                        const sel = await client.query('SELECT id FROM movies WHERE slug = $1', [movieSlug]);
                        movieId = sel.rows[0]?.id || null;
                    }
                }
            }
        }

        // ── Create video ────────────────────────────────────────────────────
        const titleJsonb = buildJsonb(allLocalesOf(titleEn));

        const videoIns = await client.query(
            `INSERT INTO videos (title, slug, review, seo_title, seo_description, status, created_at, updated_at)
             VALUES ($1::jsonb, '{"en":"placeholder"}'::jsonb, '{}'::jsonb, $1::jsonb, '{}'::jsonb, 'new', NOW(), NOW())
             RETURNING id`,
            [titleJsonb]
        );
        const videoId = videoIns.rows[0].id;

        // Update slug with UUID suffix
        const shortId  = videoId.replace(/-/g, '').substring(0, 8);
        const slugBase = toSlug(titleEn).substring(0, 180);
        const videoSlug = buildJsonb(allLocalesOf(`${slugBase}-${shortId}`));
        await client.query('UPDATE videos SET slug = $1::jsonb WHERE id = $2', [videoSlug, videoId]);

        // ── Link celebrity ──────────────────────────────────────────────────
        await client.query(
            `INSERT INTO video_celebrities (video_id, celebrity_id, confidence)
             VALUES ($1, $2, 1.0) ON CONFLICT DO NOTHING`,
            [videoId, celebId]
        );

        // ── Link movie ──────────────────────────────────────────────────────
        if (movieId) {
            await client.query(
                `INSERT INTO movie_scenes (video_id, movie_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [videoId, movieId]
            );
        }

        // ── Link tags ────────────────────────────────────────────────────────
        if (item.tags_ru && item.tags_ru.length > 0) {
            const tagMap = await client.query(
                `SELECT our_tag_slug FROM xcadr_tag_mapping WHERE xcadr_tag_ru = ANY($1) AND our_tag_slug IS NOT NULL`,
                [item.tags_ru]
            );
            for (const { our_tag_slug } of tagMap.rows) {
                const tag = await client.query('SELECT id FROM tags WHERE slug = $1', [our_tag_slug]);
                if (tag.rows.length > 0) {
                    await client.query(
                        `INSERT INTO video_tags (video_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                        [videoId, tag.rows[0].id]
                    );
                }
            }
        }

        // ── Link collections ─────────────────────────────────────────────────
        if (item.collections_ru && item.collections_ru.length > 0) {
            const collMap = await client.query(
                `SELECT our_collection_id FROM xcadr_collection_mapping WHERE xcadr_collection_ru = ANY($1) AND our_collection_id IS NOT NULL`,
                [item.collections_ru]
            );
            for (const { our_collection_id } of collMap.rows) {
                await client.query(
                    `INSERT INTO collection_videos (collection_id, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [our_collection_id, videoId]
                );
            }
        }

        // ── Update xcadr_imports ────────────────────────────────────────────
        await client.query(
            `UPDATE xcadr_imports SET status = 'imported', matched_video_id = $1 WHERE id = $2`,
            [videoId, item.id]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log('='.repeat(60));
    console.log(`xcadr Auto-Import — ${new Date().toISOString()}`);
    console.log(`Parse pages: ${PARSE_PAGES}, Translate limit: ${TRANSLATE_LIMIT}, Match limit: ${MATCH_LIMIT}`);
    console.log(`Skip parse: ${SKIP_PARSE}, Auto-import: ${AUTO_IMPORT}, Auto-download: ${AUTO_DOWNLOAD} (limit ${DOWNLOAD_LIMIT}), Dry-run: ${DRY_RUN}`);
    console.log('='.repeat(60));

    const countsBefore = await countByStatus();

    // ── Step 1: Parse ─────────────────────────────────────────────────────────
    if (!SKIP_PARSE) {
        try {
            await runScript('xcadr/parse-xcadr.js', ['--pages', String(PARSE_PAGES)]);
        } catch (err) {
            console.error(`[PARSE] Failed: ${err.message}`);
            stats.errors.push(`parse: ${err.message}`);
        }
    } else {
        console.log('\n[Step 1] Skipping parse (--skip-parse)');
    }

    // ── Step 2: Translate ─────────────────────────────────────────────────────
    try {
        await runScript('xcadr/translate-xcadr.js', ['--limit', String(TRANSLATE_LIMIT)]);
    } catch (err) {
        console.error(`[TRANSLATE] Failed: ${err.message}`);
        stats.errors.push(`translate: ${err.message}`);
    }

    // ── Step 3: Match ─────────────────────────────────────────────────────────
    try {
        await runScript('xcadr/match-xcadr.js', ['--limit', String(MATCH_LIMIT)]);
    } catch (err) {
        console.error(`[MATCH] Failed: ${err.message}`);
        stats.errors.push(`match: ${err.message}`);
    }

    // ── Step 4: Map Tags ──────────────────────────────────────────────────────
    try {
        await runScript('xcadr/map-tags.js', []);
    } catch (err) {
        console.error(`[MAP-TAGS] Failed: ${err.message}`);
        stats.errors.push(`map-tags: ${err.message}`);
    }

    // ── Step 5: Auto-Import (only if --auto-import) ───────────────────────────
    if (AUTO_IMPORT) {
        if (DRY_RUN) {
            console.log('\n[Step 5] Dry-run mode — showing what auto-import would do');
        }
        try {
            await autoImportMatched();
        } catch (err) {
            console.error(`[AUTO-IMPORT] Failed: ${err.message}`);
            stats.errors.push(`auto-import: ${err.message}`);
        }
    }

    // ── Step 6: Auto-Download (only if --auto-download) ──────────────────────
    if (AUTO_DOWNLOAD) {
        console.log(`\n[Step 6] Auto-downloading imported videos (limit ${DOWNLOAD_LIMIT})...`);
        if (DRY_RUN) {
            console.log('[Step 6] Dry-run mode — skipping download');
        } else {
            try {
                await runScript('xcadr/download-and-process.js', ['--limit', String(DOWNLOAD_LIMIT)]);
            } catch (err) {
                console.error(`[AUTO-DOWNLOAD] Failed: ${err.message}`);
                stats.errors.push(`auto-download: ${err.message}`);
            }
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const countsAfter = await countByStatus();

    const newParsed     = (countsAfter.parsed     || 0) - (countsBefore.parsed     || 0);
    const newTranslated = (countsAfter.translated  || 0) - (countsBefore.translated || 0);
    const newMatched    = (countsAfter.matched     || 0) - (countsBefore.matched    || 0);
    const totalImported = countsAfter.imported     || 0;
    const totalMatched  = countsAfter.matched      || 0;
    const totalNoMatch  = countsAfter.no_match     || 0;

    const elapsedSec = Math.round((Date.now() - startTime) / 1000);

    console.log('\n' + '='.repeat(60));
    console.log('=== Auto-Import Summary ===');
    console.log(`Parsed:                ${Math.max(0, newParsed)} new items (${countsAfter.parsed || 0} total pending)`);
    console.log(`Translated:            ${Math.max(0, newTranslated)} items`);
    console.log(`Matched:               ${Math.max(0, newMatched)} items`);
    console.log(`Tags/collections:      mapped`);
    if (AUTO_IMPORT) {
        console.log(`Auto-imported:         ${stats.autoImported} videos (known celebrities only)`);
    }
    if (AUTO_DOWNLOAD) {
        console.log(`Auto-downloaded:       see download-and-process.js output above`);
    }
    console.log(`Total imported (all):  ${totalImported}`);
    console.log(`Pending review:        ${totalMatched} matched, ${totalNoMatch} no_match`);
    console.log(`Errors:                ${stats.errors.length}`);
    if (stats.errors.length > 0) {
        stats.errors.forEach((e) => console.log(`  - ${e}`));
    }
    console.log(`Total time:            ${elapsedSec}s`);
    console.log('='.repeat(60));

    console.log('\nCron setup instructions (run on CONTABO — ssh root@161.97.142.117, then crontab -e):');
    console.log('  # Daily at 4:00 AM — full pipeline (parse + translate + match + import + download 5 videos):');
    console.log('  0 4 * * * cd /opt/celebskin/scripts && node xcadr/auto-import.js --parse-pages 5 --auto-import --auto-download --download-limit 5 >> /opt/celebskin/scripts/logs/xcadr-auto.log 2>&1');
    console.log('\n  # Parse + translate + match only (no import/download):');
    console.log('  0 4 * * * cd /opt/celebskin/scripts && node xcadr/auto-import.js --parse-pages 5 >> /opt/celebskin/scripts/logs/xcadr-auto.log 2>&1');

    await pool.end();
}

main().catch((err) => {
    console.error('[FATAL]', err.message);
    process.exit(1);
});
