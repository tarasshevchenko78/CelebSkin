import { NextRequest, NextResponse } from 'next/server';
import { uploadBuffer } from '@/lib/bunny';
import { setSetting } from '@/lib/db/settings';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/png', 'image/webp'];

// POST /api/admin/watermark/upload — upload PNG watermark to BunnyCDN
export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'Файл не предоставлен' }, { status: 400 });
        }

        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json({ error: 'Допустимые форматы: PNG, WebP' }, { status: 400 });
        }

        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: 'Максимальный размер файла: 2 МБ' }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const ext = file.type === 'image/webp' ? 'webp' : 'png';
        const remotePath = `watermarks/watermark-${Date.now()}.${ext}`;

        const cdnUrl = await uploadBuffer(buffer, remotePath, file.type);

        // Save URL to settings
        await setSetting('watermark_image_url', cdnUrl);
        await setSetting('watermark_type', 'image');

        logger.info('Watermark uploaded', { cdnUrl, size: file.size });

        return NextResponse.json({
            success: true,
            url: cdnUrl,
            size: file.size,
        });
    } catch (error) {
        logger.error('Watermark upload failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Ошибка загрузки водяного знака' }, { status: 500 });
    }
}
