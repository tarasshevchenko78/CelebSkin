const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1', port: 5432, database: 'celebskin', user: 'celebskin', password: '35dwYElzsMhiXx7QabEy0Zen'
});
async function run() {
  const result = await pool.query(`
    WITH duplicates AS (
        SELECT title
        FROM movies
        GROUP BY title
        HAVING COUNT(*) > 1
    )
    SELECT m.id, m.title, m.slug, m.year
    FROM movies m
    JOIN duplicates d ON m.title = d.title
    ORDER BY m.title, m.id;
  `);
  console.log(JSON.stringify(result.rows, null, 2));
  process.exit(0);
}
run();
