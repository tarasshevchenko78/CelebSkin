-- Migration 014: user auth + favorites

CREATE TABLE IF NOT EXISTS users (
    id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
    username      VARCHAR(20)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));

CREATE TABLE IF NOT EXISTS user_favorites (
    id         BIGSERIAL    PRIMARY KEY,
    user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type  VARCHAR(10)  NOT NULL CHECK (item_type IN ('video', 'celebrity')),
    item_id    VARCHAR(36)  NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id, item_type);

-- Attach user_id to video_votes for logged-in users
ALTER TABLE video_votes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
