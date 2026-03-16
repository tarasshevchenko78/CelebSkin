import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

function getFingerprint(request: Request): string {
    const ip =
        request.headers.get('x-real-ip') ||
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        'unknown';
    const ua = request.headers.get('user-agent') || 'unknown';
    return createHash('sha256').update(`${ip}:${ua}`).digest('hex');
}

// GET /api/videos/:id/like — return current vote + live counts (bypasses page cache)
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const fp = getFingerprint(request);
        const [voteRes, countsRes] = await Promise.all([
            pool.query(
                `SELECT vote_type FROM video_votes WHERE video_id = $1 AND fingerprint = $2`,
                [id, fp]
            ),
            pool.query(
                `SELECT likes_count, dislikes_count FROM videos WHERE id = $1`,
                [id]
            ),
        ]);
        return NextResponse.json({
            userVote: voteRes.rows[0]?.vote_type ?? null,
            likes: countsRes.rows[0]?.likes_count ?? null,
            dislikes: countsRes.rows[0]?.dislikes_count ?? null,
        });
    } catch {
        return NextResponse.json({ userVote: null, likes: null, dislikes: null });
    }
}

// POST /api/videos/:id/like — cast, toggle, or switch vote
// Body: { action: 'like' | 'dislike' }
// Returns: { likes, dislikes, userVote: 'like' | 'dislike' | null }
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!id || id.length < 8) {
            return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
        }

        const body = await request.json().catch(() => ({}));
        const action = body.action as string;
        if (action !== 'like' && action !== 'dislike') {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }

        const fp = getFingerprint(request);

        // Check existing vote
        const { rows: existing } = await pool.query(
            `SELECT vote_type FROM video_votes WHERE video_id = $1 AND fingerprint = $2`,
            [id, fp]
        );
        const currentVote = existing[0]?.vote_type as 'like' | 'dislike' | undefined;

        let userVote: 'like' | 'dislike' | null;

        if (!currentVote) {
            // New vote
            await pool.query(
                `INSERT INTO video_votes (video_id, fingerprint, vote_type) VALUES ($1, $2, $3)`,
                [id, fp, action]
            );
            if (action === 'like') {
                await pool.query(
                    `UPDATE videos SET likes_count = likes_count + 1, updated_at = NOW() WHERE id = $1 AND status = 'published'`,
                    [id]
                );
            } else {
                await pool.query(
                    `UPDATE videos SET dislikes_count = dislikes_count + 1, updated_at = NOW() WHERE id = $1 AND status = 'published'`,
                    [id]
                );
            }
            userVote = action;
        } else if (currentVote === action) {
            // Toggle off — same vote clicked again
            await pool.query(
                `DELETE FROM video_votes WHERE video_id = $1 AND fingerprint = $2`,
                [id, fp]
            );
            if (action === 'like') {
                await pool.query(
                    `UPDATE videos SET likes_count = GREATEST(0, likes_count - 1), updated_at = NOW() WHERE id = $1 AND status = 'published'`,
                    [id]
                );
            } else {
                await pool.query(
                    `UPDATE videos SET dislikes_count = GREATEST(0, dislikes_count - 1), updated_at = NOW() WHERE id = $1 AND status = 'published'`,
                    [id]
                );
            }
            userVote = null;
        } else {
            // Switch vote — flip like↔dislike
            await pool.query(
                `UPDATE video_votes SET vote_type = $3 WHERE video_id = $1 AND fingerprint = $2`,
                [id, fp, action]
            );
            if (action === 'like') {
                await pool.query(
                    `UPDATE videos SET likes_count = likes_count + 1, dislikes_count = GREATEST(0, dislikes_count - 1), updated_at = NOW() WHERE id = $1 AND status = 'published'`,
                    [id]
                );
            } else {
                await pool.query(
                    `UPDATE videos SET dislikes_count = dislikes_count + 1, likes_count = GREATEST(0, likes_count - 1), updated_at = NOW() WHERE id = $1 AND status = 'published'`,
                    [id]
                );
            }
            userVote = action;
        }

        const { rows } = await pool.query(
            `SELECT likes_count, dislikes_count FROM videos WHERE id = $1`,
            [id]
        );
        if (rows.length === 0) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        return NextResponse.json({
            likes: rows[0].likes_count,
            dislikes: rows[0].dislikes_count,
            userVote,
        });
    } catch {
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}
