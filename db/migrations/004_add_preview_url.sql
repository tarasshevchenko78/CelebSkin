-- Migration 004: Add preview_url column for hover preview clips
ALTER TABLE videos ADD COLUMN IF NOT EXISTS preview_url TEXT;

-- Index for finding videos missing preview
CREATE INDEX IF NOT EXISTS idx_videos_preview_url_null
    ON videos (status) WHERE preview_url IS NULL;
