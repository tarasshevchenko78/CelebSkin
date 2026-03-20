-- 011_hot_moments.sql — Store AI-identified hot moments with timestamps
-- hot_moments: array of {timestamp_sec, type, description}
-- Example: [{"timestamp_sec": 45, "type": "peak", "description": "full frontal reveal"}, ...]

ALTER TABLE videos ADD COLUMN IF NOT EXISTS hot_moments JSONB DEFAULT '[]'::jsonb;
