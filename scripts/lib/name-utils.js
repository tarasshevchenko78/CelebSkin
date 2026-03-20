/**
 * name-utils.js — Celebrity name cleaning & collection Title Case
 */

// ── CELEBRITY NAME CLEANING ──

const GENRE_WORDS = new Set([
  'asian', 'classic', 'vintage', 'retro', 'erotic', 'explicit', 'nude',
  'nudity', 'naked', 'sexy', 'hot', 'mainstream', 'french', 'deutsh',
  'german', 'italian', 'american', 'european', 'amateur', 'lesbian',
  'peeping', 'voyeur', 'outdoor', 'outdoors', 'public', 'fetish',
  'thriller', 'horror', 'comedy', 'drama',
]);

const DESCRIPTOR_WORDS = new Set([
  'movie', 'scene', 'scenes', 'film', 'celeb', 'celebs', 'celebrity',
  'striptease', 'strip', 'full', 'frontal', 'masturbation', 'blowjob',
  'sex', 'boobs', 'tits', 'nipples', 'topless', 'webcam', 'solo',
  'bathing', 'downblouse', 'lactation', 'close-up',
]);

/**
 * Clean a celebrity name extracted from scraper.
 * Returns cleaned name or null if it's not a real person name.
 */
export function cleanCelebrityName(name) {
  if (!name || name.length < 2) return null;
  let cleaned = name.trim();

  // Decode HTML entities
  cleaned = cleaned.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  cleaned = cleaned.replace(/&amp;/g, '&').replace(/&quot;/g, '"');

  // Remove trailing dots/spaces
  cleaned = cleaned.replace(/[\s.]+$/, '').trim();

  // Remove "etc." suffix
  cleaned = cleaned.replace(/\s+etc\.?$/i, '').trim();

  // Pattern: "Genre Descriptor. Real Name" or "Genre Descriptor. Movie Info. Real Name"
  // Split by ". " and check if prefix parts are genre/descriptor words
  const dotParts = cleaned.split(/\.\s+/);
  if (dotParts.length >= 2) {
    // Check if first part is genre/descriptor
    const firstWords = dotParts[0].toLowerCase().split(/\s+/);
    const isGenrePrefix = firstWords.some(w => GENRE_WORDS.has(w) || DESCRIPTOR_WORDS.has(w));

    if (isGenrePrefix) {
      // Find the last part that looks like a person name (Capitalized words, 2-4 words)
      for (let i = dotParts.length - 1; i >= 1; i--) {
        const part = dotParts[i].trim()
          .replace(/\s*\(\d{4}\)\s*/g, '') // remove years
          .replace(/[\s.]+$/, '')           // trailing dots
          .trim();
        if (looksLikePersonName(part)) {
          cleaned = part;
          break;
        }
      }
    }
  }

  // Pattern: "Name nackte/naked/nkaed/nude/hot. Movie info"
  cleaned = cleaned.replace(/\s+(nackte?|nkaed|naked|nude\b|hot)\b.*/i, '').trim();

  // Pattern: "Descriptor Scene with Name" or "... with actresses: Name"
  const withMatch = cleaned.match(/\bwith(?:\s+actresses)?[:\s]+([A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ]+)+)/i);
  if (withMatch && /^(lesbian|nude|sexy|hot|erotic|vintage|classic|peeping|public)/i.test(cleaned)) {
    const extracted = withMatch[1].trim();
    if (looksLikePersonName(extracted)) {
      cleaned = extracted;
    }
  }

  // Pattern: "Name Hot Striptease Scene" — remove trailing descriptors
  cleaned = cleaned
    .replace(/\s+hot\s+(striptease|strip|scene).*$/i, '')
    .replace(/\s+(full\s+frontal|retro\s+horror|hot\s+hollywood).*$/i, '')
    .trim();

  // Remove year patterns "(1999)" and quoted movie titles
  cleaned = cleaned.replace(/\s*\(\d{4}\)\s*/g, '').trim();
  cleaned = cleaned.replace(/\s*"[^"]*"\s*/g, ' ').trim();
  cleaned = cleaned.replace(/\s*&#34;[^&]*&#34;\s*/g, ' ').trim();

  // Remove trailing dots/spaces again
  cleaned = cleaned.replace(/[\s.]+$/, '').trim();

  // Final validation: must look like a person name
  if (!looksLikePersonName(cleaned)) return null;
  if (cleaned.length < 3 || cleaned.length > 60) return null;

  return cleaned;
}

/**
 * Check if text looks like a person's name:
 * - 1-4 words
 * - First word starts with uppercase
 * - Not all genre/descriptor words
 */
function looksLikePersonName(text) {
  if (!text || text.length < 2) return false;

  const words = text.split(/\s+/);
  if (words.length < 1 || words.length > 5) return false;

  // First word must start with uppercase letter
  if (!/^[A-ZÀ-Ÿ]/.test(words[0])) return false;

  // "The Something" with only 2 words starting with "The" is likely a title, not a person
  if (words.length <= 2 && words[0].toLowerCase() === 'the') return false;

  // Check it's not entirely generic words
  const allGeneric = words.every(w => {
    const lw = w.toLowerCase().replace(/[^a-z]/g, '');
    return GENRE_WORDS.has(lw) || DESCRIPTOR_WORDS.has(lw) ||
      ['the', 'of', 'in', 'with', 'and', 'from', 'for', 'a', 'an'].includes(lw);
  });
  if (allGeneric) return false;

  return true;
}


// ── COLLECTION TITLE CASE ──

const CAPS_EXCEPTIONS = new Set(['TV', 'HD', 'BDSM', 'VR', 'POV', '3D', 'BBC', 'BTS', 'DIY']);

/**
 * Convert an ALL CAPS string to Title Case, preserving known abbreviations.
 * "TV SHOW NUDITY" → "TV Show Nudity"
 * "FULL FRONTAL" → "Full Frontal"
 */
export function toTitleCase(str) {
  if (!str) return str;
  return str.split(/\s+/).map(word => {
    if (CAPS_EXCEPTIONS.has(word.toUpperCase())) return word.toUpperCase();
    // Year-prefixed tokens (e.g., "2024") stay as-is
    if (/^\d+$/.test(word)) return word;
    // Lowercase everything then capitalize first letter
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}
