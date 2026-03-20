-- Migration 013: video_votes — one vote per fingerprint per video
CREATE TABLE IF NOT EXISTS video_votes (
    video_id    VARCHAR(36)  NOT NULL,
    fingerprint VARCHAR(64)  NOT NULL,
    vote_type   VARCHAR(10)  NOT NULL CHECK (vote_type IN ('like', 'dislike')),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (video_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_video_votes_video_id ON video_votes(video_id);
