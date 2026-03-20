import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { findUserByUsername } from '@/lib/db/users';
import { signToken, makeAuthCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const { username, password } = await request.json().catch(() => ({}));

        if (!username || !password) {
            return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
        }

        const user = await findUserByUsername(username);
        if (!user || !user.password_hash) {
            return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
        }

        const token = signToken({ userId: user.id, username: user.username });

        return NextResponse.json(
            { user: { id: user.id, username: user.username } },
            { headers: { 'Set-Cookie': makeAuthCookie(token) } }
        );
    } catch (e) {
        console.error('Login error', e);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}
