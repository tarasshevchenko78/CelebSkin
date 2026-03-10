/**
 * config.js — Centralized configuration for CelebSkin pipeline
 *
 * Loads .env from scripts/ directory, validates required vars,
 * and exports a typed config object used by all pipeline scripts.
 *
 * Usage:
 *   import { config } from './lib/config.js';
 *   // or from script root:
 *   import { config } from './lib/config.js';
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

// ============================================
// Helpers
// ============================================

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `[Pipeline Config] Missing required env var: ${name}. ` +
            `Check scripts/.env file.`
        );
    }
    return value;
}

function optionalEnv(name, fallback) {
    return process.env[name] || fallback;
}

// ============================================
// Config object
// ============================================

export const config = {
    // --- Database (PostgreSQL on AbeloHost) ---
    db: {
        host: optionalEnv('DB_HOST', '185.224.82.214'),
        port: parseInt(optionalEnv('DB_PORT', '5432')),
        database: optionalEnv('DB_NAME', 'celebskin'),
        user: optionalEnv('DB_USER', 'celebskin'),
        password: requireEnv('DB_PASSWORD'),
    },

    // --- BunnyCDN ---
    bunny: {
        storageZone: optionalEnv('BUNNY_STORAGE_ZONE', 'celebskin-media'),
        storageKey: requireEnv('BUNNY_STORAGE_KEY'),
        storageHost: optionalEnv('BUNNY_STORAGE_HOST', 'storage.bunnycdn.com'),
        cdnUrl: optionalEnv('BUNNY_CDN_URL', 'https://celebskin-cdn.b-cdn.net'),
    },

    // --- AI ---
    ai: {
        geminiApiKey: optionalEnv('GEMINI_API_KEY', ''),
        geminiModel: optionalEnv('GEMINI_MODEL', 'gemini-2.5-flash'),
        tmdbApiKey: optionalEnv('TMDB_API_KEY', ''),
    },

    // --- Pipeline ---
    pipeline: {
        scriptsDir: join(__dirname, '..'),
        tmpDir: join(__dirname, '..', 'tmp'),
        logDir: join(__dirname, '..', 'logs'),
        concurrency: parseInt(optionalEnv('PIPELINE_CONCURRENCY', '3')),
    },

    // --- Site ---
    siteUrl: optionalEnv('SITE_URL', 'https://celeb.skin'),

    // --- Logging ---
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
};

export default config;
