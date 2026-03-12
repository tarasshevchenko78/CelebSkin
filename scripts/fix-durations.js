import { exec } from 'child_process';
import { promisify } from 'util';
import { query } from './lib/db.js';

const execAsync = promisify(exec);

function formatDuration(seconds) {
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

async function getVideoDuration(url) {
    try {
        const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${url}"`);
        const duration = parseFloat(stdout.trim());
        if (!isNaN(duration) && duration > 0) {
            return duration;
        }
    } catch (e) {
        console.error(`Failed to probe ${url}: ${e.message}`);
    }
    return null;
}

async function run() {
    console.log('Fetching all videos...');
    const res = await query('SELECT id, video_url_watermarked, video_url, duration_seconds FROM videos ORDER BY published_at DESC');
    console.log(`Found ${res.rows.length} videos.`);

    let updated = 0;
    for (const row of res.rows) {
        const url = row.video_url_watermarked || row.video_url;
        if (!url || !url.startsWith('http')) continue;

        console.log(`Probing ${row.id} ...`);
        const actualDuration = await getVideoDuration(url);

        if (actualDuration && Math.abs(actualDuration - (row.duration_seconds || 0)) > 5) {
            const formatted = formatDuration(actualDuration);
            const seconds = Math.round(actualDuration);
            console.log(`  Updating from ${row.duration_seconds} to ${seconds} (${formatted})`);
            await query('UPDATE videos SET duration_seconds=$1, duration_formatted=$2 WHERE id=$3', [seconds, formatted, row.id]);
            updated++;
        }
    }
    console.log(`Done! Updated ${updated} videos.`);
    process.exit(0);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
