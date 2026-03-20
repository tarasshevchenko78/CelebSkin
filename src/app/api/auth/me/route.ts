import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const user = getSessionUser(request);
    if (!user) {
        return NextResponse.json({ user: null });
    }
    return NextResponse.json({ user: { id: user.userId, username: user.username } });
}
