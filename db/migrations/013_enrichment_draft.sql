-- Migration 013: Set draft status for celebrities/movies missing enrichment data
-- Celebrity = draft if: no TMDB photo OR no bio
-- Movie = draft if: no poster OR no description
-- Run: psql -U celebskin -d celebskin -f db/migrations/013_enrichment_draft.sql

-- Set celebrities without photo or bio to draft (keep published if they have both)
UPDATE celebrities SET status = 'draft'
WHERE status = 'published'
  AND (
    photo_url IS NULL OR photo_url = ''
    OR bio IS NULL OR bio::text = '{}' OR bio::text = 'null'
  );

-- Set movies without poster or description to draft
UPDATE movies SET status = 'draft'
WHERE status = 'published'
  AND (
    poster_url IS NULL OR poster_url = ''
    OR description IS NULL OR description::text = '{}' OR description::text = 'null'
  );

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
