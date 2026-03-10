/**
 * retry.js — Generic async retry wrapper for CelebSkin pipeline
 *
 * Usage:
 *   import { withRetry } from './lib/retry.js';
 *   const result = await withRetry(() => someAsyncFn(), {
 *       maxRetries: 3, delayMs: 2000, label: 'my-operation', exponential: true
 *   });
 */

import logger from './logger.js';

/**
 * Retry an async function with configurable backoff.
 *
 * @param {() => Promise<T>} fn - Async function to retry
 * @param {Object} options
 * @param {number} [options.maxRetries=3] - Max retry attempts (total calls = maxRetries + 1)
 * @param {number} [options.delayMs=1000] - Base delay between retries in ms
 * @param {string} [options.label='operation'] - Label for log messages
 * @param {boolean} [options.exponential=false] - Use exponential backoff (delay * 2^attempt)
 * @returns {Promise<T>} Result of fn()
 * @throws Last error if all retries exhausted
 */
export async function withRetry(fn, options = {}) {
    const {
        maxRetries = 3,
        delayMs = 1000,
        label = 'operation',
        exponential = false,
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;

            if (attempt < maxRetries) {
                const delay = exponential ? delayMs * Math.pow(2, attempt) : delayMs;
                logger.warn(`[retry] ${label} attempt ${attempt + 1}/${maxRetries + 1} failed: ${err.message} — retrying in ${delay}ms`);
                await sleep(delay);
            } else {
                logger.error(`[retry] ${label} failed after ${maxRetries + 1} attempts: ${err.message}`);
            }
        }
    }

    throw lastError;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
