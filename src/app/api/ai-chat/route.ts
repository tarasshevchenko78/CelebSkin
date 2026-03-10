import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { message } = body;

        if (!message || typeof message !== 'string') {
            return NextResponse.json({ error: 'message is required' }, { status: 400 });
        }

        // Placeholder: AI chat is not yet implemented
        return NextResponse.json({
            reply: 'AI Chat is coming soon! This feature is currently under development.',
            status: 'placeholder',
        });
    } catch (error) {
        logger.error('AI chat error', { route: '/api/ai-chat', error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
