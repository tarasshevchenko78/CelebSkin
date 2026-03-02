# 🎬 CelebSkin

> Celebrity nude scenes from movies & TV shows — multilingual platform with AI-powered content pipeline.

**Live:** [celeb.skin](https://celeb.skin)

## Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Database:** PostgreSQL 16 (JSONB for 10 languages), pg_trgm fuzzy search
- **Cache:** Redis 7
- **CDN:** BunnyCDN
- **AI:** Gemini 2.5 Flash/Pro
- **Server:** AbeloHost VPS (NL) + Contabo (DE backend)
- **Process Manager:** PM2 + Nginx + SSL

## Features

- 10 languages (ru, en, de, fr, es, pt, it, pl, nl, tr) — JSONB strategy
- Custom HTML5 video player with keyboard controls
- Fuzzy search via pg_trgm
- AI Chat with character personas (planned)
- Telegram bot ecosystem (planned)
- Admin panel with scraper control

## Project Structure

```
site/       — Next.js application
scripts/    — Backend parsers and AI pipeline (Contabo)
config/     — Environment variables
db/         — Database schema
```

## Development

```bash
cd site && npm install && npm run dev
```

## Architecture

```
AbeloHost (NL): Next.js + PostgreSQL + Redis + Nginx
Contabo (DE):   Parsers + AI + FFmpeg + n8n + Telegram
BunnyCDN:       Videos + thumbnails + posters
```

## License

Private project. All rights reserved.
