import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createUser, findUserByUsername } from '@/lib/db/users';
import { signToken, makeAuthCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export async function POST(request: Request) {
    try {
        const { username, password } = await request.json().catch(() => ({}));

        if (!username || !USERNAME_RE.test(username)) {
            return NextResponse.json(
                { error: 'Username must be 3–20 characters: letters, numbers, underscore' },
                { status: 400 }
            );
        }
        if (!password || password.length < 6) {
            return NextResponse.json(
                { error: 'Password must be at least 6 characters' },
                { status: 400 }
            );
        }

        const existing = await findUserByUsername(username);
        if (existing) {
            return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
        }

        const hash = await bcrypt.hash(password, 10);
        const user = await createUser(username, hash);
        const token = signToken({ userId: user.id, username: user.username });

        return NextResponse.json(
            { user: { id: user.id, username: user.username } },
            { headers: { 'Set-Cookie': makeAuthCookie(token) } }
        );
    } catch (e) {
        console.error('Register error', e);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}
