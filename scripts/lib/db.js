// CelebSkin Pipeline DB Connector
// Connects to PostgreSQL on AbeloHost (remote)
import pg from "pg";
import { config } from "./config.js";
import { toTitleCase } from "./name-utils.js";

const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: 10,
  idleTimeoutMillis: 30000,
});

export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) {
    console.warn(`Slow query (${duration}ms):`, text.substring(0, 100));
  }
  return result;
}

export async function getClient() {
  return pool.connect();
}

// ============================================
// Raw Videos
// ============================================

export async function insertRawVideo(video) {
  const { rows } = await query(
    `INSERT INTO raw_videos
      (source_id, source_url, source_video_id, raw_title, raw_description,
       thumbnail_url, duration_seconds, raw_tags, raw_categories, raw_celebrities,
       embed_code, video_file_url, extra_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (source_url) DO UPDATE SET
       updated_at = NOW()
     RETURNING id`,
    [
      video.source_id, video.source_url, video.source_video_id,
      video.raw_title, video.raw_description, video.thumbnail_url,
      video.duration_seconds, video.raw_tags || [], video.raw_categories || [],
      video.raw_celebrities || [], video.embed_code, video.video_file_url,
      video.extra_data || {},
    ]
  );
  return rows[0]?.id || null;
}

export async function getPendingVideos(limit = 50) {
  const { rows } = await query(
    `UPDATE raw_videos
     SET status = 'processing', updated_at = NOW()
     WHERE id IN (
       SELECT id FROM raw_videos
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [limit]
  );
  return rows;
}

export async function markRawVideoProcessed(id) {
  await query(`UPDATE raw_videos SET status = 'processed' WHERE id = $1`, [id]);
}

export async function markRawVideoFailed(id, error) {
  await query(
    `UPDATE raw_videos SET status = 'failed', error_message = $2, retry_count = retry_count + 1 WHERE id = $1`,
    [id, error]
  );
}

// ============================================
// Videos (JSONB multilingual — 10 languages)
// ============================================

export async function insertVideo(video) {
  const { rows } = await query(
    `INSERT INTO videos
      (raw_video_id, title, slug, review, seo_title, seo_description,
       original_title, quality, duration_seconds, duration_formatted,
       video_url, thumbnail_url, ai_model, ai_confidence, ai_raw_response,
       status)
     VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
     ON CONFLICT (raw_video_id) DO UPDATE SET
       title = EXCLUDED.title,
       slug = EXCLUDED.slug,
       review = EXCLUDED.review,
       seo_title = EXCLUDED.seo_title,
       seo_description = EXCLUDED.seo_description,
       ai_model = EXCLUDED.ai_model,
       ai_confidence = EXCLUDED.ai_confidence,
       ai_raw_response = EXCLUDED.ai_raw_response,
       updated_at = NOW()
     RETURNING id`,
    [
      video.raw_video_id, video.title, video.slug,
      video.review, video.seo_title, video.seo_description,
      video.original_title, video.quality,
      video.duration_seconds, video.duration_formatted,
      video.video_url, video.thumbnail_url,
      video.ai_model, video.ai_confidence, video.ai_raw_response,
      video.status || "enriched",
    ]
  );
  return rows[0].id;
}

export async function publishVideo(id) {
  await query(
    `UPDATE videos SET status = 'published', published_at = NOW() WHERE id = $1`,
    [id]
  );
}

// ============================================
// Celebrities (was: actresses)
// ============================================

export async function findOrCreateCelebrity(name, slug) {
  const { rows } = await query(
    `INSERT INTO celebrities (name, slug)
     VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name, slug]
  );
  return rows[0].id;
}

