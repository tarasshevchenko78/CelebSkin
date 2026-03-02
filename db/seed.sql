-- CelebSkin Seed Data
-- Base sources, categories, and tags for pipeline bootstrap

-- ============================================
-- Sources (donor sites for scraping)
-- ============================================
INSERT INTO sources (name, base_url, adapter_name, is_active, parse_interval_hours, config) VALUES
('boobsradar', 'https://boobsradar.com', 'boobsradar-adapter', true, 24, '{"pages_per_run": 5}'),
('aznude', 'https://www.aznude.com', 'aznude-adapter', false, 48, '{}'),
('celebjihad', 'https://www.celebjihad.com', 'celebjihad-adapter', false, 48, '{}')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- Categories
-- ============================================
INSERT INTO categories (name, name_localized, slug) VALUES
('Movie Scenes', '{"en": "Movie Scenes", "ru": "Сцены из фильмов", "de": "Filmszenen", "fr": "Scènes de films", "es": "Escenas de películas", "pt": "Cenas de filmes", "it": "Scene di film", "pl": "Sceny filmowe", "nl": "Filmscènes", "tr": "Film sahneleri"}', 'movie-scenes'),
('TV Series', '{"en": "TV Series", "ru": "Сериалы", "de": "TV-Serien", "fr": "Séries TV", "es": "Series de TV", "pt": "Séries de TV", "it": "Serie TV", "pl": "Seriale TV", "nl": "TV-series", "tr": "TV Dizileri"}', 'tv-series'),
('Music Videos', '{"en": "Music Videos", "ru": "Музыкальные клипы", "de": "Musikvideos", "fr": "Clips musicaux", "es": "Videos musicales", "pt": "Videoclipes", "it": "Video musicali", "pl": "Teledyski", "nl": "Muziekvideo''s", "tr": "Müzik videoları"}', 'music-videos'),
('Photo Shoots', '{"en": "Photo Shoots", "ru": "Фотосессии", "de": "Fotoshootings", "fr": "Séances photo", "es": "Sesiones de fotos", "pt": "Sessões fotográficas", "it": "Servizi fotografici", "pl": "Sesje zdjęciowe", "nl": "Fotoshoots", "tr": "Fotoğraf çekimleri"}', 'photo-shoots'),
('Leaked', '{"en": "Leaked", "ru": "Утечки", "de": "Geleakt", "fr": "Fuités", "es": "Filtrados", "pt": "Vazados", "it": "Trapelati", "pl": "Wycieki", "nl": "Gelekt", "tr": "Sızdırılmış"}', 'leaked')
ON CONFLICT (slug) DO NOTHING;

-- ============================================
-- Tags (common scene types)
-- ============================================
INSERT INTO tags (name, name_localized, slug) VALUES
('Nude', '{"en": "Nude", "ru": "Обнажённые", "de": "Nackt", "fr": "Nu", "es": "Desnudo", "pt": "Nu", "it": "Nudo", "pl": "Nago", "nl": "Naakt", "tr": "Çıplak"}', 'nude'),
('Topless', '{"en": "Topless", "ru": "Топлес", "de": "Oben ohne", "fr": "Seins nus", "es": "Topless", "pt": "Topless", "it": "Topless", "pl": "Topless", "nl": "Topless", "tr": "Üstsüz"}', 'topless'),
('Sex Scene', '{"en": "Sex Scene", "ru": "Секс сцена", "de": "Sexszene", "fr": "Scène de sexe", "es": "Escena de sexo", "pt": "Cena de sexo", "it": "Scena di sesso", "pl": "Scena seksu", "nl": "Seksscène", "tr": "Seks sahnesi"}', 'sex-scene'),
('Lingerie', '{"en": "Lingerie", "ru": "Нижнее бельё", "de": "Dessous", "fr": "Lingerie", "es": "Lencería", "pt": "Lingerie", "it": "Lingerie", "pl": "Bielizna", "nl": "Lingerie", "tr": "İç çamaşırı"}', 'lingerie'),
('Bikini', '{"en": "Bikini", "ru": "Бикини", "de": "Bikini", "fr": "Bikini", "es": "Bikini", "pt": "Biquíni", "it": "Bikini", "pl": "Bikini", "nl": "Bikini", "tr": "Bikini"}', 'bikini'),
('Shower', '{"en": "Shower", "ru": "Душ", "de": "Dusche", "fr": "Douche", "es": "Ducha", "pt": "Banho", "it": "Doccia", "pl": "Prysznic", "nl": "Douche", "tr": "Duş"}', 'shower'),
('Full Frontal', '{"en": "Full Frontal", "ru": "Фронтальная обнажёнка", "de": "Volle Frontalansicht", "fr": "Nu frontal", "es": "Frontal completo", "pt": "Frontal completo", "it": "Frontale completo", "pl": "Pełne odkrycie", "nl": "Volledig frontaal", "tr": "Tam önden"}', 'full-frontal'),
('Butt', '{"en": "Butt", "ru": "Попка", "de": "Po", "fr": "Fesses", "es": "Trasero", "pt": "Bumbum", "it": "Sedere", "pl": "Pośladki", "nl": "Billen", "tr": "Kalça"}', 'butt'),
('Erotic', '{"en": "Erotic", "ru": "Эротика", "de": "Erotisch", "fr": "Érotique", "es": "Erótico", "pt": "Erótico", "it": "Erotico", "pl": "Erotyczny", "nl": "Erotisch", "tr": "Erotik"}', 'erotic'),
('Celebrity', '{"en": "Celebrity", "ru": "Знаменитость", "de": "Prominente", "fr": "Célébrité", "es": "Celebridad", "pt": "Celebridade", "it": "Celebrità", "pl": "Celebrytka", "nl": "Beroemdheid", "tr": "Ünlü"}', 'celebrity'),
('Oscar Winner', '{"en": "Oscar Winner", "ru": "Лауреат Оскара", "de": "Oscar-Gewinnerin", "fr": "Lauréate Oscar", "es": "Ganadora del Oscar", "pt": "Vencedora do Oscar", "it": "Vincitrice Oscar", "pl": "Laureatka Oscara", "nl": "Oscar-winnares", "tr": "Oscar kazananı"}', 'oscar-winner'),
('Mainstream', '{"en": "Mainstream", "ru": "Мейнстрим", "de": "Mainstream", "fr": "Mainstream", "es": "Mainstream", "pt": "Mainstream", "it": "Mainstream", "pl": "Mainstream", "nl": "Mainstream", "tr": "Mainstream"}', 'mainstream')
ON CONFLICT (slug) DO NOTHING;
