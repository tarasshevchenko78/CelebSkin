-- ============================================================
-- Migration 012: Pipeline v2.0
-- Date: 2026-03-15
-- Spec: /opt/celebskin/PIPELINE_V2_SPEC.md (УТВЕРЖДЕНО)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. VIDEOS: new columns for AI Vision + pipeline tracking
-- ============================================================

-- ai_vision_status: tracks whether AI vision analysis was done
ALTER TABLE videos ADD COLUMN IF NOT EXISTS ai_vision_status VARCHAR(20) DEFAULT NULL;

-- Only add CHECK if column was just created (no existing constraint)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'videos_ai_vision_status_check'
  ) THEN
    ALTER TABLE videos ADD CONSTRAINT videos_ai_vision_status_check
      CHECK (ai_vision_status IS NULL OR ai_vision_status IN ('pending', 'completed', 'censored', 'failed'));
  END IF;
END $$;

-- ai_vision_model: which Gemini model was used
ALTER TABLE videos ADD COLUMN IF NOT EXISTS ai_vision_model VARCHAR(100) DEFAULT NULL;

-- hot_moments already exists (migration 011), skip
-- ALTER TABLE videos ADD COLUMN IF NOT EXISTS hot_moments JSONB DEFAULT NULL;

-- best_thumbnail_sec: AI-chosen best screenshot timestamp
ALTER TABLE videos ADD COLUMN IF NOT EXISTS best_thumbnail_sec INTEGER DEFAULT NULL;

-- preview_start_sec: AI-chosen preview clip start
ALTER TABLE videos ADD COLUMN IF NOT EXISTS preview_start_sec INTEGER DEFAULT NULL;

-- donor_tags: raw tags from donor site before mapping
ALTER TABLE videos ADD COLUMN IF NOT EXISTS donor_tags TEXT[] DEFAULT NULL;

-- pipeline_step: current step in v2 pipeline (for monitoring/resume)
ALTER TABLE videos ADD COLUMN IF NOT EXISTS pipeline_step VARCHAR(30) DEFAULT NULL;

-- pipeline_error: last error message if step failed
ALTER TABLE videos ADD COLUMN IF NOT EXISTS pipeline_error TEXT DEFAULT NULL;

-- ============================================================
-- 2. VIDEOS: update status CHECK constraint for v2 statuses
-- ============================================================

-- Drop old constraint and recreate with new statuses
ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_status_check;
ALTER TABLE videos ADD CONSTRAINT videos_status_check CHECK (
  status IN (
    -- Legacy statuses (keep for compatibility)
    'new', 'processing', 'watermarked', 'enriched',
    'auto_recognized', 'needs_review', 'unknown_with_suggestions',
    'published', 'rejected', 'dmca_removed',
    -- Pipeline v2 statuses
    'downloading', 'downloaded', 'tmdb_enriching', 'tmdb_enriched',
    'ai_analyzing', 'ai_analyzed',
    'watermarking', 'media_generating', 'media_generated',
    'cdn_uploading', 'cdn_uploaded',
    'publishing', 'failed',
    -- Draft
    'draft'
  )
);

-- ============================================================
-- 3. CELEBRITIES: nationality → VARCHAR(2) for ISO codes
-- ============================================================

-- Column already exists as VARCHAR(100), alter to VARCHAR(2) if no data would be lost
-- Safe approach: add new column, keep old for now
-- Actually: existing data may have full country names.
-- Spec says VARCHAR(2) but existing column is VARCHAR(100) with possible data.
-- Keep VARCHAR(100) — it's already there and works. Pipeline v2 will write ISO codes.

-- ============================================================
-- 4. MOVIES: add countries array
-- ============================================================

ALTER TABLE movies ADD COLUMN IF NOT EXISTS countries VARCHAR(2)[] DEFAULT NULL;

-- ============================================================
-- 5. TAG_MAPPING table
-- ============================================================