export async function linkVideoCelebrity(videoId, celebrityId) {
  await query(
    `INSERT INTO video_celebrities (video_id, celebrity_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [videoId, celebrityId]
  );
}

export async function searchCelebrityFuzzy(name, threshold = 0.3) {
  const { rows } = await query(
    `SELECT id, name, slug, photo_url, videos_count,
            similarity(name, $1) AS sim
     FROM celebrities
     WHERE similarity(name, $1) > $2
        OR $1 = ANY(aliases)
     ORDER BY sim DESC
     LIMIT 5`,
    [name, threshold]
  );
  return rows;
}

export async function updateCelebrity(id, data) {
  const fields = [];
  const values = [id];
  let idx = 2;
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) { fields.push(`${key} = $${idx++}`); values.push(val); }
  }
  if (fields.length === 0) return;
  fields.push("updated_at = NOW()");
  await query(`UPDATE celebrities SET ${fields.join(", ")} WHERE id = $1`, values);
}

// ============================================
// Tags (JSONB multilingual)
// ============================================

export async function findOrCreateTag(name, slug, nameLocalized = null) {
  const { rows } = await query(
    `INSERT INTO tags (name, slug, name_localized)
     VALUES ($1, $2, COALESCE($3::jsonb, '{}'::jsonb))
     ON CONFLICT (slug) DO UPDATE SET
       name_localized = COALESCE(EXCLUDED.name_localized, tags.name_localized)
     RETURNING id`,
    [name, slug, nameLocalized ? JSON.stringify(nameLocalized) : null]
  );
  return rows[0].id;
}

export async function linkVideoTag(videoId, tagId) {
  await query(
    `INSERT INTO video_tags (video_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [videoId, tagId]
  );
}

// ============================================
// Categories
// ============================================

export async function findOrCreateCategory(name, slug) {
  const { rows } = await query(
    `INSERT INTO categories (name, slug)
     VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name, slug]
  );
  return rows[0].id;
}

export async function linkVideoCategory(videoId, categoryId) {
  await query(
    `INSERT INTO video_categories (video_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [videoId, categoryId]
  );
}

// ============================================
// Collections
// ============================================

export async function findOrCreateCollection(titleRaw, slug, localizedTitle = null) {
  const normalizedTitle = toTitleCase(titleRaw);
  const titleJson = localizedTitle
    ? JSON.stringify(localizedTitle)
    : JSON.stringify({ en: normalizedTitle, ru: normalizedTitle });
  const { rows } = await query(
    `INSERT INTO collections (title, slug, is_auto)
     VALUES ($1::jsonb, $2, true)
     ON CONFLICT (slug) DO UPDATE SET
       title = COALESCE(EXCLUDED.title, collections.title)
     RETURNING id`,
    [titleJson, slug]
  );
  return rows[0].id;
}

export async function linkVideoCollection(videoId, collectionId) {
  await query(
    `INSERT INTO collection_videos (video_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [videoId, collectionId]
  );
}

// ============================================
// Movies (JSONB multilingual)
// ============================================

export async function findOrCreateMovie(movie) {
  const { rows } = await query(
    `INSERT INTO movies (title, title_localized, slug, year, poster_url, description, studio, director, genres, ai_matched)
     VALUES ($1, COALESCE($2::jsonb, '{}'::jsonb), $3, $4, $5, COALESCE($6::jsonb, '{}'::jsonb), $7, $8, $9, $10)
     ON CONFLICT (slug) DO UPDATE SET
       title_localized = COALESCE(EXCLUDED.title_localized, movies.title_localized),
       year = COALESCE(EXCLUDED.year, movies.year),
       poster_url = COALESCE(EXCLUDED.poster_url, movies.poster_url),
       updated_at = NOW()
     RETURNING id`,
    [
      movie.title, movie.title_localized ? JSON.stringify(movie.title_localized) : null,
      movie.slug, movie.year || null, movie.poster_url || null,
      movie.description ? JSON.stringify(movie.description) : null,
      movie.studio || null, movie.director || null,
      movie.genres || [], movie.ai_matched || false,
    ]
  );
  return rows[0].id;
}

export async function linkMovieScene(movieId, videoId, sceneNumber = null) {
  await query(
    `INSERT INTO movie_scenes (movie_id, video_id, scene_number) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [movieId, videoId, sceneNumber]
  );
}

export async function linkMovieCelebrity(movieId, celebrityId, role = null) {
  await query(
    `INSERT INTO movie_celebrities (movie_id, celebrity_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [movieId, celebrityId, role]
  );
}

// ============================================
// Processing Log
// ============================================

export async function log(videoId, step, status, message, metadata = {}) {
  await query(
    `INSERT INTO processing_log (video_id, step, status, message, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [videoId, step, status, message, typeof metadata === 'string' ? metadata : JSON.stringify(metadata)]
  );
}

// ============================================
// Sources
// ============================================

export async function getActiveSource(name) {
  const { rows } = await query(
    `SELECT * FROM sources WHERE name = $1 AND is_active = true LIMIT 1`,
    [name]
  );
  return rows[0] || null;
}

export { pool };
export default { query, getClient, pool };
