/**
 * XCADR Pipeline API Proxy
 * Proxies requests to Contabo pipeline-api.js xcadr endpoints
 */

import { NextRequest, NextResponse } from 'next/server';

const CONTABO_API = 'http://161.97.142.117:3100/api/xcadr-pipeline';
const API_TOKEN = process.env.PIPELINE_API_TOKEN || '';

export const dynamic = 'force-dynamic';

async function proxyGet(endpoint: string) {
  const resp = await fetch(`${CONTABO_API}/${endpoint}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    cache: 'no-store',
  });
  if (!resp.ok) throw new Error(`Pipeline API ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
  return resp.json();
}

async function proxyPost(endpoint: string, body?: Record<string, unknown>) {
  const resp = await fetch(`${CONTABO_API}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp.json();
}

export async function GET() {
  try {
    const [rawStatus, videos] = await Promise.all([proxyGet('status'), proxyGet('videos')]);
    const mappedVideos = (videos.videos || []).map((v: Record<string, unknown>) => ({
      ...v,
      step_progress: v.step_progress || null,
      ai_vision_status: v.ai_vision_status || null,
      ai_vision_error: v.ai_vision_error || null,
    }));
    // Map API response to what UI expects
    const status = {
      running: rawStatus.running,
      pid: rawStatus.pid,
      started_at: rawStatus.started_at || null,
      progress: {
        status: rawStatus.pipeline_status,
        steps: rawStatus.queues || {},
        completed: rawStatus.completed || 0,
        failed: rawStatus.failed_count || 0,
        elapsed: rawStatus.uptime_sec || rawStatus.elapsed || 0,
      },
      counts: rawStatus.totals || {},
    };
    return NextResponse.json({ status, videos: mappedVideos });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message, status: null, videos: [] }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body as { action: string };

    switch (action) {
      case 'start': {
        const { limit, url, celeb, collection, pages } = body;
        const data = await proxyPost('start', { limit: limit || 10, url, celeb, collection, pages });
        return NextResponse.json(data);
      }
      case 'stop': {
        const data = await proxyPost('stop');
        return NextResponse.json(data);
      }
      case 'delete': {
        const { id } = body;
        const data = await proxyPost('delete', { id });
        return NextResponse.json(data);
      }
      case 'delete-bulk': {
        const { ids } = body;
        const data = await proxyPost('delete-bulk', { ids });
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
