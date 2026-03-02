// CelebSkin TypeScript Types

export type LocalizedField = Record<string, string>;

// Status enums
export type RawVideoStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'skipped';

export type VideoStatus =
    | 'new'
    | 'processing'
    | 'watermarked'
    | 'enriched'
    | 'auto_recognized'
    | 'needs_review'
    | 'unknown_with_suggestions'
    | 'published'
    | 'rejected'
    | 'dmca_removed';

export type UserPlan = 'free' | 'premium' | 'vip';

// Database interfaces

export interface Video {
    id: string;
    raw_video_id: string | null;
    title: LocalizedField;
    slug: LocalizedField;
    review: LocalizedField;
    seo_title: LocalizedField;
    seo_description: LocalizedField;
    original_title: string | null;
    quality: string | null;
    duration_seconds: number | null;
    duration_formatted: string | null;
    video_url: string | null;
    video_url_watermarked: string | null;
    thumbnail_url: string | null;
    preview_gif_url: string | null;
    screenshots: string[];
    sprite_url: string | null;
    sprite_data: Record<string, unknown> | null;
    ai_model: string | null;
    ai_confidence: number | null;
    ai_raw_response: Record<string, unknown> | null;
    enrichment_layers_used: string[] | null;
    views_count: number;
    likes_count: number;
    dislikes_count: number;
    status: VideoStatus;
    published_at: string | null;
    created_at: string;
    updated_at: string;
    // Joined fields (optional)
    celebrities?: Celebrity[];
    tags?: Tag[];
    categories?: Category[];
    movie?: Movie | null;
}

export interface Celebrity {
    id: number;
    name: string;
    slug: string;
    name_localized: LocalizedField;
    aliases: string[];
    bio: LocalizedField;
    photo_url: string | null;
    photo_local: string | null;
    birth_date: string | null;
    nationality: string | null;
    tmdb_id: number | null;
    imdb_id: string | null;
    external_ids: Record<string, unknown>;
    videos_count: number;
    movies_count: number;
    avg_rating: number;
    total_views: number;
    is_featured: boolean;
    ai_matched: boolean;
    created_at: string;
    updated_at: string;
}

export interface Movie {
    id: number;
    title: string;
    title_localized: LocalizedField;
    slug: string;
    year: number | null;
    poster_url: string | null;
    poster_local: string | null;
    description: LocalizedField;
    studio: string | null;
    director: string | null;
    genres: string[];
    tmdb_id: number | null;
    imdb_id: string | null;
    external_ids: Record<string, unknown>;
    scenes_count: number;
    total_views: number;
    ai_matched: boolean;
    created_at: string;
    updated_at: string;
}

export interface Tag {
    id: number;
    name: string;
    name_localized: LocalizedField;
    slug: string;
    videos_count: number;
    created_at: string;
}

export interface Category {
    id: number;
    name: string;
    name_localized: LocalizedField;
    slug: string;
    parent_id: number | null;
    videos_count: number;
    created_at: string;
}

export interface Collection {
    id: number;
    title: LocalizedField;
    slug: string;
    description: LocalizedField;
    cover_url: string | null;
    is_auto: boolean;
    sort_order: number;
    created_at: string;
}

export interface BlogPost {
    id: number;
    title: LocalizedField;
    slug: string;
    content: LocalizedField;
    excerpt: LocalizedField;
    cover_url: string | null;
    celebrity_id: number | null;
    seo_title: LocalizedField;
    seo_description: LocalizedField;
    is_published: boolean;
    published_at: string | null;
    created_at: string;
}

export interface User {
    id: string;
    email: string | null;
    telegram_id: number | null;
    plan: UserPlan;
    plan_expires_at: string | null;
    ai_messages_today: number;
    ai_messages_reset_at: string;
    stripe_customer_id: string | null;
    created_at: string;
}

// Pagination
export interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Search result
export interface SearchResult {
    videos: Video[];
    celebrities: Celebrity[];
    movies: Movie[];
}
