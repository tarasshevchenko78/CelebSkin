# CelebSkin

Celebrity video aggregator with AI-powered content analysis, multi-language support (10 locales), and automated video processing pipeline.

**Live:** [https://celeb.skin](https://celeb.skin)

## Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Database**: PostgreSQL 16 (JSONB for 10 languages)
- **Cache**: Redis
- **CDN**: BunnyCDN (video, screenshots, photos, posters)
- **AI**: Gemini 3-flash-preview (vision), Gemini 2.5 Flash (search expansion)
- **Video**: FFmpeg, yt-dlp
- **Metadata**: TMDB API
- **Process Manager**: PM2
- **Proxy**: Cloudflare WARP (SOCKS5)

## Architecture

| Server | Role |
|--------|------|
| AbeloHost | Web app, PostgreSQL, Redis |
| Contabo | Pipeline scripts, FFmpeg, Playwright |
| Home PC | Watermark worker (Python) |

## Getting Started

```bash
cd /opt/celebskin/site
./rebuild.sh          # Build & deploy web app
```

## Documentation

See **[CLAUDE.md](CLAUDE.md)** for full project documentation:
- Architecture details, server roles, env files
- XCADR Pipeline (main) and Pipeline v2 (BubsRadar)
- Home Watermark Worker
- Web app features (search, slug redirects, caching)
- Rules and conventions
- Useful commands

## Repository

GitHub: [tarasshevchenko78/CelebSkin](https://github.com/tarasshevchenko78/CelebSkin)
