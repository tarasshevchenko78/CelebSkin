const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1', port: 5432, database: 'celebskin', user: 'celebskin', password: '35dwYElzsMhiXx7QabEy0Zen'
});
async function run() {
  const result = await pool.query(`
    SELECT step, status, metadata, created_at 
    FROM processing_log 
    WHERE video_id = '2d70b819-570b-492f-9e3d-d94f4b047bf9'
    ORDER BY created_at ASC;
  `);
  console.log(JSON.stringify(result.rows, null, 2));
  process.exit(0);
}
run();
