-- CelebSkin Database Schema
-- PostgreSQL 16

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================
-- Source sites (from video-parser)
-- ============================================
CREATE TABLE sources (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    base_url VARCHAR(500) NOT NULL,
    adapter_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_parsed_at TIMESTAMPTZ,
    parse_interval_hours INT DEFAULT 24,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Raw videos (from video-parser)
-- ============================================
CREATE TABLE raw_videos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id INT REFERENCES sources(id),
    source_url VARCHAR(2000) NOT NULL UNIQUE,
    source_video_id VARCHAR(500),
    raw_title VARCHAR(1000),
    raw_description TEXT,
    thumbnail_url VARCHAR(2000),
    duration_seconds INT,
    raw_tags TEXT[],
    raw_categories TEXT[],
    raw_celebrities TEXT[],
    embed_code TEXT,
    video_file_url VARCHAR(2000),
    extra_data JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'skipped')),
    error_message TEXT,
    retry_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Celebrities
-- ============================================
CREATE TABLE celebrities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(200) NOT NULL UNIQUE,
    name_localized JSONB DEFAULT '{}',
    aliases TEXT[] DEFAULT '{}',
    bio JSONB DEFAULT '{}',
    photo_url VARCHAR(2000),
    photo_local VARCHAR(500),
    birth_date DATE,
    nationality VARCHAR(100),
    tmdb_id INT,
    imdb_id VARCHAR(20),
    external_ids JSONB DEFAULT '{}',
    videos_count INT DEFAULT 0,
    movies_count INT DEFAULT 0,
    avg_rating DECIMAL(3,2) DEFAULT 0,
    total_views BIGINT DEFAULT 0,
    is_featured BOOLEAN DEFAULT false,
    ai_matched BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_celebrities_name_trgm ON celebrities USING gin (name gin_trgm_ops);
CREATE INDEX idx_celebrities_slug ON celebrities(slug);
CREATE INDEX idx_celebrities_featured ON celebrities(is_featured) WHERE is_featured = true;

-- ============================================
-- Movies
-- ============================================
CREATE TABLE movies (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    title_localized JSONB DEFAULT '{}',
    slug VARCHAR(500) NOT NULL UNIQUE,
    year INT,
    poster_url VARCHAR(2000),
    poster_local VARCHAR(500),
    description JSONB DEFAULT '{}',
    studio VARCHAR(300),
    director VARCHAR(300),
    genres TEXT[] DEFAULT '{}',
    tmdb_id INT,
    imdb_id VARCHAR(20),
    external_ids JSONB DEFAULT '{}',
    scenes_count INT DEFAULT 0,
    total_views BIGINT DEFAULT 0,
    ai_matched BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_movies_title_trgm ON movies USING gin (title gin_trgm_ops);
CREATE INDEX idx_movies_year ON movies(year);
CREATE INDEX idx_movies_slug ON movies(slug);

-- ============================================
-- Videos (JSONB multilingual)
-- ============================================
CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    raw_video_id UUID REFERENCES raw_videos(id) UNIQUE,

    -- Multilingual fields (JSONB)
    title JSONB NOT NULL DEFAULT '{}',
    slug JSONB NOT NULL DEFAULT '{}',
    review JSONB DEFAULT '{}',
    seo_title JSONB DEFAULT '{}',
    seo_description JSONB DEFAULT '{}',

    -- Common fields
    original_title VARCHAR(500),
    quality VARCHAR(20),
    duration_seconds INT,
    duration_formatted VARCHAR(20),

    -- Media (BunnyCDN paths)
    video_url VARCHAR(2000),
    video_url_watermarked VARCHAR(2000),
    thumbnail_url VARCHAR(2000),
    preview_gif_url VARCHAR(2000),
    screenshots JSONB DEFAULT '[]',
    sprite_url VARCHAR(500),
    sprite_data JSONB,

    -- AI metadata
    ai_model VARCHAR(100),
    ai_confidence DECIMAL(3,2),
    ai_raw_response JSONB,
    enrichment_layers_used TEXT[],

    -- Visual recognition data
    recognition_data JSONB,              -- Gemini Vision results (movie/actor suggestions, OCR, etc.)
    recognition_method VARCHAR(20),      -- 'metadata' | 'visual' | 'manual'

    -- Stats
    views_count BIGINT DEFAULT 0,
    likes_count INT DEFAULT 0,
    dislikes_count INT DEFAULT 0,

    -- Status
    status VARCHAR(30) DEFAULT 'new'
        CHECK (status IN (
            'new', 'processing', 'watermarked', 'enriched',
            'auto_recognized', 'needs_review', 'unknown_with_suggestions',
            'published', 'rejected', 'dmca_removed'
        )),

    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_videos_status ON videos(status);
CREATE INDEX idx_videos_published ON videos(published_at DESC) WHERE status = 'published';
CREATE INDEX idx_videos_views ON videos(views_count DESC);

-- ============================================
-- Tags (JSONB multilingual)
-- ============================================
CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    name_localized JSONB DEFAULT '{}',
    slug VARCHAR(200) NOT NULL UNIQUE,
    videos_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Categories (JSONB multilingual)
-- ============================================
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    name_localized JSONB DEFAULT '{}',
    slug VARCHAR(200) NOT NULL UNIQUE,
    parent_id INT REFERENCES categories(id),
    videos_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Collections
-- ============================================
CREATE TABLE collections (
    id SERIAL PRIMARY KEY,
    title JSONB NOT NULL DEFAULT '{}',
    slug VARCHAR(200) NOT NULL UNIQUE,
    description JSONB DEFAULT '{}',
    cover_url VARCHAR(2000),
    is_auto BOOLEAN DEFAULT false,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- M:M Relations
-- ============================================
CREATE TABLE video_celebrities (
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    celebrity_id INT REFERENCES celebrities(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, celebrity_id)
);

CREATE TABLE video_tags (
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    tag_id INT REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, tag_id)
);

CREATE TABLE video_categories (
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    category_id INT REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, category_id)
);

