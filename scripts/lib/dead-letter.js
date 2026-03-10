/**
 * dead-letter.js — Dead letter queue for pipeline failures
 *
 * Records operations that exhausted all retry attempts.
 * Provides helpers to query and resolve failures.
 */

import { query } from './db.js';

/**
 * Record a pipeline failure after retries are exhausted.
 *
 * @param {string} videoId - UUID of the video
 * @param {string} step - Pipeline step name (e.g. 'watermark', 'cdn-upload')
 * @param {Error|string} error - The error that caused the failure
 * @param {number} [attempts=1] - Number of attempts made
 */
export async function recordFailure(videoId, step, error, attempts = 1) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await query(
        `INSERT INTO pipeline_failures (video_id, step, error, attempts)
         VALUES ($1, $2, $3, $4)`,
        [videoId, step, errorMsg, attempts]
    );
}

/**
 * Get all unresolved failures, newest first.
 *
 * @param {number} [limit=50]
 * @returns {Promise<Array>}
 */
export async function getUnresolved(limit = 50) {
    const { rows } = await query(
        `SELECT pf.*, v.title->>'en' AS video_title
         FROM pipeline_failures pf
         LEFT JOIN videos v ON v.id = pf.video_id
         WHERE pf.resolved = false
         ORDER BY pf.created_at DESC
         LIMIT $1`,
        [limit]
    );
    return rows;
}

/**
 * Mark a failure as resolved.
 *
 * @param {number} failureId - ID of the pipeline_failures row
 */
export async function markResolved(failureId) {
    await query(
        `UPDATE pipeline_failures SET resolved = true, resolved_at = NOW() WHERE id = $1`,
        [failureId]
    );
}
