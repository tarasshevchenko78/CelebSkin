import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';
import { findUserById, updatePassword } from '@/lib/db/users';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const session = getSessionUser(request);
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { currentPassword, newPassword } = await request.json().catch(() => ({}));
        if (!currentPassword || !newPassword || newPassword.length < 6) {
            return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 });
        }

        const user = await findUserById(session.userId);
        if (!user || !user.password_hash) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });

        const hash = await bcrypt.hash(newPassword, 10);
        await updatePassword(session.userId, hash);

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}
