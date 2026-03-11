#!/usr/bin/env node
/**
 * test-gemini-parse.js — Verify thinking-token extraction + real API call
 * Usage: node xcadr/test-gemini-parse.js
 */

import { extractGeminiJSON, callGemini } from '../lib/gemini.js';

// 1. Simulate a thinking-model response (parts[0] is thought, parts[1] is answer)
const mockThinkingResponse = {
  candidates: [{
    content: {
      parts: [
        { thought: true, text: 'Let me think about this...' },
        { text: '{"celebrity_en":"Sydney Sweeney","movie_en":"The Housemaid","title_en":"Sex scene with Sydney Sweeney"}' },
      ],
    },
  }],
};

const fromThinking = extractGeminiJSON(mockThinkingResponse);
console.log('Mock thinking response → extractGeminiJSON:');
console.log(JSON.stringify(fromThinking, null, 2));

const ok1 = fromThinking?.celebrity_en === 'Sydney Sweeney';
console.log(ok1 ? '✓ PASS: skipped thinking part correctly' : '✗ FAIL: got wrong part');

// 2. Simulate a non-thinking response (only parts[0] with actual text)
const mockDirectResponse = {
  candidates: [{
    content: {
      parts: [
        { text: '{"celebrity_en":"Emilia Clarke","movie_en":"Game of Thrones","title_en":"Dragon scene"}' },
      ],
    },
  }],
};

const fromDirect = extractGeminiJSON(mockDirectResponse);
const ok2 = fromDirect?.celebrity_en === 'Emilia Clarke';
console.log('\nMock direct response (no thinking):');
console.log(ok2 ? '✓ PASS: extracted direct response correctly' : '✗ FAIL');

// 3. Real API call
console.log('\nReal Gemini API call...');
try {
  const result = await callGemini(
    'Return JSON object with one key "status" set to "working".',
    { temperature: 0 }
  );
  console.log('Result:', JSON.stringify(result));
  const ok3 = result?.status === 'working';
  console.log(ok3 ? '✓ PASS: real API call returned correct JSON' : '✗ FAIL or partial: got ' + JSON.stringify(result));
} catch (err) {
  console.error('✗ FAIL: API call threw:', err.message);
}
