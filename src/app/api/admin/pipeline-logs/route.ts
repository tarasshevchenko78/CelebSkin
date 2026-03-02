import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const sendEvent = (data: unknown) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            // Send initial batch of recent pipeline activity
            try {
                const result = await pool.query(`
                    SELECT id, original_title AS title, status, ai_model, ai_confidence, updated_at
                    FROM videos
                    WHERE ai_model IS NOT NULL
                    ORDER BY updated_at DESC
                    LIMIT 50
                `);

                sendEvent({ type: 'initial', logs: result.rows });
            } catch {
                sendEvent({ type: 'error', message: 'Failed to fetch logs' });
            }

            // Poll for new entries every 5 seconds
            const interval = setInterval(async () => {
                try {
                    const result = await pool.query(`
                        SELECT id, original_title AS title, status, ai_model, ai_confidence, updated_at
                        FROM videos
                        WHERE ai_model IS NOT NULL
                          AND updated_at > NOW() - INTERVAL '10 seconds'
                        ORDER BY updated_at DESC
                        LIMIT 10
                    `);

                    if (result.rows.length > 0) {
                        sendEvent({ type: 'update', logs: result.rows });
                    }
                } catch {
                    // Silently continue on polling errors
                }
            }, 5000);

            // Clean up on close
            request.signal.addEventListener('abort', () => {
                clearInterval(interval);
                controller.close();
            });
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
