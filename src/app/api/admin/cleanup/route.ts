import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — preview what will be cleaned (dry run)
export async function GET() {
    try {
        const [orphanedMovies, orphanedMovieCelebs, stats] = await Promise.all([
            // Movies with no video scenes linked
            pool.query(`
                SELECT m.id, m.title, m.slug, m.year, m.poster_url, m.tmdb_id,
                       (SELECT COUNT(*) FROM movie_celebrities mc WHERE mc.movie_id = m.id) AS celeb_count
                FROM movies m
                WHERE NOT EXISTS (
                    SELECT 1 FROM movie_scenes ms WHERE ms.movie_id = m.id
                )
                ORDER BY m.title
            `),
            // movie_celebrities for orphaned movies
            pool.query(`
                SELECT COUNT(*) AS total
                FROM movie_celebrities mc
                WHERE NOT EXISTS (
                    SELECT 1 FROM movie_scenes ms WHERE ms.movie_id = mc.movie_id
                )
            `),
            // Overall counts
            pool.query(`
                SELECT
                    (SELECT COUNT(*) FROM movies) AS total_movies,
                    (SELECT COUNT(DISTINCT movie_id) FROM movie_scenes) AS movies_with_scenes,
                    (SELECT COUNT(*) FROM movie_celebrities) AS total_movie_celebs
            `),
        ]);

        return NextResponse.json({
            orphanedMovies: orphanedMovies.rows,
            orphanedMoviesCount: orphanedMovies.rows.length,
            orphanedMovieCelebsCount: parseInt(orphanedMovieCelebs.rows[0].total),
            stats: stats.rows[0],
        });
    } catch (error) {
        console.error('[Cleanup API] GET error:', error);
        return NextResponse.json({ error: 'Failed to analyze' }, { status: 500 });
    }
}

// POST — execute cleanup
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { action } = body as { action: string };

        if (action === 'remove-orphaned-movies') {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Delete movie_celebrities for orphaned movies
                const mcResult = await client.query(`
                    DELETE FROM movie_celebrities
                    WHERE movie_id IN (
                        SELECT m.id FROM movies m
                        WHERE NOT EXISTS (
                            SELECT 1 FROM movie_scenes ms WHERE ms.movie_id = m.id
                        )
                    )
                `);

                // Delete orphaned movies themselves
                const mResult = await client.query(`
                    DELETE FROM movies
                    WHERE NOT EXISTS (
                        SELECT 1 FROM movie_scenes ms WHERE ms.movie_id = movies.id
                    )
                    RETURNING id, title
                `);

                // Reset movies_count on celebrities
                await client.query(`
                    UPDATE celebrities SET movies_count = (
                        SELECT COUNT(DISTINCT mc.movie_id)
                        FROM movie_celebrities mc
                        WHERE mc.celebrity_id = celebrities.id
                    )
                `);

                await client.query('COMMIT');

                // Log the cleanup
                await pool.query(
                    `INSERT INTO processing_log (step, status, metadata) VALUES ($1, $2, $3::jsonb)`,
                    [
                        'admin:cleanup',
                        'completed',
                        JSON.stringify({
                            action: 'remove-orphaned-movies',
                            deletedMovies: mResult.rowCount,
                            deletedMovieCelebs: mcResult.rowCount,
                            cleanedAt: new Date().toISOString(),
                        }),
                    ]
                );

                return NextResponse.json({
                    success: true,
                    deletedMovies: mResult.rowCount,
                    deletedMovieCelebs: mcResult.rowCount,
                    deletedTitles: mResult.rows.map((r: { title: string }) => r.title),
                });
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        }

        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    } catch (error) {
        console.error('[Cleanup API] POST error:', error);
        return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
    }
}
