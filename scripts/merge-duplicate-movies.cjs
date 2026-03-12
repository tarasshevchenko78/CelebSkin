const { Pool } = require('pg');

const pool = new Pool({
    host: '127.0.0.1',
    port: 5432,
    database: 'celebskin',
    user: 'celebskin',
    password: '35dwYElzsMhiXx7QabEy0Zen'
});

async function main() {
    console.log('Starting duplicate movies merge...');

    // Find duplicates grouped by title
    const res = await pool.query(`
        SELECT title, array_agg(id) as ids
        FROM movies
        GROUP BY title
        HAVING COUNT(*) > 1
    `);

    const duplicates = res.rows;
    console.log(`Found ${duplicates.length} movies with duplicates.`);

    for (const dup of duplicates) {
        const ids = dup.ids.map(id => parseInt(id)).sort((a, b) => a - b);
        const keepId = ids[0];
        const removeIds = ids.slice(1);

        console.log(`Title: "${dup.title}". Keeping ID ${keepId}, merging/removing IDs: ${removeIds.join(', ')}`);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (const rId of removeIds) {
                // 1. Merge movie_celebrities
                const mcRes = await client.query('SELECT celebrity_id FROM movie_celebrities WHERE movie_id = $1', [rId]);
                for (const row of mcRes.rows) {
                    await client.query(`
                        INSERT INTO movie_celebrities (movie_id, celebrity_id)
                        VALUES ($1, $2)
                        ON CONFLICT DO NOTHING
                    `, [keepId, row.celebrity_id]);
                }

                // 2. Merge movie_scenes
                const msRes = await client.query('SELECT video_id FROM movie_scenes WHERE movie_id = $1', [rId]);
                for (const row of msRes.rows) {
                    await client.query(`
                        INSERT INTO movie_scenes (movie_id, video_id)
                        VALUES ($1, $2)
                        ON CONFLICT DO NOTHING
                    `, [keepId, row.video_id]);
                }

                // 3. Update imported records that matched the old movie
                await client.query('UPDATE xcadr_imports SET matched_movie_id = $1 WHERE matched_movie_id = $2', [keepId, rId]);

                // 4. Delete old movie associations
                await client.query('DELETE FROM movie_celebrities WHERE movie_id = $1', [rId]);
                await client.query('DELETE FROM movie_scenes WHERE movie_id = $1', [rId]);

                // 5. Delete the duplicate movie
                await client.query('DELETE FROM movies WHERE id = $1', [rId]);
            }

            // 6. Update cached counts
            await client.query(`
                UPDATE movies 
                SET scenes_count = (SELECT COUNT(*) FROM movie_scenes WHERE movie_id = $1)
                WHERE id = $1
            `, [keepId]);

            await client.query('COMMIT');
            console.log(`Successfully merged into ${keepId}`);
        } catch (e) {
            await client.query('ROLLBACK');
            console.error(`Error merging ${dup.title}:`, e);
        } finally {
            client.release();
        }
    }

    console.log('Merge complete!');
    process.exit(0);
}

main();
