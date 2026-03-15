-- 010_canonical_tags.sql — Add canonical tag taxonomy support
-- is_canonical: distinguishes fixed taxonomy tags from AI-generated junk
-- tag_group: nudity_level, scene_type, setting, source_type, body
-- sort_order: display ordering within groups

ALTER TABLE tags ADD COLUMN IF NOT EXISTS is_canonical BOOLEAN DEFAULT false;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS tag_group VARCHAR(50);
ALTER TABLE tags ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tags_canonical ON tags(is_canonical) WHERE is_canonical = true;
CREATE INDEX IF NOT EXISTS idx_tags_group ON tags(tag_group);
