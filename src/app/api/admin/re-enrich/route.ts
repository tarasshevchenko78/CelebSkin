import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { invalidateAfterEdit } from '@/lib/cache';
import { extractGeminiJSON } from '@/lib/gemini';

export const dynamic = 'force-dynamic';

const TMDB_BASE  = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w500';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${config.geminiApiKey}`;

const LOCALES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'nl', 'tr', 'ru'] as const;
type Locale = typeof LOCALES[number];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<Record<string, string> | null> {
    if (!config.geminiApiKey) return null;
    try {
        const res = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
            }),
        });
        const data = await res.json();
        return extractGeminiJSON(data);
    } catch {
        return null;
    }
}

async function translateToLocales(
    type: string,
    fieldName: string,
    englishText: string
): Promise<Record<string, string> | null> {
    const prompt = `Translate this ${type} ${fieldName} to these languages. Use natural, fluent translations.
English: "${englishText}"

Return JSON with exactly these keys: ru, de, fr, es, it, pt, pl, nl, tr
(do NOT include "en" — only the 9 non-English languages)`;
    return callGemini(prompt);
}

async function translateFromRussian(
    type: string,
    fieldName: string,
    russianText: string
): Promise<Record<string, string> | null> {
    const prompt = `Translate this ${type} ${fieldName} to these languages. Use natural, fluent translations.
Russian: "${russianText}"

Return JSON with exactly these keys: en, de, fr, es, it, pt, pl, nl, tr
(do NOT include "ru" — only the 9 non-Russian languages)`;
    return callGemini(prompt);
}

