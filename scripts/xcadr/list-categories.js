#!/usr/bin/env node
/**
 * list-categories.js — fetch available categories (подборки) from xcadr.online
 *
 * Usage:
 *   node xcadr/list-categories.js
 *
 * Output: JSON array of { name, url, count } to stdout
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

const XCADR_BASE = 'https://xcadr.online';
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];
const USER_AGENT = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

async function main() {
  try {
    const response = await axios.get(`${XCADR_BASE}/podborki/`, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);
    const categories = [];

    // Look for collection/podborki links with their names
    $('a[href]').each(function () {
      const href = $(this).attr('href') || '';
      // Match /podborki/{slug}/ or /collection/{slug}/
      if (/\/(podborki|collection)\/[^/]+\//.test(href)) {
        const text = $(this).text().trim();
        if (!text || text.length > 100) return;

        const url = href.startsWith('http') ? href : XCADR_BASE + (href.startsWith('/') ? '' : '/') + href;

        // Extract count if present (e.g. "Category Name (42)")
        const countMatch = text.match(/\((\d+)\)\s*$/);
        const count = countMatch ? parseInt(countMatch[1]) : null;
        const name = text.replace(/\s*\(\d+\)\s*$/, '').trim();

        if (name && !categories.find(c => c.url === url)) {
          categories.push({ name, url, count });
        }
      }
    });

    // Also try the main collections page structure
    if (categories.length === 0) {
      // Fallback: look for any links containing "podborki" or "collection" in href
      $('a[href*="podborki"], a[href*="collection"]').each(function () {
        const href = $(this).attr('href') || '';
        if (href === '/podborki/' || href === '/collections/' || href === `${XCADR_BASE}/podborki/`) return;

        const text = $(this).text().trim();
        if (!text || text.length > 100) return;

        const url = href.startsWith('http') ? href : XCADR_BASE + (href.startsWith('/') ? '' : '/') + href;
        const name = text.replace(/\s*\(\d+\)\s*$/, '').trim();

        if (name && !categories.find(c => c.url === url)) {
          categories.push({ name, url, count: null });
        }
      });
    }

    console.log(JSON.stringify(categories));
  } catch (err) {
    console.error(`[ERROR] Failed to fetch categories: ${err.message}`);
    process.exit(1);
  }
}

main();
