const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1', port: 5432, database: 'celebskin', user: 'celebskin', password: '35dwYElzsMhiXx7QabEy0Zen'
});
async function run() {
  const result = await pool.query(`
    SELECT title, COUNT(*) 
    FROM movies 
    GROUP BY title 
    HAVING COUNT(*) > 1;
  `);
  console.log('Exact dupes:', JSON.stringify(result.rows, null, 2));

  const result2 = await pool.query(`
    SELECT title FROM movies ORDER BY title ASC;
  `);
  console.log('All movies count:', result2.rows.length);
  process.exit(0);
}
run();
