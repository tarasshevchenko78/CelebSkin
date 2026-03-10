-- 002_pipeline_failures.sql — Dead letter queue for pipeline failures
-- Records operations that exhausted all retry attempts

CREATE TABLE IF NOT EXISTS pipeline_failures (
    id          SERIAL PRIMARY KEY,
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    step        VARCHAR(64) NOT NULL,          -- e.g. 'watermark', 'cdn-upload', 'thumbnail'
    error       TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 1,
    resolved    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pipeline_failures_unresolved
    ON pipeline_failures (resolved, created_at DESC)
    WHERE resolved = false;

CREATE INDEX IF NOT EXISTS idx_pipeline_failures_video
    ON pipeline_failures (video_id);
