-- Migration 006: xcadr.online import queue
-- Separate from the main pipeline — stores parsed/translated/matched metadata
-- before importing into the main videos table.

-- Import queue for xcadr.online parsed videos
CREATE TABLE IF NOT EXISTS xcadr_imports (
  id SERIAL PRIMARY KEY,

  -- Source data (parsed from xcadr)
  xcadr_url TEXT UNIQUE NOT NULL,
  xcadr_video_id TEXT,

  -- Parsed metadata (Russian)
  title_ru TEXT NOT NULL,
  celebrity_name_ru TEXT,
  movie_title_ru TEXT,
  movie_year INTEGER,
  tags_ru TEXT[],          -- array of Russian tag names
  collections_ru TEXT[],   -- array of Russian collection names
  duration_seconds INTEGER,
  screenshot_urls TEXT[],  -- array of xcadr screenshot URLs

  -- Translated metadata (English) — filled by AI/TMDB step
  title_en TEXT,
  celebrity_name_en TEXT,
  movie_title_en TEXT,

  -- Matching
  matched_video_id UUID REFERENCES videos(id),
  matched_celebrity_id INTEGER REFERENCES celebrities(id),
  matched_movie_id INTEGER REFERENCES movies(id),
  boobsradar_url TEXT,     -- found matching video URL without watermark

  -- Status
  status TEXT DEFAULT 'parsed' CHECK (status IN (
    'parsed',       -- just parsed from xcadr
    'translated',   -- AI translated names to English
    'matched',      -- found matching video in our DB or boobsradar
    'no_match',     -- could not find clean video source
    'imported',     -- successfully imported into main pipeline
    'skipped',      -- manually skipped by admin
    'duplicate'     -- already exists in our DB
  )),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_xcadr_imports_status     ON xcadr_imports(status);
CREATE INDEX IF NOT EXISTS idx_xcadr_imports_celebrity  ON xcadr_imports(celebrity_name_en);
CREATE INDEX IF NOT EXISTS idx_xcadr_imports_xcadr_url  ON xcadr_imports(xcadr_url);

-- Tag mapping: xcadr Russian tags → our tag slugs
CREATE TABLE IF NOT EXISTS xcadr_tag_mapping (
  id SERIAL PRIMARY KEY,
  xcadr_tag_ru TEXT UNIQUE NOT NULL,
  our_tag_slug TEXT,         -- slug in our tags table, NULL if not mapped yet
  auto_mapped BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Collection mapping: xcadr Russian collections → our collections
CREATE TABLE IF NOT EXISTS xcadr_collection_mapping (
  id SERIAL PRIMARY KEY,
  xcadr_collection_ru TEXT UNIQUE NOT NULL,
  xcadr_collection_url TEXT,
  our_collection_id INTEGER REFERENCES collections(id),
  auto_mapped BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
