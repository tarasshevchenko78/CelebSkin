import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { cached } from '@/lib/cache';
import { logger } from '@/lib/logger';
import { expandQueryWithGemini } from '@/lib/search/query-expander';

export const dynamic = 'force-dynamic';

interface SearchRow {
    entity_type: string;
    entity_id: string;
    entity_slug: string;
    display_name: string;
    rank_score: number;
    match_type: string;
}

interface SmartSearchResult {
    tags: SearchRow[];
    celebrities: SearchRow[];
    collections: SearchRow[];
    videos: SearchRow[];
}

/**
 * GET /api/search?q=...&phase=1&lang=en&hydrate=false
 *
 * Phase 1: synonym expansion + smart_search (fulltext + trigram + fuzzy)
 * Phase 2: Gemini semantic expansion + smart_search
 * hydrate=true: fetch full entity objects for page rendering
 */
export async function GET(request: NextRequest) {
    const q = (request.nextUrl.searchParams.get('q') || '').trim();
    const phase = request.nextUrl.searchParams.get('phase') || '1';
    const lang = request.nextUrl.searchParams.get('lang') || 'en';
    const hydrate = request.nextUrl.searchParams.get('hydrate') === 'true';

    const empty: SmartSearchResult = { tags: [], celebrities: [], collections: [], videos: [] };

    if (q.length < 2) {
        if (hydrate) return NextResponse.json({ tags: [], celebrities: [], collections: [], videos: [] });
        return NextResponse.json(empty);
    }

    try {
        const cachePrefix = hydrate ? 'search:h' : 'search';
        if (phase === '2') {
            const result = await cached(
                `${cachePrefix}:p2:${q.toLowerCase()}`,
                async () => {
                    const raw = await executeGeminiSearch(q);
                    return hydrate ? hydrateResults(raw) : raw;
                },
                3600,
            );
            return NextResponse.json(result);
        }

        const result = await cached(
            `${cachePrefix}:p1:${q.toLowerCase()}`,
            async () => {
                const raw = await executeSmartSearch(q, lang);
                return hydrate ? hydrateResults(raw) : raw;
            },
            3600,
        );
        return NextResponse.json(result);
    } catch (error) {
        logger.error('Search failed', {
            route: '/api/search',
            phase,
            query: q,
            error: error instanceof Error ? error.message : String(error),
        });
        if (hydrate) return NextResponse.json({ tags: [], celebrities: [], collections: [], videos: [] }, { status: 500 });
        return NextResponse.json(empty, { status: 500 });
    }
}

// ── Phase 1: synonym table expansion ──

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function executeSmartSearch(q: string, lang: string): Promise<SmartSearchResult> {
    // 1. Lookup synonyms
    const synResult = await pool.query(
        `SELECT maps_to_tag_slug, maps_to_tokens
         FROM search_synonyms
         WHERE term = $1 OR $1 ILIKE '%' || term || '%'`,
        [q.toLowerCase()],
    );

    const tagSlugs: string[] = [];
    const extraTokens: string[] = [];

    for (const row of synResult.rows) {
        if (row.maps_to_tag_slug) {
            tagSlugs.push(row.maps_to_tag_slug);
        }
        if (row.maps_to_tokens && Array.isArray(row.maps_to_tokens)) {
            extraTokens.push(...row.maps_to_tokens);
        }
    }

    // 2. Also check if query itself matches a tag slug directly
    const qSlug = q.toLowerCase().replace(/\s+/g, '-');
    if (!tagSlugs.includes(qSlug)) {
        const tagCheck = await pool.query(
            `SELECT slug FROM tags WHERE slug = $1 LIMIT 1`,
            [qSlug],
        );
        if (tagCheck.rows.length > 0) {
            tagSlugs.push(qSlug);
        }
    }

    // 3. Build token arrays
    const tokensEN = Array.from(new Set([q, ...extraTokens]));
    const tokensOriginal = [q];

    // 4. Call smart_search
    return callSmartSearchAndGroup(q, tokensEN, tokensOriginal, [q], tagSlugs);
}

// ── Phase 2: Gemini semantic expansion ──

