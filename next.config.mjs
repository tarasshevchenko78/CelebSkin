/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'cdn.celeb.skin',
            },
            {
                protocol: 'https',
                hostname: 'celebskin-cdn.b-cdn.net',
            },
            {
                protocol: 'https',
                hostname: 'image.tmdb.org',
            },
        ],
    },
    async rewrites() {
        return [
            // IndexNow verification: /{key}.txt → /api/indexnow?key={key}
            {
                source: '/:key([a-f0-9]{32}).txt',
                destination: '/api/indexnow?key=:key',
            },
        ];
    },
    async headers() {
        return [
            {
                source: '/(.*)',
                headers: [
                    {
                        key: 'Content-Security-Policy',
                        value: [
                            "default-src 'self'",
                            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
                            "style-src 'self' 'unsafe-inline'",
                            "img-src 'self' data: blob: https://celebskin-cdn.b-cdn.net https://image.tmdb.org https://*.b-cdn.net",
                            "media-src 'self' https://celebskin-cdn.b-cdn.net https://*.b-cdn.net",
                            "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com",
                            "connect-src 'self' https://celebskin-cdn.b-cdn.net https://*.b-cdn.net",
                            "frame-ancestors 'none'",
                            "base-uri 'self'",
                            "form-action 'self'",
                        ].join('; '),
                    },
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
                    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
                    { key: 'X-XSS-Protection', value: '1; mode=block' },
                    { key: 'X-DNS-Prefetch-Control', value: 'on' },
                ],
            },
        ];
    },
};

export default nextConfig;
