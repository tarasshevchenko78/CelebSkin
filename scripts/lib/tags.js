/**
 * Tag System v3 — 32 canonical tags, nationality extraction, donor tag mapping
 *
 * Exports:
 *   extractNationality(placeOfBirth) → ISO 2-letter country code or null
 *   mapDonorTags(donorTags) → array of canonical tag slugs
 *   normalizeTags(tags) → normalized array following rules
 *   BIRTH_COUNTRY_MAP, COUNTRY_GROUPS
 */

// ── 54 mappings: last segment of TMDB place_of_birth → ISO 2-letter ──
export const BIRTH_COUNTRY_MAP = {
  'usa': 'US', 'u.s.': 'US', 'united states': 'US', 'us': 'US', 'america': 'US',
  'uk': 'GB', 'united kingdom': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB', 'great britain': 'GB',
  'france': 'FR', 'germany': 'DE', 'deutschland': 'DE',
  'italy': 'IT', 'italia': 'IT',
  'spain': 'ES', 'españa': 'ES',
  'portugal': 'PT',
  'brazil': 'BR', 'brasil': 'BR',
  'canada': 'CA',
  'australia': 'AU',
  'russia': 'RU', 'ussr': 'RU', 'soviet union': 'RU', 'russian federation': 'RU',
  'japan': 'JP',
  'south korea': 'KR', 'korea': 'KR',
  'china': 'CN',
  'india': 'IN',
  'mexico': 'MX',
  'argentina': 'AR',
  'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK', 'finland': 'FI', 'iceland': 'IS',
  'netherlands': 'NL', 'holland': 'NL',
  'belgium': 'BE', 'austria': 'AT', 'switzerland': 'CH',
  'poland': 'PL', 'czech republic': 'CZ', 'czechia': 'CZ', 'slovakia': 'SK',
  'hungary': 'HU', 'romania': 'RO', 'ukraine': 'UA', 'belarus': 'BY',
  'turkey': 'TR', 'türkiye': 'TR',
  'greece': 'GR', 'ireland': 'IE',
  'new zealand': 'NZ', 'south africa': 'ZA',
  'colombia': 'CO', 'chile': 'CL', 'peru': 'PE', 'venezuela': 'VE',
  'thailand': 'TH', 'philippines': 'PH', 'indonesia': 'ID', 'vietnam': 'VN',
  'israel': 'IL', 'iran': 'IR', 'egypt': 'EG',
  'nigeria': 'NG', 'cuba': 'CU', 'jamaica': 'JM',
  'taiwan': 'TW', 'hong kong': 'HK', 'singapore': 'SG', 'malaysia': 'MY',
  'serbia': 'RS', 'croatia': 'HR', 'slovenia': 'SI', 'bosnia': 'BA',
  'bulgaria': 'BG', 'lithuania': 'LT', 'latvia': 'LV', 'estonia': 'EE',
  'georgia': 'GE', 'armenia': 'AM', 'azerbaijan': 'AZ',
  'puerto rico': 'PR', 'dominican republic': 'DO',
};

// ── Country groups for regional tags ──
export const COUNTRY_GROUPS = {
  asian: ['JP', 'KR', 'CN', 'TH', 'PH', 'ID', 'VN', 'TW', 'HK', 'SG', 'MY', 'IN'],
  scandinavian: ['SE', 'NO', 'DK', 'FI', 'IS'],
  latin: ['MX', 'AR', 'BR', 'CO', 'CL', 'PE', 'VE', 'CU', 'PR', 'DO'],
  'eastern-european': ['RU', 'UA', 'BY', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'RS', 'HR', 'SI', 'BA', 'LT', 'LV', 'EE', 'GE', 'AM', 'AZ'],
  'western-european': ['GB', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'AT', 'CH', 'IE', 'GR'],
};

/**
 * Extract ISO 2-letter nationality from TMDB place_of_birth string.
 * E.g. "Springfield, Illinois, USA" → "US"
 *      "London, England" → "GB"
 */
export function extractNationality(placeOfBirth) {
  if (!placeOfBirth || typeof placeOfBirth !== 'string') return null;

  // Try from last segment backwards (most specific → least specific)
  const segments = placeOfBirth.split(',').map(s => s.trim().toLowerCase());

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (BIRTH_COUNTRY_MAP[seg]) {
      return BIRTH_COUNTRY_MAP[seg];
    }
  }

  return null;
}