async function executeGeminiSearch(q: string): Promise<SmartSearchResult> {
    const empty: SmartSearchResult = { tags: [], celebrities: [], collections: [], videos: [] };

    const expanded = await expandQueryWithGemini(q);
    if (!expanded) return empty;

    const tokensEN = Array.from(new Set([
        q,
        ...expanded.searchTokensEN,
        ...expanded.movieTitles.map(t => t.toLowerCase()),
    ]));
    const tokensOriginal = Array.from(new Set([
        q,
        ...expanded.searchTokensOriginal,
    ]));
    const celebrityNames = expanded.celebrityNames.length > 0
        ? expanded.celebrityNames
        : [q];
    const tagSlugs = expanded.exactTagSlugs;

    return callSmartSearchAndGroup(q, tokensEN, tokensOriginal, celebrityNames, tagSlugs);
}

// ── Shared: call smart_search, dedup, group ──

async function callSmartSearchAndGroup(
    original: string,
    tokensEN: string[],
    tokensOriginal: string[],
    celebrityNames: string[],
    tagSlugs: string[],
): Promise<SmartSearchResult> {
    const searchResult = await pool.query(
        `SELECT entity_type, entity_id, entity_slug, display_name, rank_score, match_type
         FROM smart_search($1, $2, $3, $4, $5, 30)`,
        [original, tokensEN, tokensOriginal, celebrityNames, tagSlugs],
    );

    // Deduplicate by entity_type+entity_id, keep max rank_score
    const seen = new Map<string, SearchRow>();
    for (const row of searchResult.rows as SearchRow[]) {
        const key = `${row.entity_type}:${row.entity_id}`;
        const existing = seen.get(key);
        if (!existing || row.rank_score > existing.rank_score) {
            seen.set(key, row);
        }
    }

    const deduped = Array.from(seen.values()).sort((a, b) => b.rank_score - a.rank_score);

    const result: SmartSearchResult = { tags: [], celebrities: [], collections: [], videos: [] };
    for (const row of deduped) {
        switch (row.entity_type) {
            case 'tag':        result.tags.push(row); break;
            case 'celebrity':  result.celebrities.push(row); break;
            case 'collection': result.collections.push(row); break;
            case 'video':      result.videos.push(row); break;
        }
    }

    return result;
}

// ── Hydrate: fetch full entity objects by IDs ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hydrateResults(raw: SmartSearchResult): Promise<Record<string, any[]>> {
    const videoIds = raw.videos.map(r => r.entity_id);
    const celebSlugs = raw.celebrities.map(r => r.entity_slug);
    const collSlugs = raw.collections.map(r => r.entity_slug);
    const tagSlugs = raw.tags.map(r => r.entity_slug);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any[]> = { tags: [], celebrities: [], collections: [], videos: [] };

    const promises: Promise<void>[] = [];

    if (videoIds.length > 0) {
        promises.push(
            pool.query(
                `SELECT v.*, array_agg(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) AS celebrity_names
                 FROM videos v
                 LEFT JOIN video_celebrities vc ON vc.video_id = v.id
                 LEFT JOIN celebrities c ON c.id = vc.celebrity_id
                 WHERE v.id = ANY($1) AND v.status = 'published'
                 GROUP BY v.id`,
                [videoIds],
            ).then(r => {
                // Preserve rank order from smart_search
                const map = new Map(r.rows.map(row => [row.id, row]));
                result.videos = videoIds.map(id => map.get(id)).filter(Boolean);
            }),
        );
    }

    if (celebSlugs.length > 0) {
        promises.push(
            pool.query(
                `SELECT * FROM celebrities WHERE slug = ANY($1) AND status = 'published'`,
                [celebSlugs],
            ).then(r => {
                const map = new Map(r.rows.map(row => [row.slug, row]));
                result.celebrities = celebSlugs.map(s => map.get(s)).filter(Boolean);
            }),
        );
    }

    if (collSlugs.length > 0) {
        promises.push(
            pool.query(
                `SELECT * FROM collections WHERE slug = ANY($1)`,
                [collSlugs],
            ).then(r => {
                const map = new Map(r.rows.map(row => [row.slug, row]));
                result.collections = collSlugs.map(s => map.get(s)).filter(Boolean);
            }),
        );
    }

    if (tagSlugs.length > 0) {
        promises.push(
            pool.query(
                `SELECT * FROM tags WHERE slug = ANY($1)`,
                [tagSlugs],
            ).then(r => {
                const map = new Map(r.rows.map(row => [row.slug, row]));
                result.tags = tagSlugs.map(s => map.get(s)).filter(Boolean);
            }),
        );
    }

    await Promise.all(promises);
    return result;
}
