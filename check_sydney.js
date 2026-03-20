const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1', port: 5432, database: 'celebskin', user: 'celebskin', password: '35dwYElzsMhiXx7QabEy0Zen'
});
async function run() {
  const result = await pool.query(`
    SELECT id, title, thumbnail_url, screenshots 
    FROM videos 
    ORDER BY created_at DESC LIMIT 5;
  `);
  console.log(JSON.stringify(result.rows, null, 2));
  process.exit(0);
}
run();
