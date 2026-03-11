import { config } from './config';
import { logger } from './logger';

/**
 * Upload a buffer to BunnyCDN Storage from AbeloHost.
 * Used for watermark PNG upload and screenshot uploads from admin panel.
 *
 * @param buffer - File content as Buffer
 * @param remotePath - Path within storage zone (e.g. 'watermarks/watermark-123.png')
 * @param contentType - MIME type (e.g. 'image/png')
 * @returns CDN URL of the uploaded file
 */
export async function uploadBuffer(
    buffer: Buffer,
    remotePath: string,
    contentType: string
): Promise<string> {
    const storageUrl = `https://${config.bunny.storageHost}/${config.bunny.storageZone}/${remotePath}`;

    const res = await fetch(storageUrl, {
        method: 'PUT',
        headers: {
            'AccessKey': config.bunny.storageKey,
            'Content-Type': contentType,
        },
        body: new Uint8Array(buffer),
    });

    if (!res.ok) {
        const errText = await res.text();
        logger.error('BunnyCDN upload failed', { remotePath, status: res.status, body: errText });
        throw new Error(`BunnyCDN upload failed: ${res.status} ${res.statusText}`);
    }

    const cdnUrl = `${config.bunny.cdnUrl}/${remotePath}`;
    logger.info('BunnyCDN upload success', { remotePath, cdnUrl, size: buffer.length });
    return cdnUrl;
}

/**
 * Delete a file from BunnyCDN Storage.
 */
export async function deleteFile(remotePath: string): Promise<void> {
    const storageUrl = `https://${config.bunny.storageHost}/${config.bunny.storageZone}/${remotePath}`;

    const res = await fetch(storageUrl, {
        method: 'DELETE',
        headers: { 'AccessKey': config.bunny.storageKey },
    });

    if (!res.ok && res.status !== 404) {
        logger.error('BunnyCDN delete failed', { remotePath, status: res.status });
        throw new Error(`BunnyCDN delete failed: ${res.status}`);
    }
}
