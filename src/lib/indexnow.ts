/**
 * IndexNow — instant URL indexing notification for Bing/Yandex
 *
 * After publishing videos, call submitUrls() with the list of new URLs.
 * Batches up to 10,000 URLs per request (IndexNow limit).
 *
 * Bing and Yandex support IndexNow natively.
 * Google does not support IndexNow — use Google Search Console API separately if needed.
 */

import { publicConfig } from './config';
import { logger } from './logger';

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_BATCH_SIZE = 10000;
const LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];

function getApiKey(): string {
    return process.env.INDEXNOW_KEY || '';
}

/**
 * Generate all locale URLs for a given video slug (one per locale)
 */
export function generateVideoUrls(slug: string): string[] {
    const base = publicConfig.siteUrl;
    return LOCALES.map(locale => `${base}/${locale}/video/${slug}`);
}

/**
 * Generate all locale URLs for a celebrity slug
 */
export function generateCelebrityUrls(slug: string): string[] {
    const base = publicConfig.siteUrl;
    return LOCALES.map(locale => `${base}/${locale}/celebrity/${slug}`);
}

/**
 * Generate all locale URLs for a movie slug
 */
export function generateMovieUrls(slug: string): string[] {
    const base = publicConfig.siteUrl;
    return LOCALES.map(locale => `${base}/${locale}/movie/${slug}`);
}

/**
 * Submit a batch of URLs to IndexNow
 * Automatically splits into chunks of MAX_BATCH_SIZE
 */
export async function submitUrls(urls: string[]): Promise<{ submitted: number; errors: number }> {
    const apiKey = getApiKey();
    if (!apiKey) {
        logger.warn('IndexNow: INDEXNOW_KEY not configured, skipping submission');
        return { submitted: 0, errors: 0 };
    }

    if (urls.length === 0) {
        return { submitted: 0, errors: 0 };
    }

    const host = new URL(publicConfig.siteUrl).host;
    let submitted = 0;
    let errors = 0;

    // Split into batches
    for (let i = 0; i < urls.length; i += MAX_BATCH_SIZE) {
        const batch = urls.slice(i, i + MAX_BATCH_SIZE);

        try {
            const response = await fetch(INDEXNOW_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    host,
                    key: apiKey,
                    keyLocation: `${publicConfig.siteUrl}/${apiKey}.txt`,
                    urlList: batch,
                }),
            });

            if (response.ok || response.status === 202) {
                submitted += batch.length;
                logger.info(`IndexNow: submitted ${batch.length} URLs (batch ${Math.floor(i / MAX_BATCH_SIZE) + 1})`);
            } else {
                errors += batch.length;
                const text = await response.text().catch(() => '');
                logger.error(`IndexNow: batch failed — HTTP ${response.status}: ${text}`);
            }
        } catch (err) {
            errors += batch.length;
            logger.error(`IndexNow: request error — ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    logger.info(`IndexNow: total submitted=${submitted}, errors=${errors}`);
    return { submitted, errors };
}
