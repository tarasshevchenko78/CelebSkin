import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { uploadBuffer } from '@/lib/bunny';
import { logger } from '@/lib/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);

// POST /api/admin/videos/[id]/screenshot
// Two modes:
//   1. FormData with 'file' blob — client-side canvas capture, upload directly
//   2. JSON { timestamp } — server-side FFmpeg capture on Contabo via SSH
export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    const videoId = params.id;

    try {
        // Check if request is FormData (client-side capture) or JSON (server capture)
        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('multipart/form-data')) {
            // ── Client-side capture: receive blob, upload to BunnyCDN ──
            const formData = await request.formData();
            const file = formData.get('file') as File | null;

            if (!file) {
                return NextResponse.json({ error: 'Файл не предоставлен' }, { status: 400 });
            }

            if (file.size > 5 * 1024 * 1024) {
                return NextResponse.json({ error: 'Максимальный размер: 5 МБ' }, { status: 400 });
            }

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const timestamp = Date.now();
            const remotePath = `videos/${videoId}/screenshots/capture-${timestamp}.jpg`;
            const cdnUrl = await uploadBuffer(buffer, remotePath, 'image/jpeg');

            // Append to screenshots array in DB
            await pool.query(
                `UPDATE videos SET
                    screenshots = COALESCE(screenshots, '[]'::jsonb) || $2::jsonb,
                    updated_at = NOW()
                WHERE id = $1`,
                [videoId, JSON.stringify([cdnUrl])]
            );

            logger.info('Screenshot captured (client)', { videoId, cdnUrl });
            return NextResponse.json({ success: true, url: cdnUrl });
        }

        // ── Server-side capture via FFmpeg on Contabo ──
        const body = await request.json();
        const { timestamp } = body as { timestamp?: number };

        if (timestamp === undefined || typeof timestamp !== 'number') {
            return NextResponse.json({ error: 'timestamp (number) is required' }, { status: 400 });
        }

        // Get video URL from DB
        const dbRes = await pool.query(
            'SELECT video_url, video_url_watermarked FROM videos WHERE id = $1',
            [videoId]
        );
        const video = dbRes.rows[0];
        if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

        const videoUrl = video.video_url_watermarked || video.video_url;
        if (!videoUrl) return NextResponse.json({ error: 'No video URL available' }, { status: 400 });

        // Run FFmpeg on Contabo via SSH
        const remoteFileName = `screenshot_${videoId}_${timestamp}.jpg`;
        const remoteTmpPath = `/tmp/${remoteFileName}`;
        const cdnRemotePath = `videos/${videoId}/screenshots/capture-${Date.now()}.jpg`;

        const sshOpts = `-o ConnectTimeout=10 -o StrictHostKeyChecking=no -i ${config.contabo.sshKey}`;
        const ffmpegCmd = `ffmpeg -ss ${timestamp} -i "${videoUrl}" -vframes 1 -q:v 2 -y ${remoteTmpPath}`;

        // Execute FFmpeg + upload on Contabo
        const uploadCmd = [
            ffmpegCmd,
            `&& node -e "`,
            `const {uploadFile} = require('./lib/bunny.js');`,
            `uploadFile('${remoteTmpPath}', '${cdnRemotePath}')`,
            `.then(url => { console.log('CDN_URL:' + url); process.exit(0); })`,
            `.catch(e => { console.error(e.message); process.exit(1); });`,
            `"`,
        ].join('');

        const sshCmd = `ssh ${sshOpts} ${config.contabo.host} "cd /opt/celebskin/scripts && ${uploadCmd}"`;

        const { stdout } = await execAsync(sshCmd, { timeout: 60000 });

        // Extract CDN URL from stdout
        const urlMatch = stdout.match(/CDN_URL:(.+)/);
        const cdnUrl = urlMatch ? urlMatch[1].trim() : `${config.bunny.cdnUrl}/${cdnRemotePath}`;

        // Append to screenshots array
        await pool.query(
            `UPDATE videos SET
                screenshots = COALESCE(screenshots, '[]'::jsonb) || $2::jsonb,
                updated_at = NOW()
            WHERE id = $1`,
            [videoId, JSON.stringify([cdnUrl])]
        );

        logger.info('Screenshot captured (server)', { videoId, timestamp, cdnUrl });
        return NextResponse.json({ success: true, url: cdnUrl });
    } catch (error) {
        logger.error('Screenshot capture failed', {
            videoId,
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: 'Ошибка захвата скриншота' }, { status: 500 });
    }
}
