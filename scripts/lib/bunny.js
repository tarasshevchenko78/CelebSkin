/**
 * bunny.js — Centralized BunnyCDN service for CelebSkin pipeline
 *
 * All CDN upload logic, path construction, and URL validation in one place.
 */

import { readFile } from 'fs/promises';
import { extname } from 'path';
import axios from 'axios';
import { config } from './config.js';
import logger from './logger.js';
import { withRetry } from './retry.js';
import { recordFailure } from './dead-letter.js';

// ============================================
// Constants
// ============================================

const MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.json': 'application/json',
};

// ============================================
// Path Builders
// ============================================

export function getVideoPath(videoId) {
    return `videos/${videoId}`;
}

export function getCelebrityPath(slug) {
    return `celebrities/${slug}`;
}

export function getMoviePath(slug) {
    return `movies/${slug}`;
}

// ============================================
// URL Builders
// ============================================

export function getCdnUrl(remotePath) {
    return `${config.bunny.cdnUrl}/${remotePath}`;
}

export function getStorageUrl(remotePath) {
    return `https://${config.bunny.storageHost}/${config.bunny.storageZone}/${remotePath}`;
}

// ============================================
// URL Validation
// ============================================

/**
 * Check if a URL is a BunnyCDN URL.
 * @param {string} url
 * @returns {boolean}
 */
export function isCdnUrl(url) {
    if (!url) return false;
    return url.includes('b-cdn.net');
}

// ============================================
// Upload from file
// ============================================

/**
 * Upload a local file to BunnyCDN Storage with retry.
 *
 * @param {string} localPath - Absolute path to local file
 * @param {string} remotePath - Path within storage zone (e.g. 'videos/{id}/watermarked.mp4')
 * @param {object} [options]
 * @param {string} [options.videoId] - For dead-letter recording on final failure
 * @param {string} [options.step='cdn-upload'] - Pipeline step label for dead-letter
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.delayMs=3000]
 * @param {number} [options.timeout=600000] - Request timeout (ms)
 * @returns {Promise<string>} CDN URL of uploaded file
 */
export async function uploadFile(localPath, remotePath, options = {}) {
    const {
        videoId = null,
        step = 'cdn-upload',
        maxRetries = 3,
        delayMs = 3000,
        timeout = 600000,
    } = options;

    const label = videoId ? `${step}:${videoId}` : `${step}:${remotePath}`;

    try {
        return await withRetry(
            async () => {
                const fileBuffer = await readFile(localPath);
                const ext = extname(localPath).toLowerCase();
                const contentType = MIME_TYPES[ext] || 'application/octet-stream';

                const response = await axios.put(getStorageUrl(remotePath), fileBuffer, {
                    headers: {
                        'AccessKey': config.bunny.storageKey,
                        'Content-Type': contentType,
                    },
                    maxContentLength: 500 * 1024 * 1024,
                    timeout,
                });

                if (response.status !== 201 && response.status !== 200) {
                    throw new Error(`BunnyCDN upload failed: ${response.status} ${response.statusText}`);
                }

                return getCdnUrl(remotePath);
            },
            { maxRetries, delayMs, label }
        );
    } catch (err) {
        if (videoId) {
            await recordFailure(videoId, step, err, maxRetries + 1);
        }
        throw err;
    }
}

// ============================================
// Upload from buffer
// ============================================

/**
 * Upload a buffer to BunnyCDN Storage with retry.
 * Used for celebrity photos and movie posters already in memory.
 *
 * @param {Buffer} buffer - File content
 * @param {string} remotePath - Path within storage zone
 * @param {string} contentType - MIME type
 * @param {object} [options]
 * @param {number} [options.timeout=30000]
 * @param {number} [options.maxRetries=2]
 * @param {number} [options.delayMs=2000]
 * @returns {Promise<string>} CDN URL
 */
export async function uploadBuffer(buffer, remotePath, contentType, options = {}) {
    const {
        timeout = 30000,
        maxRetries = 2,
        delayMs = 2000,
    } = options;

    return await withRetry(
        async () => {
            const response = await axios.put(getStorageUrl(remotePath), buffer, {
                headers: {
                    'AccessKey': config.bunny.storageKey,
                    'Content-Type': contentType,
                },
                timeout,
            });

            if (response.status !== 201 && response.status !== 200) {
                throw new Error(`BunnyCDN upload failed: ${response.status} ${response.statusText}`);
            }

            return getCdnUrl(remotePath);
        },
        { maxRetries, delayMs, label: `cdn-upload-buffer:${remotePath}` }
    );
}

// ============================================
// Check File Exists
// ============================================

/**
 * Check if a file exists on BunnyCDN via HEAD request.
 *
 * @param {string} remotePath - Path within storage zone
 * @returns {Promise<boolean>}
 */
export async function checkFileExists(remotePath) {
    try {
        const response = await axios.head(getCdnUrl(remotePath), { timeout: 10000 });
        return response.status === 200;
    } catch {
        return false;
    }
}
