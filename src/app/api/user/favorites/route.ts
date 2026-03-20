import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { addFavorite, removeFavorite, getUserFavoriteIds, isFavorite } from '@/lib/db/users';

export const dynamic = 'force-dynamic';

// GET /api/user/favorites?type=video|celebrity&id=... (optional id for single-item check)
// GET /api/user/favorites — returns all favorite ids
export async function GET(request: Request) {
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as 'video' | 'celebrity' | null;
    const id = searchParams.get('id');

    if (type && id) {
        const fav = await isFavorite(user.userId, type, id);
        return NextResponse.json({ favorite: fav });
    }

    const ids = await getUserFavoriteIds(user.userId);
    return NextResponse.json(ids);
}

// POST /api/user/favorites — { item_type, item_id }
export async function POST(request: Request) {
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { item_type, item_id } = await request.json().catch(() => ({}));
    if ((item_type !== 'video' && item_type !== 'celebrity') || !item_id) {
        return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
    }

    await addFavorite(user.userId, item_type, item_id);
    return NextResponse.json({ ok: true, favorite: true });
}

// DELETE /api/user/favorites — { item_type, item_id }
export async function DELETE(request: Request) {
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { item_type, item_id } = await request.json().catch(() => ({}));
    if ((item_type !== 'video' && item_type !== 'celebrity') || !item_id) {
        return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
    }

    await removeFavorite(user.userId, item_type, item_id);
    return NextResponse.json({ ok: true, favorite: false });
}
