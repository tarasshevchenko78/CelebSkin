import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { getAllSettings, setSetting, getSetting } from '@/lib/db/settings';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// Valid setting keys that can be updated via admin
const EDITABLE_KEYS = new Set([
    'gemini_api_key',
    'tmdb_api_key',
    'watermark_type',
    'watermark_image_url',
    'watermark_opacity',
    'watermark_movement',
    'watermark_scale',
]);

function maskSecret(value: string): string {
    if (!value || value.length <= 4) return value ? '••••' : '';
    return '••••••••' + value.slice(-4);
}

// GET /api/admin/settings — return all settings (secrets masked) + env info
export async function GET() {
    try {
        const settings = await getAllSettings();
        const masked: Record<string, { value: string; is_secret: boolean; description: string | null }> = {};
        for (const [key, info] of Object.entries(settings)) {
            masked[key] = {
                ...info,
                value: info.is_secret ? maskSecret(info.value) : info.value,
            };
        }
        return NextResponse.json({
            settings: masked,
            env: {
                site_url: config.siteUrl,
                node_env: config.nodeEnv,
                db_host: config.db.host,
                db_name: config.db.name,
                bunny_storage_zone: config.bunny.storageZone,
                cdn_url: config.bunny.cdnUrl,
                has_bunny_key: !!config.bunny.storageKey,
                has_gemini_key: !!config.geminiApiKey,
                has_tmdb_key: !!config.tmdbApiKey,
            },
        });
    } catch (error) {
        logger.error('Failed to get settings', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
    }
}

// PUT /api/admin/settings — update a single setting
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { key, value } = body as { key?: string; value?: string };

        if (!key || typeof key !== 'string') {
            return NextResponse.json({ error: 'key is required' }, { status: 400 });
        }
        if (value === undefined || typeof value !== 'string') {
            return NextResponse.json({ error: 'value is required (string)' }, { status: 400 });
        }
        if (!EDITABLE_KEYS.has(key)) {
            return NextResponse.json({ error: `Настройка "${key}" не редактируется` }, { status: 400 });
        }

        // Validate specific settings
        if (key === 'watermark_opacity') {
            const num = parseFloat(value);
            if (isNaN(num) || num < 0 || num > 1) {
                return NextResponse.json({ error: 'Прозрачность должна быть от 0.0 до 1.0' }, { status: 400 });
            }
        }
        if (key === 'watermark_scale') {
            const num = parseFloat(value);
            if (isNaN(num) || num < 0.01 || num > 0.5) {
                return NextResponse.json({ error: 'Масштаб должен быть от 0.01 до 0.50' }, { status: 400 });
            }
        }
        if (key === 'watermark_type' && !['text', 'image'].includes(value)) {
            return NextResponse.json({ error: 'Тип должен быть "text" или "image"' }, { status: 400 });
        }
        if (key === 'watermark_movement' && !['static', 'rotating_corners', 'diagonal_sweep', 'smooth_drift'].includes(value)) {
            return NextResponse.json({ error: 'Неверный паттерн движения' }, { status: 400 });
        }

        await setSetting(key, value);

        const current = await getSetting(key);
        const isSecret = ['gemini_api_key', 'tmdb_api_key'].includes(key);

        logger.info('Setting updated', { key, isSecret });

        return NextResponse.json({
            success: true,
            key,
            value: isSecret ? maskSecret(current || '') : current,
        });
    } catch (error) {
        logger.error('Failed to update setting', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Ошибка обновления настройки' }, { status: 500 });
    }
}
