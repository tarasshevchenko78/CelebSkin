#!/usr/bin/env node
/**
 * test-vertex.js — Verify Vertex AI works with GenAI App Builder credits
 *
 * Tests: text generation, video File API readiness
 * Run: node scripts/test-vertex.js
 */

process.env.GOOGLE_APPLICATION_CREDENTIALS = '/opt/keys/vertex-key.json';

const PROJECT_ID = 'gen-lang-client-0501441857';
const LOCATION = 'us-central1';

async function main() {
  console.log('=== Vertex AI Test ===\n');

  // Test 1: Basic text generation
  console.log('Test 1: Text generation...');
  try {
    const { VertexAI } = await import('@google-cloud/vertexai');
    const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });

    // Test with gemini-2.0-flash (stable model)
    const model = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent('Say "Vertex AI works!" in Russian. Reply with just the phrase.');
    const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('  Response:', text?.trim());
    console.log('  ✅ Text generation OK\n');
  } catch (err) {
    console.error('  ❌ Text generation FAILED:', err.message);
    console.error('  Details:', err.stack?.split('\n').slice(0, 3).join('\n'));
    return;
  }

  // Test 2: Check available models
  console.log('Test 2: Model availability...');
  try {
    const { VertexAI } = await import('@google-cloud/vertexai');
    const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });

    const modelsToTest = [
      'gemini-2.0-flash',
      'gemini-2.5-flash-preview-05-20',
      'gemini-2.5-pro-preview-05-06',
    ];

    for (const modelName of modelsToTest) {
      try {
        const model = vertexAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent('Reply with just: OK');
        const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        console.log(`  ${modelName}: ✅ ${text?.trim()}`);
      } catch (err) {
        console.log(`  ${modelName}: ❌ ${err.message?.substring(0, 80)}`);
      }
    }
    console.log('');
  } catch (err) {
    console.error('  ❌ Model test FAILED:', err.message);
  }

  // Test 3: Check if gemini-2.0-flash can handle inline video (for AI Vision)
  console.log('Test 3: Video/image capability check...');
  try {
    const { VertexAI } = await import('@google-cloud/vertexai');
    const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
    const model = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Create a tiny 1x1 JPEG to test multimodal
    const tinyJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA//9k=', 'base64');

    const result = await model.generateContent([
      'What do you see in this image? Reply briefly.',
      { inlineData: { mimeType: 'image/jpeg', data: tinyJpeg.toString('base64') } }
    ]);
    const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('  Multimodal response:', text?.trim().substring(0, 80));
    console.log('  ✅ Multimodal OK\n');
  } catch (err) {
    console.error('  ❌ Multimodal FAILED:', err.message?.substring(0, 100));
    console.log('');
  }

  // Test 4: Check File API equivalent for Vertex (for large video uploads)
  console.log('Test 4: File API (for video uploads)...');
  console.log('  Note: Vertex AI uses GCS or inline data, not File API');
  console.log('  For videos >20MB: need to upload to GCS first, then use gs:// URI');
  console.log('  For videos <20MB: can use inlineData with base64');
  console.log('  CelebSkin videos average 5-15MB → inlineData should work');
  console.log('  ⚠️ Need to verify with real video in production\n');

  console.log('=== All tests complete ===');
  console.log('Project:', PROJECT_ID);
  console.log('Location:', LOCATION);
  console.log('Credentials:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
