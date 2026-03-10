// Centralized SEO helpers for CelebSkin
// Used by all public pages to generate consistent canonical + hreflang alternates

import { SUPPORTED_LOCALES } from '@/lib/i18n';
import { publicConfig } from '@/lib/config';

const SITE_URL = publicConfig.siteUrl; // https://celeb.skin

/**
 * Build canonical + hreflang alternates for a page.
 * Pattern:
 *   canonical: https://celeb.skin/{locale}{path}
 *   x-default: https://celeb.skin/en{path}
 *   {loc}:     https://celeb.skin/{loc}{path}
 *
 * @param locale  Current locale (e.g. 'ru')
 * @param path    Page path WITHOUT locale prefix (e.g. '/video/some-slug' or '' for home)
 */
export function buildAlternates(locale: string, path: string = '') {
    return {
        canonical: `${SITE_URL}/${locale}${path}`,
        languages: {
            'x-default': `${SITE_URL}/en${path}`,
            ...Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `${SITE_URL}/${loc}${path}`])
            ),
        },
    };
}
