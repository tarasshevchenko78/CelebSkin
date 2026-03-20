const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1', port: 5432, database: 'celebskin', user: 'celebskin', password: '35dwYElzsMhiXx7QabEy0Zen'
});
async function run() {
  const result = await pool.query(`
    SELECT step, status, metadata, created_at 
    FROM processing_log 
    WHERE video_id = '2d70b819-33aa-4481-9b7e-967a5b3a4a9c'
    ORDER BY created_at ASC;
  `);
  console.log(JSON.stringify(result.rows, null, 2));
  process.exit(0);
}
run();
