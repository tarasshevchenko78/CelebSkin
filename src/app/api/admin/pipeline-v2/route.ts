/**
 * Pipeline v2 API Proxy
 *
 * Proxies requests to Contabo pipeline-api.js (port 3100)
 * so we don't expose Contabo IP/token to the browser.
 */

import { NextRequest, NextResponse } from 'next/server';

const CONTABO_API = 'http://161.97.142.117:3100/api/pipeline';
const API_TOKEN = process.env.PIPELINE_API_TOKEN || '';

export const dynamic = 'force-dynamic';

async function proxyGet(endpoint: string) {
  const resp = await fetch(`${CONTABO_API}/${endpoint}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    cache: 'no-store',
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Pipeline API ${resp.status}: ${text.substring(0, 200)}`);
  }
  return resp.json();
}

async function proxyPost(endpoint: string, body?: Record<string, unknown>) {
  const resp = await fetch(`${CONTABO_API}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp.json();
}

// GET: combined status + videos, or categories
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    // Categories endpoint
    if (action === 'categories') {
      const source = searchParams.get('source') || 'boobsradar';
      const data = await proxyGet(`categories?source=${encodeURIComponent(source)}`);
      return NextResponse.json(data);
    }

    // Default: status + videos
    const [status, videos] = await Promise.all([
      proxyGet('status'),
      proxyGet('videos'),
    ]);
    return NextResponse.json({ status, videos: videos.videos || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: message, status: null, videos: [] },
      { status: 502 }
    );
  }
}

// POST: start / stop / retry
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, limit, videoId } = body as {
      action: string;
      limit?: number;
      videoId?: string;
    };

    switch (action) {
      case 'start': {
        const { source, category } = body as { source?: string; category?: string };
        const data = await proxyPost('start', { limit: limit || 0, source: source || '', category: category || '' });
        return NextResponse.json(data);
      }
      case 'stop': {
        const data = await proxyPost('stop');
        return NextResponse.json(data);
      }
      case 'retry': {
        if (!videoId) {
          return NextResponse.json({ error: 'videoId required' }, { status: 400 });
        }
        const data = await proxyPost('retry', { videoId });
        return NextResponse.json(data);
      }
      case 'delete': {
        if (!videoId) {
          return NextResponse.json({ error: 'videoId required' }, { status: 400 });
        }
        const data = await proxyPost('delete', { videoId });
        return NextResponse.json(data);
      }
      case 'delete-bulk': {
        const { videoIds } = body as { videoIds?: string[] };
        if (!videoIds || !Array.isArray(videoIds) || videoIds.length === 0) {
          return NextResponse.json({ error: 'videoIds array required' }, { status: 400 });
        }
        const data = await proxyPost('delete-bulk', { videoIds });
        return NextResponse.json(data);
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
