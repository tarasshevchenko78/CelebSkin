// CelebSkin i18n Utilities

export const SUPPORTED_LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'en';

export type LocalizedField = Record<string, string>;

/**
 * Get a localized value from a JSONB field, with fallback to default locale.
 */
export function getLocalizedField(
    jsonb: LocalizedField | null | undefined,
    locale: string,
    fallback: string = DEFAULT_LOCALE
): string {
    if (!jsonb || typeof jsonb !== 'object') return '';
    return jsonb[locale] || jsonb[fallback] || jsonb[DEFAULT_LOCALE] || Object.values(jsonb)[0] || '';
}

/**
 * Get the localized slug from a JSONB slug field.
 */
export function getLocalizedSlug(
    slugJsonb: LocalizedField | null | undefined,
    locale: string
): string {
    if (!slugJsonb || typeof slugJsonb !== 'object') return '';
    return slugJsonb[locale] || slugJsonb[DEFAULT_LOCALE] || Object.values(slugJsonb)[0] || '';
}

/**
 * Detect locale from Accept-Language header.
 */
export function detectLocale(acceptLanguageHeader: string | null): SupportedLocale {
    if (!acceptLanguageHeader) return DEFAULT_LOCALE;

    // Parse Accept-Language: en-US,en;q=0.9,ru;q=0.8,de;q=0.7
    const languages = acceptLanguageHeader
        .split(',')
        .map((part) => {
            const [lang, quality] = part.trim().split(';q=');
            return {
                lang: lang.trim().toLowerCase().split('-')[0], // en-US -> en
                q: quality ? parseFloat(quality) : 1.0,
            };
        })
        .sort((a, b) => b.q - a.q);

    for (const { lang } of languages) {
        if (SUPPORTED_LOCALES.includes(lang as SupportedLocale)) {
            return lang as SupportedLocale;
        }
    }

    return DEFAULT_LOCALE;
}

/**
 * Pluralized "scenes" label for a given count and locale.
 * Handles Slavic pluralization rules for ru/pl.
 */
export function sceneLabel(count: number, locale: string): string {
    const labels: Record<string, [string, string, string]> = {
        en: ['scene',   'scenes',  'scenes'],
        ru: ['сцена',   'сцены',   'сцен'],
        de: ['Szene',   'Szenen',  'Szenen'],
        fr: ['scène',   'scènes',  'scènes'],
        es: ['escena',  'escenas', 'escenas'],
        pt: ['cena',    'cenas',   'cenas'],
        it: ['scena',   'scene',   'scene'],
        pl: ['scena',   'sceny',   'scen'],
        nl: ['scène',   'scènes',  'scènes'],
        tr: ['sahne',   'sahne',   'sahne'],
    };
    const l = labels[locale] || labels.en;
    if (locale === 'ru' || locale === 'pl') {
        const n = Math.abs(count) % 100;
        const n1 = n % 10;
        if (n > 10 && n < 20) return l[2];
        if (n1 > 1 && n1 < 5) return l[1];
        if (n1 === 1) return l[0];
        return l[2];
    }
    return count === 1 ? l[0] : l[1];
}

/**
 * Check if a locale string is supported.
 */
export function isValidLocale(locale: string): locale is SupportedLocale {
    return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}

/**
 * Locale display names for UI use.
 */
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
    en: 'English',
    ru: 'Русский',
    de: 'Deutsch',
    fr: 'Français',
    es: 'Español',
    pt: 'Português',
    it: 'Italiano',
    pl: 'Polski',
    nl: 'Nederlands',
    tr: 'Türkçe',
};
