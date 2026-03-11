-- Migration 008: Add draft/published status to celebrities and movies
-- Run: psql -U celebskin -d celebskin -f db/migrations/008_draft_status.sql

-- Add status to celebrities
ALTER TABLE celebrities ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'published';

-- All existing celebrities are already visible — keep them published
UPDATE celebrities SET status = 'published' WHERE status IS NULL;

-- Set celebrities that have NO published videos to 'draft'
UPDATE celebrities SET status = 'draft'
WHERE id NOT IN (
    SELECT DISTINCT vc.celebrity_id
    FROM video_celebrities vc
    JOIN videos v ON vc.video_id = v.id
    WHERE v.status = 'published'
) AND status = 'published';

-- Add status to movies
ALTER TABLE movies ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'published';

-- All existing movies are already visible — keep them published
UPDATE movies SET status = 'published' WHERE status IS NULL;

-- Set movies that have NO published videos to 'draft'
UPDATE movies SET status = 'draft'
WHERE id NOT IN (
    SELECT DISTINCT ms.movie_id
    FROM movie_scenes ms
    JOIN videos v ON ms.video_id = v.id
    WHERE v.status = 'published'
) AND status = 'published';

-- Indexes for fast filtering
CREATE INDEX IF NOT EXISTS idx_celebrities_status ON celebrities(status);
CREATE INDEX IF NOT EXISTS idx_movies_status ON movies(status);
