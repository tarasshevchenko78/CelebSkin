import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';

const JWT_SECRET = process.env.AUTH_JWT_SECRET || 'fallback-dev-secret-change-in-prod';
const COOKIE_NAME = 'cs_token';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export interface AuthPayload {
    userId: string;
    username: string;
}

export function signToken(payload: AuthPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token: string): AuthPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as AuthPayload;
    } catch {
        return null;
    }
}

// Read auth cookie and return session user (for server components / API routes)
export function getSessionUser(request?: Request): AuthPayload | null {
    try {
        let token: string | undefined;
        if (request) {
            // API route — read from request headers
            const cookieHeader = request.headers.get('cookie') || '';
            const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
            token = match?.[1];
        } else {
            // Server component — use next/headers
            const store = cookies();
            token = store.get(COOKIE_NAME)?.value;
        }
        if (!token) return null;
        return verifyToken(token);
    } catch {
        return null;
    }
}

export function makeAuthCookie(token: string): string {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return `${COOKIE_NAME}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

export function makeClearCookie(): string {
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

// Compute user-stable fingerprint for video_votes
export function userFingerprint(userId: string): string {
    return createHash('sha256').update(`user:${userId}`).digest('hex');
}