CREATE TABLE movie_scenes (
    movie_id INT REFERENCES movies(id) ON DELETE CASCADE,
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    scene_number INT,
    scene_title JSONB DEFAULT '{}',
    PRIMARY KEY (movie_id, video_id)
);

CREATE TABLE movie_celebrities (
    movie_id INT REFERENCES movies(id) ON DELETE CASCADE,
    celebrity_id INT REFERENCES celebrities(id) ON DELETE CASCADE,
    role VARCHAR(200),
    PRIMARY KEY (movie_id, celebrity_id)
);

CREATE TABLE collection_videos (
    collection_id INT REFERENCES collections(id) ON DELETE CASCADE,
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    sort_order INT DEFAULT 0,
    PRIMARY KEY (collection_id, video_id)
);

-- ============================================
-- Celebrity photos
-- ============================================
CREATE TABLE celebrity_photos (
    id SERIAL PRIMARY KEY,
    celebrity_id INT REFERENCES celebrities(id) ON DELETE CASCADE,
    photo_url VARCHAR(2000),
    photo_local VARCHAR(500),
    is_primary BOOLEAN DEFAULT false,
    source VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AI Chat sessions
-- ============================================
CREATE TABLE ai_chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(100),
    celebrity_id INT REFERENCES celebrities(id),
    persona_type VARCHAR(50) DEFAULT 'flirty',
    messages_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AI Stories
-- ============================================
CREATE TABLE ai_stories (
    id SERIAL PRIMARY KEY,
    celebrity_id INT REFERENCES celebrities(id),
    title JSONB NOT NULL DEFAULT '{}',
    slug VARCHAR(300) NOT NULL UNIQUE,
    content JSONB DEFAULT '{}',
    audio_url_en VARCHAR(2000),
    audio_url_ru VARCHAR(2000),
    views_count INT DEFAULT 0,
    is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Blog
-- ============================================
CREATE TABLE blog_posts (
    id SERIAL PRIMARY KEY,
    title JSONB NOT NULL DEFAULT '{}',
    slug VARCHAR(300) NOT NULL UNIQUE,
    content JSONB DEFAULT '{}',
    excerpt JSONB DEFAULT '{}',
    cover_url VARCHAR(2000),
    celebrity_id INT REFERENCES celebrities(id),
    seo_title JSONB DEFAULT '{}',
    seo_description JSONB DEFAULT '{}',
    is_published BOOLEAN DEFAULT false,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Users / Premium
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(300) UNIQUE,
    telegram_id BIGINT UNIQUE,
    plan VARCHAR(20) DEFAULT 'free'
        CHECK (plan IN ('free', 'premium', 'vip')),
    plan_expires_at TIMESTAMPTZ,
    ai_messages_today INT DEFAULT 0,
    ai_messages_reset_at DATE DEFAULT CURRENT_DATE,
    stripe_customer_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Processing log
-- ============================================
CREATE TABLE processing_log (
    id BIGSERIAL PRIMARY KEY,
    video_id UUID,
    step VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    message TEXT,
    duration_ms INT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_processing_log_video ON processing_log(video_id);

-- ============================================
-- Triggers: auto update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_raw_videos_updated BEFORE UPDATE ON raw_videos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_videos_updated BEFORE UPDATE ON videos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_celebrities_updated BEFORE UPDATE ON celebrities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_movies_updated BEFORE UPDATE ON movies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Triggers: auto-count celebrities
-- ============================================
CREATE OR REPLACE FUNCTION update_celebrity_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE celebrities SET videos_count = videos_count + 1 WHERE id = NEW.celebrity_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE celebrities SET videos_count = videos_count - 1 WHERE id = OLD.celebrity_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_video_celebrities_count
    AFTER INSERT OR DELETE ON video_celebrities
    FOR EACH ROW EXECUTE FUNCTION update_celebrity_counts();

-- ============================================
-- Fuzzy search functions
-- ============================================
CREATE OR REPLACE FUNCTION search_celebrity_fuzzy(search_name TEXT, threshold REAL DEFAULT 0.3)
RETURNS TABLE(id INT, name VARCHAR, slug VARCHAR, similarity REAL) AS $$
BEGIN
    RETURN QUERY
    SELECT c.id, c.name, c.slug, similarity(c.name, search_name) AS sim
    FROM celebrities c
    WHERE similarity(c.name, search_name) > threshold
       OR search_name = ANY(c.aliases)
    ORDER BY sim DESC LIMIT 10;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION search_movie_fuzzy(search_title TEXT, threshold REAL DEFAULT 0.3)
RETURNS TABLE(id INT, title VARCHAR, slug VARCHAR, year INT, similarity REAL) AS $$
BEGIN
    RETURN QUERY
    SELECT m.id, m.title, m.slug, m.year, similarity(m.title, search_title) AS sim
    FROM movies m
    WHERE similarity(m.title, search_title) > threshold
    ORDER BY sim DESC LIMIT 10;
END;
$$ LANGUAGE plpgsql;
