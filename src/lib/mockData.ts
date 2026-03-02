import type { Video, Celebrity, Movie, Tag } from './types';

// ============================================
// Mock Tags
// ============================================
export const mockTags: Tag[] = [
    { id: 1, name: 'Nude', name_localized: { en: 'Nude', ru: 'Обнажённая' }, slug: 'nude', videos_count: 42, created_at: '' },
    { id: 2, name: 'Topless', name_localized: { en: 'Topless', ru: 'Топлесс' }, slug: 'topless', videos_count: 38, created_at: '' },
    { id: 3, name: 'Sex Scene', name_localized: { en: 'Sex Scene', ru: 'Секс-сцена' }, slug: 'sex-scene', videos_count: 35, created_at: '' },
    { id: 4, name: 'Full Frontal', name_localized: { en: 'Full Frontal', ru: 'Полный фронтал' }, slug: 'full-frontal', videos_count: 18, created_at: '' },
    { id: 5, name: 'Shower', name_localized: { en: 'Shower', ru: 'Душ' }, slug: 'shower', videos_count: 12, created_at: '' },
    { id: 6, name: 'Lingerie', name_localized: { en: 'Lingerie', ru: 'Бельё' }, slug: 'lingerie', videos_count: 22, created_at: '' },
];

// ============================================
// Mock Celebrities (extended with bios)
// ============================================
export const mockCelebrities: Celebrity[] = [
    { id: 1, name: 'Scarlett Johansson', slug: 'scarlett-johansson', name_localized: { en: 'Scarlett Johansson', ru: 'Скарлетт Йоханссон' }, aliases: ['ScarJo'], bio: { en: 'Scarlett Ingrid Johansson is an American actress and singer. She is the highest-grossing box office star of all time, with her films earning over $14.3 billion worldwide.', ru: 'Скарлетт Ингрид Йоханссон — американская актриса и певица. Самая кассовая звезда всех времён.' }, photo_url: null, photo_local: null, birth_date: '1984-11-22', nationality: 'American', tmdb_id: 1245, imdb_id: 'nm0424060', external_ids: {}, videos_count: 8, movies_count: 5, avg_rating: 4.5, total_views: 450000, is_featured: true, ai_matched: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 2, name: 'Margot Robbie', slug: 'margot-robbie', name_localized: { en: 'Margot Robbie', ru: 'Марго Робби' }, aliases: [], bio: { en: 'Margot Elise Robbie is an Australian actress and producer. Known for her roles in The Wolf of Wall Street, Suicide Squad, and Barbie.', ru: 'Марго Элиз Робби — австралийская актриса и продюсер.' }, photo_url: null, photo_local: null, birth_date: '1990-07-02', nationality: 'Australian', tmdb_id: 234352, imdb_id: 'nm3053338', external_ids: {}, videos_count: 6, movies_count: 4, avg_rating: 4.3, total_views: 380000, is_featured: true, ai_matched: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 3, name: 'Emilia Clarke', slug: 'emilia-clarke', name_localized: { en: 'Emilia Clarke', ru: 'Эмилия Кларк' }, aliases: ['Khaleesi'], bio: { en: 'Emilia Isobel Euphemia Rose Clarke is a British actress. Best known for her role as Daenerys Targaryen in Game of Thrones.', ru: 'Эмилия Кларк — британская актриса, наиболее известная ролью Дейенерис Таргариен.' }, photo_url: null, photo_local: null, birth_date: '1986-10-23', nationality: 'British', tmdb_id: 1223786, imdb_id: 'nm3592338', external_ids: {}, videos_count: 12, movies_count: 3, avg_rating: 4.7, total_views: 890000, is_featured: true, ai_matched: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 4, name: 'Alexandra Daddario', slug: 'alexandra-daddario', name_localized: { en: 'Alexandra Daddario', ru: 'Александра Даддарио' }, aliases: [], bio: { en: 'Alexandra Anna Daddario is an American actress. Known for her striking blue eyes and roles in True Detective, Baywatch, and Percy Jackson.', ru: 'Александра Даддарио — американская актриса, известная ролями в Настоящем детективе и Спасателях Малибу.' }, photo_url: null, photo_local: null, birth_date: '1986-03-16', nationality: 'American', tmdb_id: 20536, imdb_id: 'nm1275259', external_ids: {}, videos_count: 5, movies_count: 4, avg_rating: 4.8, total_views: 920000, is_featured: true, ai_matched: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 5, name: 'Sydney Sweeney', slug: 'sydney-sweeney', name_localized: { en: 'Sydney Sweeney', ru: 'Сидни Суини' }, aliases: [], bio: { en: 'Sydney Bernice Sweeney is an American actress. Known for Euphoria, The White Lotus, and Anyone but You.', ru: 'Сидни Суини — американская актриса, известная по сериалам Эйфория и Белый Лотос.' }, photo_url: null, photo_local: null, birth_date: '1997-09-12', nationality: 'American', tmdb_id: 1397778, imdb_id: 'nm4991344', external_ids: {}, videos_count: 7, movies_count: 3, avg_rating: 4.6, total_views: 678000, is_featured: true, ai_matched: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 6, name: 'Ana de Armas', slug: 'ana-de-armas', name_localized: { en: 'Ana de Armas', ru: 'Ана де Армас' }, aliases: [], bio: { en: 'Ana Celia de Armas Caso is a Cuban-Spanish actress. Known for Blade Runner 2049, Knives Out, and No Time to Die.', ru: 'Ана де Армас — кубинско-испанская актриса.' }, photo_url: null, photo_local: null, birth_date: '1988-04-30', nationality: 'Cuban-Spanish', tmdb_id: 224513, imdb_id: 'nm1869101', external_ids: {}, videos_count: 4, movies_count: 3, avg_rating: 4.4, total_views: 345000, is_featured: true, ai_matched: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 7, name: 'Elizabeth Olsen', slug: 'elizabeth-olsen', name_localized: { en: 'Elizabeth Olsen', ru: 'Элизабет Олсен' }, aliases: [], bio: { en: 'Elizabeth Chase Olsen is an American actress. Known for Martha Marcy May Marlene and the MCU as Wanda Maximoff.', ru: 'Элизабет Олсен — американская актриса.' }, photo_url: null, photo_local: null, birth_date: '1989-02-16', nationality: 'American', tmdb_id: 17, imdb_id: 'nm0647634', external_ids: {}, videos_count: 3, movies_count: 2, avg_rating: 4.2, total_views: 210000, is_featured: true, ai_matched: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 8, name: 'Florence Pugh', slug: 'florence-pugh', name_localized: { en: 'Florence Pugh', ru: 'Флоренс Пью' }, aliases: [], bio: { en: 'Florence Rose C.M. Pugh is a British actress. Known for Midsommar, Little Women, and Oppenheimer.', ru: 'Флоренс Пью — британская актриса, известная по фильмам Солнцестояние и Оппенгеймер.' }, photo_url: null, photo_local: null, birth_date: '1996-01-03', nationality: 'British', tmdb_id: 1373737, imdb_id: 'nm6073955', external_ids: {}, videos_count: 5, movies_count: 3, avg_rating: 4.1, total_views: 289000, is_featured: true, ai_matched: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
];

// ============================================
// Mock Movies
// ============================================
export const mockMovies: Movie[] = [
    { id: 1, title: 'Under the Skin', title_localized: { en: 'Under the Skin', ru: 'Побудь в моей шкуре' }, slug: 'under-the-skin', year: 2013, poster_url: null, poster_local: null, description: { en: 'A mysterious woman seduces lonely men in the evening streets of Scotland.', ru: 'Таинственная женщина соблазняет одиноких мужчин на улицах Шотландии.' }, studio: 'Film4', director: 'Jonathan Glazer', genres: ['Sci-Fi', 'Drama'], tmdb_id: 97057, imdb_id: 'tt1441395', external_ids: {}, scenes_count: 3, total_views: 125000, ai_matched: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 2, title: 'The Wolf of Wall Street', title_localized: { en: 'The Wolf of Wall Street', ru: 'Волк с Уолл-стрит' }, slug: 'wolf-of-wall-street', year: 2013, poster_url: null, poster_local: null, description: { en: 'Based on the true story of Jordan Belfort, from his rise to a wealthy stock-broker to his fall involving crime and corruption.', ru: 'Основано на реальной истории Джордана Белфорта.' }, studio: 'Paramount', director: 'Martin Scorsese', genres: ['Biography', 'Comedy', 'Crime'], tmdb_id: 106646, imdb_id: 'tt0993846', external_ids: {}, scenes_count: 5, total_views: 234000, ai_matched: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 3, title: 'Game of Thrones', title_localized: { en: 'Game of Thrones', ru: 'Игра престолов' }, slug: 'game-of-thrones', year: 2011, poster_url: null, poster_local: null, description: { en: 'Nine noble families fight for control over the lands of Westeros, while an ancient enemy returns.', ru: 'Девять знатных семей сражаются за контроль над землями Вестероса.' }, studio: 'HBO', director: 'Various', genres: ['Drama', 'Fantasy'], tmdb_id: 1399, imdb_id: 'tt0944947', external_ids: {}, scenes_count: 45, total_views: 890000, ai_matched: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 4, title: 'Blonde', title_localized: { en: 'Blonde', ru: 'Блондинка' }, slug: 'blonde', year: 2022, poster_url: null, poster_local: null, description: { en: 'A fictionalized chronicle of the inner life of Marilyn Monroe.', ru: 'Художественная хроника внутренней жизни Мэрилин Монро.' }, studio: 'Netflix', director: 'Andrew Dominik', genres: ['Biography', 'Drama'], tmdb_id: 597208, imdb_id: 'tt1655420', external_ids: {}, scenes_count: 8, total_views: 456000, ai_matched: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
];

// ============================================
// Mock Videos (with tags and reviews)
// ============================================
export const mockVideos: Video[] = [
    {
        id: '11111111-1111-1111-1111-111111111111',
        raw_video_id: null,
        title: { en: 'Scarlett Johansson Nude Scene in Under the Skin', ru: 'Скарлетт Йоханссон обнажённая сцена в Побудь в моей шкуре' },
        slug: { en: 'scarlett-johansson-under-the-skin', ru: 'skarlett-johansson-pobud-v-moej-shkure' },
        review: { en: 'One of the most artistically bold nude scenes in modern cinema. Scarlett Johansson delivers a raw, mesmerizing performance.', ru: 'Одна из самых художественно смелых обнажённых сцен современного кино.' },
        seo_title: { en: 'Scarlett Johansson Nude in Under the Skin - CelebSkin', ru: 'Скарлетт Йоханссон обнажённая — Побудь в моей шкуре' },
        seo_description: { en: 'Watch Scarlett Johansson nude scene from Under the Skin (2013). HD quality.', ru: 'Смотрите обнажённую сцену Скарлетт Йоханссон из фильма Побудь в моей шкуре.' },
        original_title: 'Under the Skin',
        quality: 'HD', duration_seconds: 185, duration_formatted: '3:05',
        video_url: null, video_url_watermarked: null, thumbnail_url: null, preview_gif_url: null,
        screenshots: [], sprite_url: null, sprite_data: null,
        ai_model: null, ai_confidence: null, ai_raw_response: null, enrichment_layers_used: null,
        views_count: 125400, likes_count: 3420, dislikes_count: 45,
        status: 'published', published_at: '2026-02-28T12:00:00Z',
        created_at: '2026-02-28T10:00:00Z', updated_at: '2026-02-28T12:00:00Z',
        celebrities: [mockCelebrities[0]],
        tags: [mockTags[0], mockTags[3], mockTags[2]],
        movie: mockMovies[0],
    },
    {
        id: '22222222-2222-2222-2222-222222222222',
        raw_video_id: null,
        title: { en: 'Margot Robbie Nude Scene in The Wolf of Wall Street', ru: 'Марго Робби обнажённая сцена в Волк с Уолл-стрит' },
        slug: { en: 'margot-robbie-wolf-wall-street', ru: 'margo-robbi-volk-s-uoll-strit' },
        review: { en: 'Margot Robbie became an instant star after this iconic scene in The Wolf of Wall Street alongside Leonardo DiCaprio.', ru: 'Марго Робби стала звездой после этой культовой сцены.' },
        seo_title: { en: 'Margot Robbie Nude in Wolf of Wall Street - CelebSkin', ru: 'Марго Робби обнажённая — Волк с Уолл-стрит' },
        seo_description: {},
        original_title: 'The Wolf of Wall Street',
        quality: 'HD', duration_seconds: 240, duration_formatted: '4:00',
        video_url: null, video_url_watermarked: null, thumbnail_url: null, preview_gif_url: null,
        screenshots: [], sprite_url: null, sprite_data: null,
        ai_model: null, ai_confidence: null, ai_raw_response: null, enrichment_layers_used: null,
        views_count: 98700, likes_count: 2800, dislikes_count: 32,
        status: 'published', published_at: '2026-02-27T12:00:00Z',
        created_at: '2026-02-27T10:00:00Z', updated_at: '2026-02-27T12:00:00Z',
        celebrities: [mockCelebrities[1]],
        tags: [mockTags[0], mockTags[2], mockTags[5]],
        movie: mockMovies[1],
    },
    {
        id: '33333333-3333-3333-3333-333333333333',
        raw_video_id: null,
        title: { en: 'Emilia Clarke Nude Scene in Game of Thrones', ru: 'Эмилия Кларк обнажённая сцена в Игре престолов' },
        slug: { en: 'emilia-clarke-game-of-thrones', ru: 'emiliya-klark-igra-prestolov' },
        review: { en: 'Emilia Clarke\'s most talked-about scene from Game of Thrones Season 1, showcasing her fearless commitment to the role.', ru: 'Самая обсуждаемая сцена Эмилии Кларк из Игры престолов.' },
        seo_title: {}, seo_description: {},
        original_title: 'Game of Thrones',
        quality: 'HD', duration_seconds: 312, duration_formatted: '5:12',
        video_url: null, video_url_watermarked: null, thumbnail_url: null, preview_gif_url: null,
        screenshots: [], sprite_url: null, sprite_data: null,
        ai_model: null, ai_confidence: null, ai_raw_response: null, enrichment_layers_used: null,
        views_count: 245000, likes_count: 5100, dislikes_count: 67,
        status: 'published', published_at: '2026-02-26T12:00:00Z',
        created_at: '2026-02-26T10:00:00Z', updated_at: '2026-02-26T12:00:00Z',
        celebrities: [mockCelebrities[2]],
        tags: [mockTags[0], mockTags[1], mockTags[2]],
        movie: mockMovies[2],
    },
    {
        id: '44444444-4444-4444-4444-444444444444',
        raw_video_id: null,
        title: { en: 'Alexandra Daddario in True Detective', ru: 'Александра Даддарио в Настоящем детективе' },
        slug: { en: 'alexandra-daddario-true-detective', ru: 'aleksandra-daddario-nastoyashchij-detektiv' },
        review: { en: 'Alexandra Daddario\'s scene in True Detective became one of the most iconic moments in TV history.', ru: 'Сцена Александры Даддарио стала одной из самых культовых в истории телевидения.' },
        seo_title: {}, seo_description: {},
        original_title: 'True Detective',
        quality: 'HD', duration_seconds: 156, duration_formatted: '2:36',
        video_url: null, video_url_watermarked: null, thumbnail_url: null, preview_gif_url: null,
        screenshots: [], sprite_url: null, sprite_data: null,
        ai_model: null, ai_confidence: null, ai_raw_response: null, enrichment_layers_used: null,
        views_count: 567000, likes_count: 8900, dislikes_count: 120,
        status: 'published', published_at: '2026-02-25T12:00:00Z',
        created_at: '2026-02-25T10:00:00Z', updated_at: '2026-02-25T12:00:00Z',
        celebrities: [mockCelebrities[3]],
        tags: [mockTags[0], mockTags[1], mockTags[3]],
    },
    {
        id: '55555555-5555-5555-5555-555555555555',
        raw_video_id: null,
        title: { en: 'Sydney Sweeney in Euphoria', ru: 'Сидни Суини в Эйфории' },
        slug: { en: 'sydney-sweeney-euphoria', ru: 'sidni-suini-ejforiya' },
        review: { en: 'Sydney Sweeney\'s breakout performance in HBO\'s Euphoria, featuring several memorable scenes.', ru: 'Прорывная роль Сидни Суини в сериале Эйфория.' },
        seo_title: {}, seo_description: {},
        original_title: 'Euphoria',
        quality: 'HD', duration_seconds: 198, duration_formatted: '3:18',
        video_url: null, video_url_watermarked: null, thumbnail_url: null, preview_gif_url: null,
        screenshots: [], sprite_url: null, sprite_data: null,
        ai_model: null, ai_confidence: null, ai_raw_response: null, enrichment_layers_used: null,
        views_count: 432000, likes_count: 7200, dislikes_count: 89,
        status: 'published', published_at: '2026-02-24T12:00:00Z',
        created_at: '2026-02-24T10:00:00Z', updated_at: '2026-02-24T12:00:00Z',
        celebrities: [mockCelebrities[4]],
        tags: [mockTags[1], mockTags[2], mockTags[5]],
    },
    {
        id: '66666666-6666-6666-6666-666666666666',
        raw_video_id: null,
        title: { en: 'Ana de Armas Nude Scene in Blonde', ru: 'Ана де Армас обнажённая сцена в Блондинке' },
        slug: { en: 'ana-de-armas-blonde', ru: 'ana-de-armas-blondinka' },
        review: { en: 'Ana de Armas gives a transformative performance in Netflix\'s Blonde, earning an Oscar nomination.', ru: 'Ана де Армас демонстрирует трансформационную игру в Блондинке от Netflix.' },
        seo_title: {}, seo_description: {},
        original_title: 'Blonde',
        quality: 'HD', duration_seconds: 274, duration_formatted: '4:34',
        video_url: null, video_url_watermarked: null, thumbnail_url: null, preview_gif_url: null,
        screenshots: [], sprite_url: null, sprite_data: null,
        ai_model: null, ai_confidence: null, ai_raw_response: null, enrichment_layers_used: null,
        views_count: 312000, likes_count: 5600, dislikes_count: 78,
        status: 'published', published_at: '2026-02-23T12:00:00Z',
        created_at: '2026-02-23T10:00:00Z', updated_at: '2026-02-23T12:00:00Z',
        celebrities: [mockCelebrities[5]],
        tags: [mockTags[0], mockTags[3], mockTags[4]],
        movie: mockMovies[3],
    },
];

// ============================================
// Helper to find mock data
// ============================================
export function findVideoBySlug(slug: string): Video | undefined {
    return mockVideos.find((v) => Object.values(v.slug).includes(slug));
}

export function findCelebrityBySlug(slug: string): Celebrity | undefined {
    return mockCelebrities.find((c) => c.slug === slug);
}

export function findMovieBySlug(slug: string): Movie | undefined {
    return mockMovies.find((m) => m.slug === slug);
}

export function getVideosForCelebrity(slug: string): Video[] {
    return mockVideos.filter((v) => v.celebrities?.some((c) => c.slug === slug));
}

export function getVideosForMovie(slug: string): Video[] {
    return mockVideos.filter((v) => v.movie?.slug === slug);
}

export function getVideosByTag(tagSlug: string): Video[] {
    return mockVideos.filter((v) => v.tags?.some((t) => t.slug === tagSlug));
}

export function searchMockData(query: string) {
    const q = query.toLowerCase();
    return {
        videos: mockVideos.filter((v) => Object.values(v.title).some((t) => t.toLowerCase().includes(q)) || v.original_title?.toLowerCase().includes(q)),
        celebrities: mockCelebrities.filter((c) => c.name.toLowerCase().includes(q)),
        movies: mockMovies.filter((m) => m.title.toLowerCase().includes(q) || Object.values(m.title_localized).some((t) => t.toLowerCase().includes(q))),
    };
}