async function tmdbGet(path: string, params: Record<string, string> = {}) {
    if (!config.tmdbApiKey) return null;
    const url = new URL(`${TMDB_BASE}${path}`);
    url.searchParams.set('api_key', config.tmdbApiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    try {
        const res = await fetch(url.toString());
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

// ── Re-enrich: Celebrity ─────────────────────────────────────────────────────

async function reEnrichCelebrity(id: number) {
    const dbRes = await pool.query('SELECT * FROM celebrities WHERE id = $1', [id]);
    const celeb = dbRes.rows[0];
    if (!celeb) return { error: 'Celebrity not found' };

    const search = await tmdbGet('/search/person', { query: celeb.name, language: 'en-US' });
    const person = search?.results?.[0];
    if (!person) return { error: 'Not found on TMDB', name: celeb.name };

    const detail = await tmdbGet(`/person/${person.id}`, { language: 'en-US' });
    if (!detail) return { error: 'TMDB detail fetch failed' };

    const updates: Record<string, unknown> = { tmdb_id: person.id };
    if (detail.profile_path) {
        updates.photo_url = `${TMDB_IMAGE}${detail.profile_path}`;
    }

    // Translate biography to all locales
    const bioEn = detail.biography || '';
    const bioJsonb: Record<string, string> = { en: bioEn };
    if (bioEn) {
        const translations = await translateToLocales('celebrity', 'biography', bioEn.substring(0, 800));
        if (translations) {
            for (const locale of LOCALES) {
                if (locale !== 'en' && translations[locale]) bioJsonb[locale] = translations[locale];
            }
        }
    }
    updates.bio = JSON.stringify(bioJsonb);

    await pool.query(
        `UPDATE celebrities SET bio = $1::jsonb, photo_url = $2, tmdb_id = $3, updated_at = NOW() WHERE id = $4`,
        [updates.bio, updates.photo_url || celeb.photo_url, updates.tmdb_id, id]
    );

    return { success: true, tmdb_id: person.id, photo_updated: !!detail.profile_path, bio_length: bioEn.length };
}

// ── Re-enrich: Movie ─────────────────────────────────────────────────────────

async function reEnrichMovie(id: number) {
    const dbRes = await pool.query('SELECT * FROM movies WHERE id = $1', [id]);
    const movie = dbRes.rows[0];
    if (!movie) return { error: 'Movie not found' };

    const params: Record<string, string> = { query: movie.title, language: 'en-US' };
    if (movie.year) params.year = String(movie.year);
    const search = await tmdbGet('/search/movie', params);
    const result = search?.results?.[0];
    if (!result) return { error: 'Not found on TMDB', title: movie.title };

    const detail = await tmdbGet(`/movie/${result.id}`, {
        language: 'en-US',
        append_to_response: 'credits',
    });
    if (!detail) return { error: 'TMDB detail fetch failed' };

    // Director
    const director = detail.credits?.crew?.find(
        (c: { job: string; name: string }) => c.job === 'Director'
    )?.name || null;

    // Genres
    const genres: string[] = detail.genres?.map((g: { name: string }) => g.name) || [];

    // Overview → translate to all locales
    const overviewEn = detail.overview || '';
    const descJsonb: Record<string, string> = { en: overviewEn };
    if (overviewEn) {
        const translations = await translateToLocales('movie', 'description', overviewEn.substring(0, 800));
        if (translations) {
            for (const locale of LOCALES) {
                if (locale !== 'en' && translations[locale]) descJsonb[locale] = translations[locale];
            }
        }
    }

    const posterUrl = detail.poster_path ? `${TMDB_IMAGE}${detail.poster_path}` : movie.poster_url;

    await pool.query(
        `UPDATE movies
         SET description = $1::jsonb, poster_url = $2, director = $3,
             genres = $4, tmdb_id = $5, year = COALESCE(year, $6), updated_at = NOW()
         WHERE id = $7`,
        [JSON.stringify(descJsonb), posterUrl, director, genres, result.id, detail.release_date?.substring(0, 4) || null, id]
    );

    return { success: true, tmdb_id: result.id, poster_updated: !!detail.poster_path, director, genres };
}

// ── Re-enrich: Video ─────────────────────────────────────────────────────────

async function reEnrichVideo(id: string) {
    const dbRes = await pool.query(
        `SELECT v.*, m.title AS movie_title_en, m.year AS movie_year
         FROM videos v
         LEFT JOIN movie_scenes ms ON ms.video_id = v.id
         LEFT JOIN movies m ON m.id = ms.movie_id
         WHERE v.id = $1`,
        [id]
    );
    const video = dbRes.rows[0];
    if (!video) return { error: 'Video not found' };

    const movieTitle: string = video.movie_title_en || video.title?.en || '';
    if (!movieTitle) return { error: 'No movie title to search TMDB with' };

    const search = await tmdbGet('/search/movie', { query: movieTitle, language: 'en-US' });
    const result = search?.results?.[0];
    if (!result) return { error: 'Not found on TMDB', title: movieTitle };

    const detail = await tmdbGet(`/movie/${result.id}`, { language: 'en-US' });
    if (!detail) return { error: 'TMDB detail fetch failed' };

    const overviewEn = detail.overview || '';
    if (!overviewEn) return { success: true, message: 'No overview on TMDB' };

    const reviewJsonb: Record<string, string> = { en: overviewEn };
    const translations = await translateToLocales('video', 'review/description', overviewEn.substring(0, 800));
    if (translations) {
        for (const locale of LOCALES) {
            if (locale !== 'en' && translations[locale]) reviewJsonb[locale] = translations[locale];
        }
    }

    await pool.query(
        `UPDATE videos SET review = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(reviewJsonb), id]
    );

    return { success: true, tmdb_id: result.id, review_length: overviewEn.length };
}

// ── Re-translate ──────────────────────────────────────────────────────────────

async function reTranslate(type: 'video' | 'celebrity' | 'movie', id: string | number) {
    if (!config.geminiApiKey) return { error: 'GEMINI_API_KEY not configured' };

    const updated: string[] = [];

    if (type === 'celebrity') {
        const dbRes = await pool.query('SELECT * FROM celebrities WHERE id = $1', [id]);
        const celeb = dbRes.rows[0];
        if (!celeb) return { error: 'Celebrity not found' };

        // Translate name to all locales
        const nameTrans = await translateToLocales('celebrity', 'name', celeb.name);
        const nameLocalizedNew: Record<string, string> = { en: celeb.name };
        if (nameTrans) {
            for (const locale of LOCALES) {
                if (locale !== 'en') nameLocalizedNew[locale] = nameTrans[locale] || celeb.name;
            }
            updated.push('name_localized');
        }

        // Translate bio
        const bioEn = celeb.bio?.en || celeb.bio || '';
        const bioNew: Record<string, string> = { en: typeof bioEn === 'string' ? bioEn : '' };
        if (bioEn && typeof bioEn === 'string') {
            const bioTrans = await translateToLocales('celebrity', 'biography', bioEn.substring(0, 800));
            if (bioTrans) {
                for (const locale of LOCALES) {
                    if (locale !== 'en') bioNew[locale] = bioTrans[locale] || bioEn;
                }
                updated.push('bio');
            }
        }

        await pool.query(
            `UPDATE celebrities SET name_localized = $1::jsonb, bio = $2::jsonb WHERE id = $3`,
            [JSON.stringify(nameLocalizedNew), JSON.stringify(bioNew), id]
        );
    }

    if (type === 'movie') {
        const dbRes = await pool.query('SELECT * FROM movies WHERE id = $1', [id]);
        const movie = dbRes.rows[0];
        if (!movie) return { error: 'Movie not found' };

        const titleEn = movie.title || '';
        const titleLocalizedNew: Record<string, string> = { en: titleEn };
        const titleTrans = await translateToLocales('movie', 'title', titleEn);
        if (titleTrans) {
            for (const locale of LOCALES) {
                if (locale !== 'en') titleLocalizedNew[locale] = titleTrans[locale] || titleEn;
            }
            updated.push('title_localized');
        }

        const descEn = movie.description?.en || '';
        const descNew: Record<string, string> = { en: descEn };
        if (descEn) {
            const descTrans = await translateToLocales('movie', 'description', descEn.substring(0, 800));
            if (descTrans) {
                for (const locale of LOCALES) {
                    if (locale !== 'en') descNew[locale] = descTrans[locale] || descEn;
                }
                updated.push('description');
            }
        }

        await pool.query(
            `UPDATE movies SET title_localized = $1::jsonb, description = $2::jsonb, updated_at = NOW() WHERE id = $3`,
            [JSON.stringify(titleLocalizedNew), JSON.stringify(descNew), id]
        );
    }

    if (type === 'video') {
        const dbRes = await pool.query('SELECT * FROM videos WHERE id = $1', [id]);
        const video = dbRes.rows[0];
        if (!video) return { error: 'Video not found' };

        const titleEn = video.title?.en || video.original_title || '';
        const titleNew: Record<string, string> = { ...(video.title || {}), en: titleEn };
        if (titleEn) {
            const titleTrans = await translateToLocales('video', 'title', titleEn);
            if (titleTrans) {
                for (const locale of LOCALES as readonly Locale[]) {
                    if (locale !== 'en') titleNew[locale] = titleTrans[locale] || titleEn;
                }
                updated.push('title');
            }
        }

        const reviewEn = video.review?.en || '';
        const reviewNew: Record<string, string> = { ...(video.review || {}), en: reviewEn };
        if (reviewEn) {
            const reviewTrans = await translateToLocales('video', 'description', reviewEn.substring(0, 800));
            if (reviewTrans) {
                for (const locale of LOCALES as readonly Locale[]) {
                    if (locale !== 'en') reviewNew[locale] = reviewTrans[locale] || reviewEn;
                }
                updated.push('review');
            }
        }

        const seoTitleEn = video.seo_title?.en || titleEn;
        const seoTitleNew: Record<string, string> = { ...(video.seo_title || {}), en: seoTitleEn };
        if (seoTitleEn) {
            const seoTitleTrans = await translateToLocales('video', 'SEO title', seoTitleEn);
            if (seoTitleTrans) {
                for (const locale of LOCALES as readonly Locale[]) {
                    if (locale !== 'en') seoTitleNew[locale] = seoTitleTrans[locale] || seoTitleEn;
                }
                updated.push('seo_title');
            }
        }

        await pool.query(
            `UPDATE videos SET title = $1::jsonb, review = $2::jsonb, seo_title = $3::jsonb, updated_at = NOW() WHERE id = $4`,
            [JSON.stringify(titleNew), JSON.stringify(reviewNew), JSON.stringify(seoTitleNew), id]
        );
    }

    return { success: true, languages_updated: LOCALES.length, fields_updated: updated };
}

// ── Vision helpers ────────────────────────────────────────────────────────────

async function fetchImageAsBase64(url: string): Promise<string | null> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return null;
        const buffer = Buffer.from(await res.arrayBuffer());
        return buffer.toString('base64');
    } catch {
        return null;
    }
}

function pickScreenshots(urls: string[], maxCount = 6): string[] {
    if (urls.length <= maxCount) return urls;
    const picked: string[] = [];
    const step = (urls.length - 1) / (maxCount - 1);
    for (let i = 0; i < maxCount; i++) {
        picked.push(urls[Math.round(i * step)]);
    }
    return picked;
}

interface GeminiPart {
    text?: string;
    inline_data?: { mime_type: string; data: string };
}

async function callGeminiVision(imageParts: GeminiPart[], textPrompt: string): Promise<Record<string, unknown> | null> {
    if (!config.geminiApiKey) return null;
    const parts: GeminiPart[] = [...imageParts, { text: textPrompt }];
    try {
        const res = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
            }),
        });
        const data = await res.json();
        return extractGeminiJSON(data);
    } catch {
        return null;
    }
}

// ── Regenerate description ────────────────────────────────────────────────────

async function regenerateDescription(type: 'video' | 'celebrity' | 'movie', id: string | number) {
    if (!config.geminiApiKey) return { error: 'GEMINI_API_KEY not configured' };

    if (type === 'video') {
        // Fetch video with related data
        const dbRes = await pool.query(
            `SELECT v.*,
                    c.name  AS celeb_name,
                    m.title AS movie_title, m.year AS movie_year,
                    array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL) AS tag_names
             FROM videos v
             LEFT JOIN video_celebrities vc ON vc.video_id = v.id
             LEFT JOIN celebrities c ON c.id = vc.celebrity_id
             LEFT JOIN movie_scenes ms ON ms.video_id = v.id
             LEFT JOIN movies m ON m.id = ms.movie_id
             LEFT JOIN video_tags vt ON vt.video_id = v.id
             LEFT JOIN tags t ON t.id = vt.tag_id
             WHERE v.id = $1
             GROUP BY v.id, c.name, m.title, m.year`,
            [String(id)]
        );
        const video = dbRes.rows[0];
        if (!video) return { error: 'Video not found' };

        // Gather screenshots
        const screenshots: string[] = Array.isArray(video.screenshots)
            ? video.screenshots
            : [];

        if (screenshots.length === 0) {
            return { error: 'No screenshots available for AI analysis' };
        }

        // Fetch up to 6 screenshots as base64
        const selected = pickScreenshots(screenshots, 6);
        const imageParts: GeminiPart[] = [];
        for (const url of selected) {
            const b64 = await fetchImageAsBase64(url);
            if (b64) {
                imageParts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
            }
        }

        if (imageParts.length === 0) {
            return { error: 'Could not load any screenshots for AI analysis' };
        }

        const titleEn = video.title?.en || video.original_title || '';
        const tags: string[] = Array.isArray(video.tag_names) ? video.tag_names.filter(Boolean) : [];

        const titleRu = video.title?.ru || titleEn;
        const prompt = `Вы пишете описания для базы данных кинематографических сцен знаменитостей.

На основе этих ${imageParts.length} скриншотов из сцены напишите описание на русском языке.

Известная информация:
- Актриса: ${video.celeb_name || 'Не указана'}
- Фильм: ${video.movie_title || 'Не указан'}${video.movie_year ? ` (${video.movie_year})` : ''}
- Название сцены: ${titleRu}
- Теги: ${tags.join(', ') || 'нет'}
- Длительность: ${video.duration_formatted || 'неизвестно'}

Напишите ДВЕ версии на русском языке:
1. Краткое описание (1-2 предложения) для карточки превью
2. Подробное описание (3-5 предложений) для страницы сцены

Описывайте то, что видно: обстановку, освещение, настроение, что на актрисе надето (или не надето), тип сцены, заметные визуальные элементы.
Будьте точны и описательны. Используйте корректный язык для тематической базы данных киносцен.

Верните JSON:
{
  "short_description": "...",
  "detailed_description": "...",
  "scene_type": "bed-scene|shower|pool|outdoor|romantic|dramatic|other",
  "setting": "bedroom|bathroom|beach|outdoors|other",
  "mood": "romantic|intense|playful|dramatic|other"
}`;

        const aiResult = await callGeminiVision(imageParts, prompt);
        if (!aiResult) return { error: 'Gemini Vision API call failed' };

        const shortDescRu    = String(aiResult.short_description    || '');
        const detailedDescRu = String(aiResult.detailed_description || '');
        if (!detailedDescRu) return { error: 'AI did not return a description' };

        // Russian is base; translate to 9 other locales
        const reviewJsonb: Record<string, string> = { ru: detailedDescRu };
        const seoDescJsonb: Record<string, string> = { ru: shortDescRu };

        if (detailedDescRu) {
            const translations = await translateFromRussian('video', 'scene description', detailedDescRu.substring(0, 800));
            const shortTrans   = await translateFromRussian('video', 'short scene description', shortDescRu.substring(0, 400));
            if (translations) {
                for (const locale of LOCALES) {
                    if (locale !== 'ru' && translations[locale]) reviewJsonb[locale] = translations[locale];
                }
            }
            if (shortTrans) {
                for (const locale of LOCALES) {
                    if (locale !== 'ru' && shortTrans[locale]) seoDescJsonb[locale] = shortTrans[locale];
                }
            }
        }

        await pool.query(
            `UPDATE videos SET review = $1::jsonb, seo_description = $2::jsonb, updated_at = NOW() WHERE id = $3`,
            [JSON.stringify(reviewJsonb), JSON.stringify(seoDescJsonb), String(id)]
        );

        try { await invalidateAfterEdit(); } catch { /* non-critical */ }

        return {
            success: true,
            description: {
                short:      shortDescRu,
                detailed:   detailedDescRu,
                scene_type: String(aiResult.scene_type || ''),
                setting:    String(aiResult.setting    || ''),
                mood:       String(aiResult.mood       || ''),
            },
            languages_translated: LOCALES.length,
        };
    }

    if (type === 'celebrity') {
        const dbRes = await pool.query('SELECT * FROM celebrities WHERE id = $1', [id]);
        const celeb = dbRes.rows[0];
        if (!celeb) return { error: 'Celebrity not found' };
        if (!celeb.photo_url) return { error: 'No photo available for AI description' };

        const b64 = await fetchImageAsBase64(celeb.photo_url);
        if (!b64) return { error: 'Could not load celebrity photo' };

        const aiResult = await callGeminiVision(
            [{ inline_data: { mime_type: 'image/jpeg', data: b64 } }],
            `Based on this photo and the name "${celeb.name}", write a brief professional bio (2-3 sentences) for a celebrity movie scene database. Mention their appearance naturally. Be tasteful and factual.

Return JSON: { "bio": "..." }`
        );
        if (!aiResult?.bio) return { error: 'Gemini Vision did not return a bio' };

        const bioEn = String(aiResult.bio);
        const bioJsonb: Record<string, string> = { en: bioEn };
        const trans = await translateToLocales('celebrity', 'biography', bioEn.substring(0, 800));
        if (trans) {
            for (const locale of LOCALES) {
                if (locale !== 'en' && trans[locale]) bioJsonb[locale] = trans[locale];
            }
        }

        await pool.query(
            `UPDATE celebrities SET bio = $1::jsonb, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(bioJsonb), id]
        );

        return {
            success: true,
            description: { detailed: bioEn, short: bioEn.substring(0, 150) },
            languages_translated: LOCALES.length,
        };
    }

    if (type === 'movie') {
        const dbRes = await pool.query('SELECT * FROM movies WHERE id = $1', [id]);
        const movie = dbRes.rows[0];
        if (!movie) return { error: 'Movie not found' };
        if (!movie.poster_url) return { error: 'No poster available for AI description' };

        const b64 = await fetchImageAsBase64(movie.poster_url);
        if (!b64) return { error: 'Could not load movie poster' };

        const aiResult = await callGeminiVision(
            [{ inline_data: { mime_type: 'image/jpeg', data: b64 } }],
            `Based on this movie poster, write a description for "${movie.title}"${movie.year ? ` (${movie.year})` : ''}${movie.director ? `, directed by ${movie.director}` : ''}. Write 2-4 sentences describing the film's genre, tone, and what audiences can expect.

Return JSON: { "description": "..." }`
        );
        if (!aiResult?.description) return { error: 'Gemini Vision did not return a description' };

        const descEn = String(aiResult.description);
        const descJsonb: Record<string, string> = { en: descEn };
        const trans = await translateToLocales('movie', 'description', descEn.substring(0, 800));
        if (trans) {
            for (const locale of LOCALES) {
                if (locale !== 'en' && trans[locale]) descJsonb[locale] = trans[locale];
            }
        }

        await pool.query(
            `UPDATE movies SET description = $1::jsonb, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(descJsonb), id]
        );

        return {
            success: true,
            description: { detailed: descEn, short: descEn.substring(0, 150) },
            languages_translated: LOCALES.length,
        };
    }

    return { error: 'Invalid type' };
}

// ── POST /api/admin/re-enrich ─────────────────────────────────────────────────
export async function POST(request: NextRequest) {
    let body: { type?: string; id?: unknown; action?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { type, id, action } = body;

    if (!type || !['video', 'celebrity', 'movie'].includes(type)) {
        return NextResponse.json({ error: 'type must be video, celebrity, or movie' }, { status: 400 });
    }
    if (!id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    if (!action || !['re-enrich', 're-translate', 'regenerate-description'].includes(action)) {
        return NextResponse.json({ error: 'action must be re-enrich, re-translate, or regenerate-description' }, { status: 400 });
    }

    try {
        if (action === 'regenerate-description') {
            const result = await regenerateDescription(
                type as 'video' | 'celebrity' | 'movie',
                type === 'video' ? String(id) : parseInt(String(id))
            );
            return NextResponse.json(result);
        }

        let result: Record<string, unknown>;

        if (action === 're-enrich') {
            if (type === 'celebrity') {
                result = await reEnrichCelebrity(parseInt(String(id)));
            } else if (type === 'movie') {
                result = await reEnrichMovie(parseInt(String(id)));
            } else {
                result = await reEnrichVideo(String(id));
            }
        } else {
            // re-translate
            result = await reTranslate(type as 'video' | 'celebrity' | 'movie', type === 'video' ? String(id) : parseInt(String(id)));
        }

        return NextResponse.json(result);
    } catch (error) {
        logger.error('re-enrich failed', {
            route: '/api/admin/re-enrich',
            type, action,
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
