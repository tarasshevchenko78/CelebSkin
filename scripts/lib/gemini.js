/**
 * gemini.js — Shared Gemini API helpers for pipeline scripts
 *
 * Handles the gemini-2.5-flash "thinking" response format where
 * the model returns thought parts (thought: true) before the actual answer.
 */

import axios from 'axios';
import { config } from './config.js';

export const GEMINI_MODEL = 'gemini-2.5-flash';

export function getGeminiUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${config.ai.geminiApiKey}`;
}

/**
 * Extract the actual text response from a Gemini API response object.
 * Skips thinking parts (part.thought === true) and returns the first real text part.
 */
export function extractGeminiText(responseData) {
  const parts = responseData?.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) return null;

  // Find the first non-thinking text part
  const textPart = parts.find((p) => p.text && !p.thought);
  if (textPart) return textPart.text;

  // Fallback: return the last part's text (handles edge cases)
  return parts[parts.length - 1]?.text || null;
}

/**
 * Extract and parse JSON from a Gemini API response.
 * Handles thinking tokens and markdown code fences.
 */
export function extractGeminiJSON(responseData) {
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
    console.error('[Gemini] Failed to parse JSON:', clean.slice(0, 200));
    return null;
  }
}

/**
 * Make a Gemini API call and return parsed result.
 * @param {string} prompt - Text prompt
 * @param {object} options
 * @param {number} [options.temperature=0.2]
 * @param {boolean} [options.jsonMode=true] - Use responseMimeType: application/json
 * @param {number} [options.timeout=30000]
 */
export async function callGemini(prompt, { temperature = 0.2, jsonMode = true, timeout = 30000 } = {}) {
  const response = await axios.post(
    getGeminiUrl(),
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    },
    { timeout }
  );

  return jsonMode
    ? extractGeminiJSON(response.data)
    : extractGeminiText(response.data);
}