CREATE TABLE IF NOT EXISTS tag_mapping (
  id SERIAL PRIMARY KEY,
  donor_tag VARCHAR(100) NOT NULL,
  our_tag_slug VARCHAR(100) NOT NULL,
  donor_source VARCHAR(50) DEFAULT 'boobsradar',
  UNIQUE(donor_tag, donor_source)
);

-- Populate all mappings from spec + supplements
INSERT INTO tag_mapping (donor_tag, our_tag_slug) VALUES
  -- Nudity levels
  ('nude', 'nude'), ('naked', 'nude'),
  ('topless', 'topless'), ('tits', 'topless'), ('boobs', 'topless'), ('breasts', 'topless'),
  ('full frontal', 'full-frontal'), ('pussy', 'full-frontal'), ('frontal', 'full-frontal'),
  ('bush', 'bush'), ('pubic', 'bush'), ('hairy', 'bush'),
  ('ass', 'butt'), ('butt', 'butt'), ('booty', 'butt'), ('behind', 'butt'),
  ('cleavage', 'cleavage'), ('sideboob', 'cleavage'),
  ('sexy', 'sexy'), ('hot', 'sexy'), ('seductive', 'sexy'),
  ('bikini', 'bikini'), ('swimsuit', 'bikini'), ('swimwear', 'bikini'),
  ('lingerie', 'lingerie'), ('underwear', 'lingerie'), ('bra', 'lingerie'),
  ('panties', 'lingerie'), ('thong', 'lingerie'), ('corset', 'lingerie'), ('stockings', 'lingerie'),
  -- Scene types
  ('sex scene', 'sex-scene'), ('sex', 'sex-scene'), ('fucking', 'sex-scene'), ('intercourse', 'sex-scene'),
  ('explicit', 'explicit'), ('unsimulated', 'explicit'), ('real sex', 'explicit'), ('hardcore', 'explicit'),
  ('oral', 'oral'), ('cunnilingus', 'oral'),
  ('blowjob', 'blowjob'), ('bj', 'blowjob'), ('fellatio', 'blowjob'),
  ('lesbian', 'lesbian'), ('girl on girl', 'lesbian'),
  ('masturbation', 'masturbation'), ('solo', 'masturbation'),
  ('shower', 'shower'), ('bath', 'shower'), ('bathtub', 'shower'),
  ('striptease', 'striptease'), ('strip', 'striptease'), ('undressing', 'striptease'),
  ('skinny dipping', 'skinny-dip'), ('swimming nude', 'skinny-dip'),
  ('rape', 'rape-scene'), ('rape scene', 'rape-scene'), ('forced', 'rape-scene'),
  ('gang rape', 'gang-rape'), ('gangrape', 'gang-rape'),
  -- Context
  ('threesome', 'threesome'), ('group', 'threesome'), ('orgy', 'threesome'),
  ('bdsm', 'bdsm'), ('bondage', 'bdsm'), ('tied', 'bdsm'),
  ('romantic', 'romantic'), ('love scene', 'romantic'), ('sensual', 'romantic'),
  ('bed', 'bed-scene'), ('bedroom', 'bed-scene')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 6. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_videos_pipeline_step ON videos(pipeline_step) WHERE pipeline_step IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_videos_ai_vision_status ON videos(ai_vision_status);
CREATE INDEX IF NOT EXISTS idx_tag_mapping_donor ON tag_mapping(donor_tag);
CREATE INDEX IF NOT EXISTS idx_celebrities_nationality ON celebrities(nationality) WHERE nationality IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movies_countries ON movies USING GIN(countries) WHERE countries IS NOT NULL;

COMMIT;

-- ============================================================
-- Verification
-- ============================================================
\echo '--- Migration 012 complete ---'
\echo 'New columns in videos:'
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'videos' AND column_name IN (
  'ai_vision_status', 'ai_vision_model', 'best_thumbnail_sec',
  'preview_start_sec', 'donor_tags', 'pipeline_step', 'pipeline_error'
) ORDER BY column_name;

\echo 'tag_mapping rows:'
SELECT count(*) AS tag_mapping_count FROM tag_mapping;

\echo 'movies.countries column:'
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'movies' AND column_name = 'countries';
