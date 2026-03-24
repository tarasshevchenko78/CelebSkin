import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// 301 redirect to sitemap-index.xml (video-sitemap was split into chunks)
export async function GET() {
    return NextResponse.redirect('https://celeb.skin/sitemap-index.xml', 301);
}
