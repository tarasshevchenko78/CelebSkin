import { query, pool } from './lib/db.js';
import { config } from './lib/config.js';
import axios from 'axios';

let GEMINI_KEYS = [];
let _gIdx = 0;

async function loadKeys() {
  const { rows } = await query(`SELECT value FROM settings WHERE key = 'gemini_api_key' LIMIT 1`);
  if (rows[0]?.value) GEMINI_KEYS = rows[0].value.split(',').map(k => k.trim()).filter(Boolean);
  console.log(`Gemini keys: ${GEMINI_KEYS.length}`);
}

async function gemini(prompt) {
  const key = GEMINI_KEYS[_gIdx++ % GEMINI_KEYS.length];
  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 256, temperature: 0.1 } },
      { timeout: 15000 }
    );
    return (res.data?.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  } catch (e) { console.warn(`  Gemini error: ${e.message}`); return ''; }
}

async function main() {
  await loadKeys();

  // Fix celebrities
  const { rows: celebs } = await query(`SELECT id, name, slug FROM celebrities WHERE status='published' AND name ~ '[а-яА-ЯёЁ]' ORDER BY videos_count DESC`);
  console.log(`\n=== Celebrities: ${celebs.length} with Russian names ===`);
  
  for (const c of celebs) {
    const enName = await gemini(
      `This is a celebrity/actress name in Russian: "${c.name}"\n` +
      `Return ONLY the original English/Latin spelling of this name. ` +
      `If this person is Russian/Ukrainian and has no established English name, transliterate to Latin script (e.g. Юлия Старикова → Yulia Starikova). ` +
      `Return ONLY the name, nothing else.`
    );
    if (!enName || enName.length > 100 || enName.includes('\n')) {
      console.log(`  SKIP: ${c.name} → bad response: "${enName}"`);
      continue;
    }
    console.log(`  ${c.name} → ${enName}`);
    
    // Update name but NOT slug (keep existing slug)
    await query(`UPDATE celebrities SET name = $1, updated_at = NOW() WHERE id = $2`, [enName, c.id]);
    
    // Also update name_localized.en if empty
    await query(`UPDATE celebrities SET name_localized = jsonb_set(COALESCE(name_localized, '{}'), '{en}', to_jsonb($1::text)) WHERE id = $2 AND (name_localized IS NULL OR name_localized->>'en' IS NULL OR name_localized->>'en' = '')`, [enName, c.id]);
    
    await new Promise(r => setTimeout(r, 1100));
  }

  // Fix movies
  const { rows: movies } = await query(`SELECT id, title, slug, year FROM movies WHERE status='published' AND title ~ '[а-яА-ЯёЁ]' ORDER BY scenes_count DESC`);
  console.log(`\n=== Movies: ${movies.length} with Russian titles ===`);
  
  for (const m of movies) {
    const enTitle = await gemini(
      `This is a movie/TV show title in Russian: "${m.title}"${m.year ? ` (${m.year})` : ''}\n` +
      `Return ONLY the original English title if this is a known international production. ` +
      `If this is a Russian/Ukrainian production with no official English title, transliterate to Latin script (e.g. Пятая стража → Pyataya Strazha). ` +
      `Return ONLY the title, nothing else.`
    );
    if (!enTitle || enTitle.length > 200 || enTitle.includes('\n')) {
      console.log(`  SKIP: ${m.title} → bad response: "${enTitle}"`);
      continue;
    }
    console.log(`  ${m.title} → ${enTitle}`);
    
    // Update title but NOT slug
    await query(`UPDATE movies SET title = $1, updated_at = NOW() WHERE id = $2`, [enTitle, m.id]);
    
    // Also update title_localized.en if empty
    await query(`UPDATE movies SET title_localized = jsonb_set(COALESCE(title_localized, '{}'), '{en}', to_jsonb($1::text)) WHERE id = $2 AND (title_localized IS NULL OR title_localized->>'en' IS NULL OR title_localized->>'en' = '')`, [enTitle, m.id]);
    
    await new Promise(r => setTimeout(r, 1100));
  }

  // Verify
  const { rows: [rc] } = await query(`SELECT COUNT(*) as cnt FROM celebrities WHERE status='published' AND name ~ '[а-яА-ЯёЁ]'`);
  const { rows: [rm] } = await query(`SELECT COUNT(*) as cnt FROM movies WHERE status='published' AND title ~ '[а-яА-ЯёЁ]'`);
  console.log(`\nRemaining: ${rc.cnt} celebs, ${rm.cnt} movies with Russian names`);
  
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
