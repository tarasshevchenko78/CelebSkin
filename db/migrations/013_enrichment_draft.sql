-- Migration 013: Set draft status for celebrities/movies missing TMDB photo/poster
-- Celebrity = draft if: no TMDB photo
-- Movie = draft if: no TMDB poster
-- Run: psql -U celebskin -d celebskin -f db/migrations/013_enrichment_draft.sql

-- Set celebrities without photo to draft
UPDATE celebrities SET status = 'draft'
WHERE status = 'published'
  AND (photo_url IS NULL OR photo_url = '');

-- Set movies without poster to draft
UPDATE movies SET status = 'draft'
WHERE status = 'published'
  AND (poster_url IS NULL OR poster_url = '');

-- Report counts
DO $$
DECLARE
    draft_celebs INT;
    draft_movies INT;
BEGIN
    SELECT COUNT(*) INTO draft_celebs FROM celebrities WHERE status = 'draft';
    SELECT COUNT(*) INTO draft_movies FROM movies WHERE status = 'draft';
    RAISE NOTICE 'Draft celebrities: %, Draft movies: %', draft_celebs, draft_movies;
END $$;
