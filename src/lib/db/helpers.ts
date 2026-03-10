import type { LocalizedField } from '../types';

// Helper: get localized value from JSONB field
export function getLocalized(
    field: LocalizedField | null | undefined,
    locale: string,
    fallback: string = 'en'
): string {
    if (!field || typeof field !== 'object') return '';
    return field[locale] || field[fallback] || field['en'] || Object.values(field)[0] || '';
}
