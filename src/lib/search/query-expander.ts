import { config } from '../config';
import { getGeminiUrl, extractGeminiJSON } from '../gemini';
import { cached } from '../cache';
import { logger } from '../logger';

export interface ExpandedQuery {
    detectedLang: string;
    celebrityNames: string[];
    searchTokensEN: string[];
    searchTokensOriginal: string[];
    exactTagSlugs: string[];
    movieTitles: string[];
}

const SYSTEM_PROMPT = `You are a search query analyzer for a celebrity nude scenes database.
Given a user search query, extract structured information for the search engine.

Available tag slugs (use ONLY these exact values):
bdsm, bed-scene, bikini, blowjob, body-double, bush, butt, cleavage, explicit, full-frontal, gang-rape, lesbian, lingerie, masturbation, movie, music-video, nude, on-stage, oral, photoshoot, prosthetic, rape-scene, romantic, rough, sex-scene, sexy, shower, skinny-dip, striptease, threesome, topless, tv-show

Rules:
- detectedLang: ISO 639-1 code of the query language (en, ru, de, fr, es, pt, it, pl, nl, tr)
- celebrityNames: full names of celebrities mentioned (proper casing)
- searchTokensEN: English search keywords extracted from query (lowercase)
- searchTokensOriginal: keywords in the original language if not English (lowercase)
- exactTagSlugs: matching tag slugs from the list above
- movieTitles: movie/TV show titles mentioned

Return valid JSON only. Keep arrays empty if not applicable. Be concise.`;

export async function expandQueryWithGemini(query: string): Promise<ExpandedQuery | null> {
    const apiKey = config.geminiApiKey;
    if (!apiKey) return null;

    return cached<ExpandedQuery | null>(
        `search:gemini:${query.toLowerCase()}`,
        () => callGemini(query, apiKey),
        86400, // 24 hours
    );
}

async function callGemini(query: string, apiKey: string): Promise<ExpandedQuery | null> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(getGeminiUrl(apiKey), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                contents: [{ parts: [{ text: query }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 300,
                    responseMimeType: 'application/json',
                },
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            logger.warn('Gemini search expand failed', { status: response.status });
            return null;
        }

        const data = await response.json();
        const parsed = extractGeminiJSON(data);
        if (!parsed) return null;

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
