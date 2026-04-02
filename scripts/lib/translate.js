/**
 * translate.js — Free translation via LibreTranslate (Contabo :5000)
 * Replaces Gemini for all translation tasks.
 * Gemini remains ONLY for content generation (descriptions, AI Vision).
 */

import axios from 'axios';

const LIBRE_URL = process.env.LIBRE_TRANSLATE_URL || 'http://161.97.142.117:5000';
const LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr'];

/**
 * Translate text from source to target language via LibreTranslate
 */
export async function translate(text, source, target) {
  if (!text || source === target) return text;
  try {
    const res = await axios.post(`${LIBRE_URL}/translate`, {
      q: text.substring(0, 5000), // limit to avoid timeouts
      source,
      target,
    }, { timeout: 15000 });
    return res.data?.translatedText || text;
  } catch (e) {
    console.warn(`  LibreTranslate ${source}→${target} failed: ${e.message?.substring(0, 60)}`);
    return ''; // empty = caller can skip this locale
  }
}

/**
 * Translate text from English to all 9 other locales
 * Returns: { en: originalText, ru: "...", de: "...", ... }
 */
export async function translateToAll(enText) {
  if (!enText) return {};
  const result = { en: enText };
  for (const locale of LOCALES) {
    if (locale === 'en') continue;
    result[locale] = await translate(enText, 'en', locale);
  }
  return result;
}

/**
 * Translate text from Russian to English + all other locales
 * Returns: { en: "...", ru: originalText, de: "...", ... }
 */
export async function translateFromRu(ruText) {
  if (!ruText) return {};
  const result = { ru: ruText };
  // First RU → EN
  result.en = await translate(ruText, 'ru', 'en');
  // Then EN → other locales (better quality than RU → X)
  for (const locale of LOCALES) {
    if (locale === 'en' || locale === 'ru') continue;
    result[locale] = await translate(result.en || ruText, 'en', locale);
  }
  return result;
}

export { LOCALES };
