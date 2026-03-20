/**
 * BoobsRadar Adapter — scrapes boobsradar.com
 *
 * Methods:
 *   getCategories()               → [{slug, title, url}]
 *   getVideoList(categoryUrl, page) → {videos: [{url, title, thumbnail, duration}], lastPage}
 *   parseVideoPage(videoUrl)      → {raw_title, description, thumbnail_url, video_file_url, ...}
 *   delay(ms)                     → Promise
 */

import axios from 'axios';
import { cleanCelebrityName } from '../lib/name-utils.js';

const BASE = 'https://boobsradar.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function headers() {
    return {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': BASE + '/',
    };
}

async function fetchHtml(url) {
    const res = await axios.get(url, {
        headers: headers(),
        timeout: 30000,
        maxRedirects: 5,
    });
    return res.data;
}

/**
 * Parse duration string like "3:45" or "1:23:45" to seconds
 */
function parseDuration(str) {
    if (!str) return null;
    const parts = str.trim().split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
}

export default class BoobsRadarAdapter {

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Fetch all categories from /categories/ page
     */
    async getCategories() {
        const html = await fetchHtml(`${BASE}/categories/`);
        const categories = [];

        // Match category links: <a class="item" href="...nudes/slug/" title="TITLE">
        const re = /<a\s+[^>]*href="((?:https?:\/\/boobsradar\.com)?\/nudes\/([^"]+?)\/)"[^>]*title="([^"]+)"[^>]*>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const rawUrl = m[1];
            const url = rawUrl.startsWith('http') ? rawUrl : BASE + rawUrl;
            const slug = m[2];
            const title = m[3].trim();
            if (title && slug && !categories.find(c => c.slug === slug)) {
                categories.push({ slug, title, url });
            }
        }
        // Also try reverse attribute order: title before href
        const re2 = /<a\s+[^>]*title="([^"]+)"[^>]*href="((?:https?:\/\/boobsradar\.com)?\/nudes\/([^"]+?)\/)"[^>]*>/gi;
        while ((m = re2.exec(html)) !== null) {
            const title = m[1].trim();
            const rawUrl = m[2];
            const url = rawUrl.startsWith('http') ? rawUrl : BASE + rawUrl;
            const slug = m[3];
            if (title && slug && !categories.find(c => c.slug === slug)) {
                categories.push({ slug, title, url });
            }
        }

        return categories;
    }

    /**
     * Fetch video list from a category page with pagination
     */
    async getVideoList(categoryUrl, page = 1) {
        const url = page > 1 ? `${categoryUrl}?from=${page}` : categoryUrl;
        const html = await fetchHtml(url);

        const videos = [];

        // Find video links: href="/videos/slug/"
        // Each video card has: <a href="...">, <img>, <strong>Title</strong>, <span>duration</span>
        // We use a broader regex to capture video cards

        // Extract all video links
        const linkRe = /<a\s+href="(https?:\/\/boobsradar\.com\/videos\/[^"]+\/)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = linkRe.exec(html)) !== null) {
            const videoUrl = m[1];
            const cardHtml = m[2];

            // Extract title from <strong> or alt attribute
            const titleMatch = cardHtml.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)
                || cardHtml.match(/alt="([^"]+)"/i);
            const title = titleMatch
                ? titleMatch[1].replace(/<[^>]+>/g, '').trim()
                : '';

            // Extract thumbnail from img src or data-src
            const imgMatch = cardHtml.match(/(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
            const thumbnail = imgMatch ? imgMatch[1] : null;

            // Extract duration from first <span> with time pattern
            const durMatch = cardHtml.match(/<span[^>]*>(\d{1,2}:\d{2}(?::\d{2})?)<\/span>/i);
            const duration = durMatch ? durMatch[1] : null;

            if (title && !videos.find(v => v.url === videoUrl)) {
                videos.push({
                    url: videoUrl,
                    title,
                    thumbnail: thumbnail || null,
                    duration: duration || null,
                });
            }
        }

        // Determine last page from pagination
        let lastPage = page;
        // Look for: ?from=N in pagination links
        const pageRe = /[?&]from=(\d+)/g;
        let pm;
        while ((pm = pageRe.exec(html)) !== null) {
            const p = parseInt(pm[1]);
            if (p > lastPage) lastPage = p;
        }

        return { videos, lastPage };
    }

    /**
     * Parse an individual video page — extract all metadata
     */
    async parseVideoPage(videoUrl) {
        const html = await fetchHtml(videoUrl);

        const metadata = {
            source_url: videoUrl,
            raw_title: '',
            description: '',
            thumbnail_url: null,
            video_file_url: null,
            embed_code: null,
            duration_seconds: null,
            duration_formatted: null,
            tags: [],
            categories: [],
            celebrities: [],
            views: null,
            rating: null,
        };

        // Title: <title> tag or <h1>
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
            || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (titleMatch) {
            metadata.raw_title = titleMatch[1]
                .replace(/<[^>]+>/g, '')
                .replace(/\s*[-|]\s*BoobsRadar.*$/i, '')
                .replace(/\s*Nude\s+Tits\s+Celebs\s*$/i, '')
                .trim();
        }

        // Description: <meta name="description"> or og:description
        const descMatch = html.match(/meta\s+(?:name|property)="(?:description|og:description)"\s+content="([^"]*)"/i)
            || html.match(/meta\s+content="([^"]*)"\s+(?:name|property)="(?:description|og:description)"/i);
        if (descMatch) {
            metadata.description = descMatch[1].trim();
        }

        // Thumbnail / poster: JS preview_url, og:image, or preview.jpg
        const jsPreviewMatch = html.match(/preview_url:\s*'(https?:\/\/[^']+)'/);
        if (jsPreviewMatch) {
            metadata.thumbnail_url = jsPreviewMatch[1];
        }
        if (!metadata.thumbnail_url) {
            const ogImgMatch = html.match(/meta\s+(?:property|name)="og:image"\s+content="([^"]*)"/i)
                || html.match(/meta\s+content="([^"]*)"\s+(?:property|name)="og:image"/i);
            if (ogImgMatch) metadata.thumbnail_url = ogImgMatch[1];
        }
        if (!metadata.thumbnail_url) {
            const previewMatch = html.match(/(https?:\/\/boobsradar\.com\/contents\/[^"'\s]+preview\.jpg)/i);
            if (previewMatch) metadata.thumbnail_url = previewMatch[1];
        }

        // Video file URL: prefer JS object video_url, fallback to raw .mp4 scan
        const jsVideoMatch = html.match(/video_url:\s*'(https?:\/\/[^']+\.mp4[^']*)'/);
        if (jsVideoMatch) {
            metadata.video_file_url = jsVideoMatch[1];
        } else {
            const mp4Matches = html.match(/https?:\/\/[^"'\s,]+\.mp4[^"'\s,]*/gi) || [];
            if (mp4Matches.length > 0) {
                metadata.video_file_url = mp4Matches.find(u => u.includes('get_file')) || mp4Matches[0];
                metadata.video_file_url = metadata.video_file_url.replace(/['"\\]/g, '');
            }
        }

        // Embed URL: /embed/ID
        const embedMatch = html.match(/\/embed\/(\d+)/);
        if (embedMatch) {
            metadata.embed_code = `${BASE}/embed/${embedMatch[1]}`;
        }

        // Duration: first <div class="duration"> or <span class="duration">
        const durMatch = html.match(/<div[^>]*class="duration"[^>]*>(\d{1,2}:\d{2}(?::\d{2})?)<\/div>/i)
            || html.match(/<span[^>]*class="[^"]*duration[^"]*"[^>]*>(\d{1,2}:\d{2}(?::\d{2})?)<\/span>/i);
        if (durMatch) {
            metadata.duration_formatted = durMatch[1];
            metadata.duration_seconds = parseDuration(durMatch[1]);
        }

        // Tags: extract from JS object video_tags or /tags/ links or meta keywords
        const jsTagsMatch = html.match(/video_tags:\s*'([^']+)'/);
        if (jsTagsMatch) {
            metadata.tags = jsTagsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
        }
        if (metadata.tags.length === 0) {
            // Fallback: /tags/ links
            const tagRe = /<a\s+href="(?:https?:\/\/boobsradar\.com)?\/tags\/[^"]+\/"[^>]*><h3>\s*([^<]+)<\/h3><\/a>/gi;
            let tagM;
            while ((tagM = tagRe.exec(html)) !== null) {
                const tag = tagM[1].trim();
                if (tag && !metadata.tags.find(t => t.toLowerCase() === tag.toLowerCase())) {
                    metadata.tags.push(tag);
                }
            }
        }
        if (metadata.tags.length === 0) {
            // Fallback: meta keywords
            const kwMatch = html.match(/meta\s+name="keywords"\s+content="([^"]*)"/i);
            if (kwMatch) {
                metadata.tags = kwMatch[1].split(',').map(t => t.trim()).filter(Boolean);
            }
        }

        // Categories: from JS object video_categories or /nudes/ links
        const jsCatsMatch = html.match(/video_categories:\s*'([^']+)'/);
        if (jsCatsMatch) {
            metadata.categories = jsCatsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
        } else {
            const catRe = /<a\s+href="(?:https?:\/\/boobsradar\.com)?\/nudes\/([^"]+?)\/"[^>]*>([^<]+)<\/a>/gi;
            let catM;
            while ((catM = catRe.exec(html)) !== null) {
                const cat = catM[2].trim();
                if (cat && !metadata.categories.includes(cat)) {
                    metadata.categories.push(cat);
                }
            }
        }

        // Extract celebrity names from title:
        // Pattern: "Name1, Name2 nude - Movie Title (Year)"
        // or "Name nude scene in Movie (Year)"
        const celebMatch = metadata.raw_title.match(/^([^-–—]+?)(?:\s+nude|\s+naked|\s+topless|\s+sex|\s+bikini)/i);
        if (celebMatch) {
            const names = celebMatch[1].split(/,\s*/)
                .map(n => cleanCelebrityName(n.trim()))
                .filter(Boolean);
            metadata.celebrities = names;
        }

        // Extract movie title from title:
        // "... nude - Movie Title (Year)" or "... in Movie Title (Year)"
        const movieMatch = metadata.raw_title.match(/(?:[-–—]\s*|(?:nude|naked|sex|scene)\s+(?:in|from)\s+)(.+?)(?:\s*\(\d{4}\))?$/i);
        if (movieMatch) {
            metadata.movie_title = movieMatch[1].replace(/\s*\(\d{4}\)\s*$/, '').trim();
        }

        // Extract year
        const yearMatch = metadata.raw_title.match(/\((\d{4})\)/);
        if (yearMatch) {
            metadata.year = parseInt(yearMatch[1]);
        }

        // Views
        const viewsMatch = html.match(/(\d[\d\s,.]+)\s*(?:views|просмотр)/i);
        if (viewsMatch) {
            metadata.views = parseInt(viewsMatch[1].replace(/[\s,.]/g, ''));
        }

        return metadata;
    }
}
