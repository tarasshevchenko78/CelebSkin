-- 003_add_indexes.sql — Performance indexes for common queries
-- Applied: Step 2.3
--
-- Skipped (already exist):
--   idx_videos_status          — btree on videos(status)
--   idx_videos_published       — btree on videos(published_at DESC) WHERE status='published'
--   idx_pipeline_failures_unresolved — from 002 migration
--   celebrities slug indexes   — slug is VARCHAR with UNIQUE + btree + trigram
--   pg_trgm extension          — already installed

-- ============================================
-- Videos: JSONB slug expression indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_videos_slug_en
    ON videos ((slug->>'en'));

CREATE INDEX IF NOT EXISTS idx_videos_slug_ru
    ON videos ((slug->>'ru'));

-- ============================================
-- Videos: published listing by created_at
-- (different from existing idx_videos_published which uses published_at)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_videos_published_date
    ON videos (created_at DESC)
    WHERE status = 'published';

-- ============================================
-- Videos: full-text search on original_title
-- ============================================
CREATE INDEX IF NOT EXISTS idx_videos_original_title_trgm
    ON videos USING gin (original_title gin_trgm_ops);

-- ============================================
-- Junction tables: individual column indexes
-- (composite PKs exist but no single-column indexes)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_video_celebrities_video
    ON video_celebrities (video_id);

CREATE INDEX IF NOT EXISTS idx_video_celebrities_celeb
    ON video_celebrities (celebrity_id);

CREATE INDEX IF NOT EXISTS idx_movie_scenes_movie
    ON movie_scenes (movie_id);

CREATE INDEX IF NOT EXISTS idx_movie_scenes_video
    ON movie_scenes (video_id);

CREATE INDEX IF NOT EXISTS idx_video_tags_video
    ON video_tags (video_id);

CREATE INDEX IF NOT EXISTS idx_video_tags_tag
    ON video_tags (tag_id);
