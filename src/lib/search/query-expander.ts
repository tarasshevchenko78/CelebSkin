import { getGeminiUrl, extractGeminiJSON } from '../gemini';
import { cached } from '../cache';
import { logger } from '../logger';
import { getSettingOrEnv } from '../db/settings';

export interface ExpandedQuery {
    detectedLang: string;
    celebrityNames: string[];
    searchTokensEN: string[];
    searchTokensOriginal: string[];
    exactTagSlugs: string[];
    movieTitles: string[];
}

const SYSTEM_PROMPT = `You are a search query analyzer for a celebrity nude scenes database.
Given a user search query, extract structured information AND generate expanded synonyms for better search.

Available tag slugs (use ONLY these exact values):
bdsm, bed-scene, bikini, blowjob, body-double, bush, butt, cleavage, explicit, full-frontal, gang-rape, lesbian, lingerie, masturbation, movie, music-video, nude, on-stage, oral, photoshoot, prosthetic, rape-scene, romantic, rough, sex-scene, sexy, shower, skinny-dip, striptease, threesome, topless, tv-show

Rules:
- detectedLang: ISO 639-1 code of the query language (en, ru, de, fr, es, pt, it, pl, nl, tr)
- celebrityNames: full names of celebrities mentioned (proper casing)
- searchTokensEN: English search keywords — include the original query PLUS 5-10 synonyms, related words and scene descriptions that could match video descriptions. E.g. "on stage" → ["on stage", "stage", "performance", "theater", "concert", "live show", "performing", "audience", "theatrical"]. Think about how scenes are described in video titles and reviews.
- searchTokensOriginal: keywords in the original language if not English (lowercase), also with synonyms
- exactTagSlugs: matching tag slugs from the list above
- movieTitles: movie/TV show titles mentioned

Return valid JSON only. Keep arrays empty if not applicable.`;

export async function expandQueryWithGemini(query: string): Promise<ExpandedQuery | null> {
    // Read keys from DB settings (UI), with .env fallback
    const keysStr = await getSettingOrEnv('gemini_api_key');
    const keys = keysStr.split(',').map(k => k.trim()).filter(Boolean);
    if (keys.length === 0) return null;

    // Rotate keys based on query hash
    const hash = query.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const apiKey = keys[hash % keys.length];

    return cached<ExpandedQuery | null>(
        `search:gemini:${query.toLowerCase()}`,
        () => callGemini(query, apiKey),
        86400, // 24 hours
    );
}

async function callGemini(query: string, apiKey: string): Promise<ExpandedQuery | null> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(getGeminiUrl(apiKey), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                contents: [{ parts: [{ text: query }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 1024,
                    responseMimeType: 'application/json',
                },
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            logger.warn('Gemini search expand failed', { status: response.status, body: body.slice(0, 200) });
            return null;
        }

        const data = await response.json();
        // Try extractGeminiJSON first, fallback to direct text parse
        let parsed = extractGeminiJSON(data);
        if (!parsed) {
            // Direct parse from candidates text
            const text = data?.candidates?.[0]?.content?.parts
                ?.filter((p: Record<string, unknown>) => p.text && !p.thought)
                ?.map((p: Record<string, unknown>) => p.text)
                ?.join('') || '';
            const clean = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/g, '');
            try { parsed = JSON.parse(clean); } catch { /* ignore */ }
        }
        if (!parsed) {
            logger.warn('Gemini search expand: no JSON parsed', { query, raw: JSON.stringify(data).slice(0, 500) });
            return null;
        }
        logger.info('Gemini search expanded', { query, tokensEN: parsed.searchTokensEN, tags: parsed.exactTagSlugs });

        return {
            detectedLang: parsed.detectedLang || 'en',
            celebrityNames: Array.isArray(parsed.celebrityNames) ? parsed.celebrityNames : [],
            searchTokensEN: Array.isArray(parsed.searchTokensEN) ? parsed.searchTokensEN : [],
            searchTokensOriginal: Array.isArray(parsed.searchTokensOriginal) ? parsed.searchTokensOriginal : [],
            exactTagSlugs: Array.isArray(parsed.exactTagSlugs) ? parsed.exactTagSlugs : [],
            movieTitles: Array.isArray(parsed.movieTitles) ? parsed.movieTitles : [],
        };
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            logger.warn('Gemini search expand timeout', { query });
        } else {
            logger.warn('Gemini search expand error', {
                query,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        return null;
    }
}
