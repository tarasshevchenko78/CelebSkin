import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SUPPORTED_LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];
const DEFAULT_LOCALE = 'en';

// Paths that should skip locale handling
const SKIP_LOCALE_PATHS = ['/admin', '/api', '/_next', '/favicon.ico', '/robots.txt', '/sitemap'];

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
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Basic ')) return false;

    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || '';

    try {
        const base64 = authHeader.slice(6);
        const decoded = atob(base64);
        const [user, password] = decoded.split(':');
        return user === adminUser && password === adminPassword;
    } catch {
        return false;
    }
}

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Skip locale handling for specific paths
    if (SKIP_LOCALE_PATHS.some((path) => pathname.startsWith(path))) {
        // Admin routes: require Basic Auth
        if (pathname.startsWith('/admin')) {
            if (!checkBasicAuth(request)) {
                return new NextResponse('Authentication required', {
                    status: 401,
                    headers: {
                        'WWW-Authenticate': 'Basic realm="CelebSkin Admin"',
                    },
                });
            }
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
