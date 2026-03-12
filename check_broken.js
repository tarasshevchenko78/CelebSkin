const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1', port: 5432, database: 'celebskin', user: 'celebskin', password: '35dwYElzsMhiXx7QabEy0Zen'
});
async function run() {
  const result = await pool.query(`
    SELECT id, title_en, title_ru, screenshot_urls 
    FROM xcadr_imports 
    WHERE title_en ILIKE '%Never Find Me%' OR title_ru ILIKE '%Never Find Me%' OR title_en ILIKE '%Jordan Cowan%' OR title_ru ILIKE '%Jordan Cowan%';
  `);
  console.log(JSON.stringify(result.rows, null, 2));
  process.exit(0);
}
run();
