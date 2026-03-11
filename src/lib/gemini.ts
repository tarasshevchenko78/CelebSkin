/**
 * gemini.ts — Shared Gemini API helpers for Next.js API routes
 *
 * Handles the gemini-2.5-flash "thinking" response format where
 * the model returns thought parts (part.thought === true) before the actual answer.
 */

export const GEMINI_MODEL = 'gemini-2.5-flash';

export function getGeminiUrl(apiKey: string): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
}

/**
 * Extract the actual text response from a Gemini API response object.
 * Skips thinking parts (part.thought === true) and returns the first real text part.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractGeminiText(responseData: any): string | null {
    const parts = responseData?.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) return null;

    // Find the first non-thinking text part
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textPart = parts.find((p: any) => p.text && !p.thought);
    if (textPart) return textPart.text;

    // Fallback: return the last part's text
    return parts[parts.length - 1]?.text || null;
}

/**
 * Extract and parse JSON from a Gemini API response.
 * Handles thinking tokens and markdown code fences.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractGeminiJSON(responseData: any): any | null {
    const text = extractGeminiText(responseData);
    if (!text) return null;

    const clean = text
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/g, '');

    try {
        return JSON.parse(clean);
    } catch {
        return null;
    }
}
