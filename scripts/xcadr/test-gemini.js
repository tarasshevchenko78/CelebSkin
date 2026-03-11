#!/usr/bin/env node
/**
 * test-gemini.js — Quick Gemini API key + model verification
 *
 * Usage:
 *   node xcadr/test-gemini.js
 */

import { config } from '../lib/config.js';
import axios from 'axios';

const MODEL   = 'gemini-2.5-flash';
const API_KEY = config.ai.geminiApiKey;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

async function test() {
  console.log('Testing Gemini API...');
  console.log('Model:   ', MODEL);
  console.log('API Key: ', API_KEY ? API_KEY.slice(0, 8) + '...' : 'NOT SET');

  if (!API_KEY) {
    console.error('\nERROR: GEMINI_API_KEY not set in .env');
    process.exit(1);
  }

  try {
    const response = await axios.post(
      API_URL,
      {
        contents: [{ parts: [{ text: 'Reply with just the word "OK"' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 10 },
      },
      { timeout: 15000 }
    );

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('\nResponse:', text);
    console.log('SUCCESS — Gemini API is working!');
  } catch (error) {
    const status  = error.response?.status;
    const message = error.response?.data?.error?.message || error.message;
    console.error(`\nFAILED: ${status} — ${message}`);

    if (status === 404) {
      console.error(`\nModel "${MODEL}" not found. Listing available Gemini models...`);
      try {
        const listRes = await axios.get(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`
        );
        const models = listRes.data.models
          ?.filter((m) => m.name.includes('gemini'))
          ?.map((m) => m.name.split('/')[1])
          ?.slice(0, 20);
        console.log('Available models:', models?.join(', '));
      } catch (e2) {
        console.error('Could not list models:', e2.message);
      }
    }

    process.exit(1);
  }
}

test();
