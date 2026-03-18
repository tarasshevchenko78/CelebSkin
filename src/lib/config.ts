// Centralized, typed configuration for CelebSkin
// Validates required env vars at startup, separates public/private config

// ============================================
// Validation helper
// ============================================

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `[Config] Missing required environment variable: ${name}. ` +
            `Check your .env.local file.`
        );
    }
    return value;
}

function optionalEnv(name: string, fallback: string): string {
    return process.env[name] || fallback;
}

// ============================================
// Public config (safe to expose to client/SSR)
// ============================================

export const publicConfig = {
    siteUrl: optionalEnv('NEXT_PUBLIC_SITE_URL', 'https://celeb.skin'),
    cdnUrl: optionalEnv('BUNNY_CDN_URL', 'https://celebskin-cdn.b-cdn.net'),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    port: parseInt(optionalEnv('PORT', '3000')),
} as const;

// ============================================
// Private config (server-only, secrets)
// ============================================

export const config = {
    // --- Public (re-exported for convenience) ---
    ...publicConfig,

    // --- Database ---
    db: {
        host: optionalEnv('DB_HOST', '127.0.0.1'),
        port: parseInt(optionalEnv('DB_PORT', '5432')),
        name: optionalEnv('DB_NAME', 'celebskin'),
        user: optionalEnv('DB_USER', 'celebskin'),
        password: requireEnv('DB_PASSWORD'),
    },

    // --- Redis ---
    redis: {
        host: optionalEnv('REDIS_HOST', '127.0.0.1'),
        port: parseInt(optionalEnv('REDIS_PORT', '6379')),
        password: optionalEnv('REDIS_PASSWORD', ''),
    },

    // --- Admin ---
    admin: {
        user: optionalEnv('ADMIN_USER', 'admin'),
        password: requireEnv('ADMIN_PASSWORD'),
    },

    // --- BunnyCDN ---
    bunny: {
        storageZone: optionalEnv('BUNNY_STORAGE_ZONE', 'celebskin-media'),
        storageKey: requireEnv('BUNNY_STORAGE_KEY'),
        storageHost: optionalEnv('BUNNY_STORAGE_HOST', 'storage.bunnycdn.com'),
        cdnUrl: optionalEnv('BUNNY_CDN_URL', 'https://celebskin-cdn.b-cdn.net'),
    },

    // --- AI / External APIs ---
    geminiApiKey: optionalEnv('GEMINI_API_KEY', ''),
    geminiModel: optionalEnv('GEMINI_MODEL', 'gemini-2.5-flash'),
    tmdbApiKey: optionalEnv('TMDB_API_KEY', ''),
    elevenLabsApiKey: optionalEnv('ELEVENLABS_API_KEY', ''),

    // --- Telegram (optional) ---
    telegram: {
        botToken: optionalEnv('TELEGRAM_BOT_TOKEN', ''),
        channelId: optionalEnv('TELEGRAM_CHANNEL_ID', ''),
    },

    // --- IndexNow (optional, for search engine URL submission) ---
    indexNowKey: optionalEnv('INDEXNOW_KEY', ''),

    // --- Contabo (pipeline server) ---
    contabo: {
        host: 'root@161.97.142.117',
        sshKey: '/root/.ssh/id_ed25519',
    },
} as const;

// ============================================
// Type exports
// ============================================

export type AppConfig = typeof config;
export type PublicConfig = typeof publicConfig;
