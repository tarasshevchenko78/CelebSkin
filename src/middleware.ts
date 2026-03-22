import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SUPPORTED_LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];
const DEFAULT_LOCALE = 'en';

// Paths that should skip locale handling
const SKIP_LOCALE_PATHS = ['/admin', '/api', '/_next', '/favicon.ico', '/robots.txt', '/sitemap', '/video-sitemap', '/sitemaps'];

// ============================================
// Rate limiting (in-memory, per-IP)
// ============================================

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface AttemptRecord {
    count: number;
    firstAttempt: number;
}

const authAttempts = new Map<string, AttemptRecord>();

function getClientIp(request: NextRequest): string {
    return (
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        'unknown'
    );
}

function isRateLimited(ip: string): boolean {
    const record = authAttempts.get(ip);
    if (!record) return false;

    // Window expired — reset
    if (Date.now() - record.firstAttempt > WINDOW_MS) {
        authAttempts.delete(ip);
        return false;
    }

    return record.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
    const record = authAttempts.get(ip);
    const now = Date.now();

    if (!record || now - record.firstAttempt > WINDOW_MS) {
        authAttempts.set(ip, { count: 1, firstAttempt: now });
    } else {
        record.count++;
    }
}

function resetAttempts(ip: string): void {
    authAttempts.delete(ip);
}

// ============================================
// Constant-time string comparison (Edge-compatible)
// ============================================

function constantTimeEqual(a: string, b: string): boolean {
    const encoder = new TextEncoder();
    const bufA = encoder.encode(a);
    const bufB = encoder.encode(b);

    // Always compare max-length to avoid timing leak on length
    const maxLen = Math.max(bufA.length, bufB.length);
    let mismatch = bufA.length !== bufB.length ? 1 : 0;

    for (let i = 0; i < maxLen; i++) {
        mismatch |= (bufA[i % bufA.length] ?? 0) ^ (bufB[i % bufB.length] ?? 0);
    }

    return mismatch === 0;
}

// ============================================
// Auth
// ============================================

function detectLocaleFromHeader(acceptLanguage: string | null): string {
    if (!acceptLanguage) return DEFAULT_LOCALE;

    const languages = acceptLanguage
        .split(',')
        .map((part) => {
            const [lang, quality] = part.trim().split(';q=');
            return {
                lang: lang.trim().toLowerCase().split('-')[0],
                q: quality ? parseFloat(quality) : 1.0,
            };
        })
        .sort((a, b) => b.q - a.q);

    for (const { lang } of languages) {
        if (SUPPORTED_LOCALES.includes(lang)) {
            return lang;
        }
    }

    return DEFAULT_LOCALE;
}

function checkBasicAuth(request: NextRequest): boolean {
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD;

    // Fail-closed: no password configured → block everything
    if (!adminPassword) {
        console.error('[Auth] ADMIN_PASSWORD not set — blocking all admin access');
        return false;
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Basic ')) return false;

    try {
        const base64 = authHeader.slice(6);
        const decoded = atob(base64);
        // Use indexOf instead of split to handle passwords containing colons
        const colonIdx = decoded.indexOf(':');
        if (colonIdx === -1) return false;

        const user = decoded.substring(0, colonIdx);
        const password = decoded.substring(colonIdx + 1);

        return constantTimeEqual(user, adminUser) && constantTimeEqual(password, adminPassword);
    } catch {
        return false;
    }
}

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Skip locale handling for specific paths
    if (SKIP_LOCALE_PATHS.some((path) => pathname.startsWith(path))) {
        // Admin routes (both /admin and /api/admin): require Basic Auth
        if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
            const clientIp = getClientIp(request);

            // Rate limit check BEFORE auth
            if (isRateLimited(clientIp)) {
                const record = authAttempts.get(clientIp)!;
                const retryAfter = Math.ceil((WINDOW_MS - (Date.now() - record.firstAttempt)) / 1000);
                return new NextResponse('Too many authentication attempts. Try again later.', {
                    status: 429,
                    headers: {
                        'Retry-After': String(retryAfter),
                    },
                });
            }

            if (!checkBasicAuth(request)) {
                recordFailedAttempt(clientIp);
                return new NextResponse('Authentication required', {
                    status: 401,
                    headers: {
                        'WWW-Authenticate': 'Basic realm="CelebSkin Admin"',
                    },
                });
            }

            // Auth success — reset counter
            resetAttempts(clientIp);
        }
        return NextResponse.next();
    }

    // Check if URL already has a locale prefix
    const segments = pathname.split('/');
    const firstSegment = segments[1]; // e.g., 'en', 'ru', etc.

    if (SUPPORTED_LOCALES.includes(firstSegment)) {
        // Valid locale in URL, continue
        return NextResponse.next();
    }

    // No locale in URL → detect from Accept-Language → redirect
    const detectedLocale = detectLocaleFromHeader(
        request.headers.get('accept-language')
    );

    const url = request.nextUrl.clone();
    url.pathname = `/${detectedLocale}${pathname}`;

    return NextResponse.redirect(url);
}

export const config = {
    matcher: [
        // Match all paths except static files
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
    ],
};
