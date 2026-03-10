import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/upload
 * Upload celebrity photo or movie poster to BunnyCDN
 *
 * FormData: { file: File, type: 'celebrity' | 'movie', id: string, slug: string }
 */
export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const type = formData.get('type') as string;
        const id = formData.get('id') as string;
        const slug = formData.get('slug') as string;

        if (!file || !type || !id || !slug) {
            return NextResponse.json({ error: 'Missing required fields: file, type, id, slug' }, { status: 400 });
        }

        if (!config.bunny.storageKey) {
            return NextResponse.json({ error: 'BunnyCDN not configured' }, { status: 500 });
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            return NextResponse.json({ error: 'Only image files allowed' }, { status: 400 });
        }

        // Max 10MB
        if (file.size > 10 * 1024 * 1024) {
            return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
        }

        // Determine remote path
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const validExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
        let remotePath: string;
        let dbColumn: string;
        let dbTable: string;

        if (type === 'celebrity') {
            remotePath = `celebrities/${slug}/photo.${validExt}`;
            dbColumn = 'photo_url';
            dbTable = 'celebrities';
        } else if (type === 'movie') {
            remotePath = `movies/${slug}/poster.${validExt}`;
            dbColumn = 'poster_url';
            dbTable = 'movies';
        } else {
            return NextResponse.json({ error: 'Invalid type. Use "celebrity" or "movie"' }, { status: 400 });
        }

        // Upload to BunnyCDN
        const buffer = Buffer.from(await file.arrayBuffer());
        const uploadUrl = `https://${config.bunny.storageHost}/${config.bunny.storageZone}/${remotePath}`;

        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'AccessKey': config.bunny.storageKey,
                'Content-Type': file.type,
            },
            body: buffer,
        });

        if (!uploadRes.ok) {
            const text = await uploadRes.text();
            return NextResponse.json({ error: `CDN upload failed: ${uploadRes.status} ${text}` }, { status: 500 });
        }

        const cdnUrl = `${config.bunny.cdnUrl}/${remotePath}`;

        // Update DB
        await pool.query(
            `UPDATE ${dbTable} SET ${dbColumn} = $1, updated_at = NOW() WHERE id = $2`,
            [cdnUrl, type === 'celebrity' ? parseInt(id) : parseInt(id)]
        );

        return NextResponse.json({ url: cdnUrl, message: 'Uploaded successfully' });
    } catch (error) {
        logger.error('Upload failed', { route: '/api/admin/upload', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: `Upload failed: ${error}` }, { status: 500 });
    }
}
