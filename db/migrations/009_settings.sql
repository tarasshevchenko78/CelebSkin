-- Settings table: key-value store for admin-configurable settings
-- Used for API keys, watermark config, and other runtime settings

CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    description VARCHAR(500),
    is_secret BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default settings
INSERT INTO settings (key, value, description, is_secret) VALUES
    ('gemini_api_key', '', 'Google Gemini API key', true),
    ('tmdb_api_key', '', 'TMDB API key', true),
    ('watermark_type', 'text', 'Тип водяного знака: text или image', false),
    ('watermark_image_url', '', 'URL PNG водяного знака на CDN', false),
    ('watermark_opacity', '0.3', 'Прозрачность водяного знака 0.0-1.0', false),
    ('watermark_movement', 'rotating_corners', 'Паттерн движения: static, rotating_corners, diagonal_sweep, smooth_drift', false),
    ('watermark_scale', '0.1', 'Размер относительно ширины видео 0.05-0.20', false)
ON CONFLICT (key) DO NOTHING;
