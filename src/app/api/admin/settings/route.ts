import { NextResponse } from 'next/server';

export async function GET() {
    // Return non-sensitive settings only
    return NextResponse.json({
        site_url: process.env.SITE_URL || 'https://celeb.skin',
        node_env: process.env.NODE_ENV || 'development',
        db_host: process.env.DB_HOST || '127.0.0.1',
        db_name: process.env.DB_NAME || 'celebskin',
        bunny_storage_zone: process.env.BUNNY_STORAGE_ZONE || null,
        has_bunny_key: !!process.env.BUNNY_API_KEY,
        has_gemini_key: !!process.env.GEMINI_API_KEY,
        has_tmdb_key: !!process.env.TMDB_API_KEY,
        has_admin_password: !!process.env.ADMIN_PASSWORD,
    });
}