// ── Donor tag → canonical slug mapping (72+ mappings) ──
const DONOR_TAG_MAP = {
  // nudity_level
  'sexy': 'sexy', 'hot': 'sexy', 'сексуальная': 'sexy',
  'cleavage': 'cleavage', 'декольте': 'cleavage',
  'bikini': 'bikini', 'бикини': 'bikini', 'swimsuit': 'bikini',
  'lingerie': 'lingerie', 'белье': 'lingerie', 'бельё': 'lingerie',
  'topless': 'topless', 'топлес': 'topless', 'tits': 'topless', 'boobs': 'topless', 'breasts': 'topless',
  'butt': 'butt', 'ass': 'butt', 'попа': 'butt', 'задница': 'butt',
  'nude': 'nude', 'naked': 'nude', 'нагота': 'nude', 'обнаженная': 'nude', 'голая': 'nude',
  'full frontal': 'full-frontal', 'full-frontal': 'full-frontal', 'полная обнаженка': 'full-frontal',
  'bush': 'bush', 'pubic': 'bush',
  // scene_type
  'sex scene': 'sex-scene', 'sex-scene': 'sex-scene', 'секс': 'sex-scene', 'сцена секса': 'sex-scene',
  'explicit': 'explicit', 'unsimulated': 'explicit',
  'oral': 'oral', 'oral sex': 'oral',
  'blowjob': 'blowjob', 'bj': 'blowjob', 'минет': 'blowjob',
  'lesbian': 'lesbian', 'лесби': 'lesbian', 'girl on girl': 'lesbian',
  'masturbation': 'masturbation', 'мастурбация': 'masturbation',
  'striptease': 'striptease', 'strip': 'striptease', 'стриптиз': 'striptease',
  'shower': 'shower', 'shower scene': 'shower', 'душ': 'shower',
  'skinny dip': 'skinny-dip', 'skinny-dip': 'skinny-dip', 'skinny dipping': 'skinny-dip',
  'rape': 'rape-scene', 'rape scene': 'rape-scene', 'rape-scene': 'rape-scene',
  'gang rape': 'gang-rape', 'gang-rape': 'gang-rape',
  'bed scene': 'bed-scene', 'bed-scene': 'bed-scene', 'bed': 'bed-scene', 'постельная сцена': 'bed-scene',
  'romantic': 'romantic', 'romance': 'romantic', 'романтика': 'romantic',
  'rough': 'rough',
  'threesome': 'threesome', 'тройничок': 'threesome',
  'bdsm': 'bdsm',
  'body double': 'body-double', 'body-double': 'body-double',
  'prosthetic': 'prosthetic',
  // media_type
  'movie': 'movie', 'film': 'movie', 'фильм': 'movie',
  'tv show': 'tv-show', 'tv-show': 'tv-show', 'tv series': 'tv-show', 'series': 'tv-show', 'сериал': 'tv-show',
  'music video': 'music-video', 'music-video': 'music-video', 'клип': 'music-video',
  'on stage': 'on-stage', 'on-stage': 'on-stage', 'stage': 'on-stage',
  'photoshoot': 'photoshoot', 'photo shoot': 'photoshoot', 'фотосессия': 'photoshoot',
  // context
  'erotic': 'sexy', 'эротика': 'sexy',
  'drama': 'movie', 'thriller': 'movie', 'comedy': 'movie', 'horror': 'movie',
  'bath': 'shower', 'bathtub': 'shower', 'ванна': 'shower',
  'pool': 'skinny-dip', 'swimming': 'skinny-dip', 'бассейн': 'skinny-dip',
  'underwear': 'lingerie',
};

// 32 canonical slugs
const CANONICAL_SLUGS = new Set([
  'sexy', 'cleavage', 'bikini', 'lingerie', 'topless', 'butt', 'nude',
  'full-frontal', 'bush', 'sex-scene', 'explicit', 'oral', 'blowjob',
  'lesbian', 'masturbation', 'striptease', 'shower', 'skinny-dip',
  'rape-scene', 'gang-rape', 'bed-scene', 'romantic', 'rough',
  'threesome', 'bdsm', 'body-double', 'prosthetic',
  'movie', 'tv-show', 'music-video', 'on-stage', 'photoshoot',
]);

/**
 * Map donor tags (from scraper) to canonical tag slugs.
 * Returns deduplicated array of canonical slugs.
 */
export function mapDonorTags(donorTags) {
  if (!Array.isArray(donorTags) || donorTags.length === 0) return [];

  const result = new Set();

  for (const tag of donorTags) {
    const lower = String(tag).toLowerCase().trim();

    // Direct canonical match
    if (CANONICAL_SLUGS.has(lower)) {
      result.add(lower);
      continue;
    }

    // Mapped match
    if (DONOR_TAG_MAP[lower]) {
      result.add(DONOR_TAG_MAP[lower]);
      continue;
    }

    // Slugified match
    const slug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (CANONICAL_SLUGS.has(slug)) {
      result.add(slug);
    }
  }

  return [...result];
}

/**
 * Normalize tags following rules:
 * 1 nudity + [bush] + 0-1 scene + 0-2 context + 1 media
 */
export function normalizeTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return [];

  const NUDITY = ['sexy', 'cleavage', 'bikini', 'lingerie', 'topless', 'butt', 'nude', 'full-frontal'];
  const SCENE = ['sex-scene', 'explicit', 'oral', 'blowjob', 'lesbian', 'masturbation', 'striptease', 'shower', 'skinny-dip', 'rape-scene', 'gang-rape', 'bed-scene'];
  const CONTEXT = ['romantic', 'rough', 'threesome', 'bdsm', 'body-double', 'prosthetic'];
  const MEDIA = ['movie', 'tv-show', 'music-video', 'on-stage', 'photoshoot'];

  const result = [];
  const tagSet = new Set(tags.filter(t => CANONICAL_SLUGS.has(t)));

  // 1 nudity (highest level)
  for (const n of NUDITY.reverse()) {
    if (tagSet.has(n)) { result.push(n); break; }
  }

  // bush is additive
  if (tagSet.has('bush')) result.push('bush');

  // 0-1 scene
  for (const s of SCENE) {
    if (tagSet.has(s)) { result.push(s); break; }
  }

  // 0-2 context
  let ctxCount = 0;
  for (const c of CONTEXT) {
    if (tagSet.has(c) && ctxCount < 2) { result.push(c); ctxCount++; }
  }

  // 1 media
  for (const m of MEDIA) {
    if (tagSet.has(m)) { result.push(m); break; }
  }

  return result;
}
