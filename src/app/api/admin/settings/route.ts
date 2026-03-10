import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

export async function GET() {
    // Return non-sensitive settings only
    return NextResponse.json({
        site_url: config.siteUrl,
        node_env: config.nodeEnv,
        db_host: config.db.host,
        db_name: config.db.name,
        bunny_storage_zone: config.bunny.storageZone,
        cdn_url: config.bunny.cdnUrl,
        has_bunny_key: !!config.bunny.storageKey,
        has_gemini_key: !!config.geminiApiKey,
        has_tmdb_key: !!config.tmdbApiKey,
        has_admin_password: !!config.admin.password,
    });
}
