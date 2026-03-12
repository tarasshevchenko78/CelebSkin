import { pool, findOrCreateTag, linkVideoTag, findOrCreateCategory, linkVideoCategory } from './lib/db.js';
import slugify from 'slugify';

function makeSlug(text) {
    if (!text) return null;
    return slugify(text, { lower: true, strict: true, locale: 'en' });
}

async function main() {
    console.log('Starting backfill of BoobsRadar tags and categories...');

    // Get all videos with their raw data
    const res = await pool.query(`
        SELECT v.id as video_id, rv.raw_tags, rv.raw_categories
        FROM videos v
        JOIN raw_videos rv ON v.raw_video_id = rv.id
        WHERE v.status = 'published'
    `);

    console.log(`Found ${res.rows.length} published videos.`);

    let tagsCount = 0;
    let catsCount = 0;

    for (const row of res.rows) {
        const { video_id, raw_tags, raw_categories } = row;

        // Tags
        if (raw_tags && raw_tags.length > 0) {
            for (const tag of raw_tags) {
                if (!tag) continue;
                const tagSlug = makeSlug(tag);
                if (!tagSlug) continue;

                const tagId = await findOrCreateTag(tag, tagSlug, { en: tag, ru: tag });
                await linkVideoTag(video_id, tagId);
                tagsCount++;
            }
        }

        // Categories
        if (raw_categories && raw_categories.length > 0) {
            for (const cat of raw_categories) {
                if (!cat) continue;
                const catSlug = makeSlug(cat);
                if (!catSlug) continue;

                const catId = await findOrCreateCategory(cat, catSlug);
                await linkVideoCategory(video_id, catId);
                catsCount++;
            }
        }
    }

    console.log(`Backfill complete! Added ${tagsCount} tags and ${catsCount} categories links.`);
    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
