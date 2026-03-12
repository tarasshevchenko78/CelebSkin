const { Pool } = require('pg');

const pool = new Pool({
    host: '127.0.0.1',
    port: 5432,
    database: 'celebskin',
    user: 'celebskin',
    password: '35dwYElzsMhiXx7QabEy0Zen'
});

async function run() {
    const result = await pool.query(`
    SELECT title, COUNT(*) as count, array_agg(id) as ids, array_agg(slug) as slugs, array_agg(tmdb_id) as tmdbs, array_agg(status) as statuses
    FROM movies
    GROUP BY title
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `);
    console.log("Duplicate movies by title:");
    console.log(JSON.stringify(result.rows, null, 2));
    process.exit(0);
}

run();
