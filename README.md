# CelebSkin — Celebrity Scenes Platform

> Multilingual (10 languages) adult celebrity scenes platform powered by AI content processing and automated pipeline.

**Live:** [https://celeb.skin](https://celeb.skin)
**CDN:** [https://cdn.celeb.skin](https://cdn.celeb.skin) (BunnyCDN)

---

## Architecture

Two-server setup for performance and resource separation:

| Server | Role | Specs | Stack |
|--------|------|-------|-------|
| **AbeloHost** (NL) | Frontend + Database | 3.8GB RAM | Next.js 14, PostgreSQL 16, Redis 7, Nginx, PM2 |
| **Contabo** (DE) | Content Pipeline | 8GB RAM, 4 CPU | Node.js 20, FFmpeg, Playwright, n8n |

```
┌─────────────────────────────────────┐     SSH      ┌──────────────────────────────────┐
│         AbeloHost (celeb.skin)      │◄────────────►│       Contabo (Pipeline)         │
│                                     │              │                                  │
│  Next.js 14 (App Router)           │              │  scrape-boobsradar.js            │
│  PostgreSQL 16                     │    remote    │  process-with-ai.js (Gemini)     │
│  Redis 7 (cache)                   │◄────────DB───│  enrich-metadata.js (TMDB)       │
│  Nginx (reverse proxy)             │              │  watermark.js (FFmpeg)           │
│  PM2 (process manager)             │              │  generate-thumbnails.js          │
│  Admin Panel + API                 │              │  upload-to-cdn.js (BunnyCDN)     │
│                                     │              │  publish-to-site.js              │
└─────────────────────────────────────┘              └──────────────────────────────────┘
                                                              │
                                                              ▼
                                                     ┌──────────────────┐
                                                     │   BunnyCDN (DE)  │
                                                     │  cdn.celeb.skin  │
                                                     │  Videos, thumbs  │
                                                     └──────────────────┘
```

---

## Tech Stack

### Frontend (AbeloHost)
- **Next.js 14** — App Router, Server Components, dynamic rendering
- **TypeScript** — strict typing throughout
- **Tailwind CSS 3.4** — utility-first styling
- **PostgreSQL 16** — JSONB multilingual fields, pg_trgm fuzzy search
- **Redis 7** — query caching (TTL-based)
- **PM2** — process management + auto-restart

### Pipeline (Contabo)
- **Gemini AI** (2.5 Flash / 2.5 Pro / 2.0 Flash / 2.0 Pro) — content processing, 10-language translation
- **TMDB API** — celebrity verification, photos, bios, movie posters, filmography
- **FFmpeg** — watermarking, thumbnail generation, sprite sheets, preview GIFs
- **Playwright** — headless browser scraping
- **BunnyCDN** — video/image storage and global delivery

### Supported Languages
`en` `ru` `de` `fr` `es` `pt` `it` `pl` `nl` `tr`

All content fields use JSONB with localized values:
```json
{
  "en": "Celebrity Name in English",
  "ru": "Имя знаменитости",
  "de": "Promi-Name auf Deutsch"
}
```

---

## Project Structure

```
/opt/celebskin/site/                    # AbeloHost — Frontend repo
├── src/
│   ├── app/
│   │   ├── [locale]/                   # i18n routes (10 languages)
│   │   │   ├── page.tsx                # Homepage
│   │   │   ├── video/[slug]/           # Video detail
│   │   │   ├── celebrity/[slug]/       # Celebrity profile
│   │   │   ├── movie/[slug]/           # Movie scenes
│   │   │   ├── tag/[slug]/             # Tag listing
│   │   │   ├── collection/[slug]/      # Collections
│   │   │   ├── search/                 # Search results
│   │   │   ├── blog/[slug]/            # Blog articles
│   │   │   ├── ai-chat/               # AI chat companion
│   │   │   ├── ai-stories/            # AI-generated stories
│   │   │   ├── dmca/                   # DMCA takedown
│   │   │   ├── privacy/               # Privacy policy
│   │   │   └── terms/                  # Terms of service
│   │   ├── admin/                      # Admin dashboard
│   │   │   ├── page.tsx                # Dashboard overview
│   │   │   ├── videos/                 # Video management
│   │   │   ├── celebrities/            # Celebrity management
│   │   │   ├── moderation/             # Content moderation queue
│   │   │   ├── scraper/                # Pipeline dashboard (controls)
│   │   │   ├── ai/                     # AI pipeline stats
│   │   │   └── settings/               # System settings
│   │   └── api/
│   │       ├── admin/
│   │       │   ├── pipeline/           # Pipeline control (start/stop/status)
│   │       │   │   ├── route.ts        # GET stats, POST run actions
│   │       │   │   └── logs/route.ts   # GET live logs from Contabo
│   │       │   ├── videos/route.ts     # CRUD videos
│   │       │   ├── celebrities/route.ts
│   │       │   ├── moderation/route.ts
│   │       │   └── settings/route.ts
│   │       ├── ai-chat/route.ts        # AI chat API
│   │       └── search/route.ts         # Full-text search
│   ├── components/
│   │   ├── Header.tsx                  # Site header with locale switcher
│   │   ├── Footer.tsx                  # Site footer
│   │   ├── VideoCard.tsx               # Video card component
│   │   ├── VideoPlayer.tsx             # Video player
│   │   ├── CelebrityCard.tsx           # Celebrity card
│   │   ├── AgeGate.tsx                 # 18+ verification
│   │   ├── CookieConsent.tsx           # GDPR consent banner
│   │   ├── JsonLd.tsx                  # Schema.org structured data
│   │   └── admin/
│   │       └── PipelineControls.tsx    # Full pipeline control UI
│   ├── lib/
│   │   ├── db.ts                       # PostgreSQL query layer
│   │   ├── cache.ts                    # Redis caching wrapper
│   │   ├── i18n.ts                     # Internationalization helpers
│   │   └── types.ts                    # TypeScript interfaces
│   └── middleware.ts                   # Locale detection + admin auth
├── db/
│   ├── schema.sql                      # Full DB schema (20 tables)
│   └── seed.sql                        # Initial data (sources, categories, tags)
├── scripts/
│   └── run-remote.sh                   # SSH wrapper for pipeline execution
├── public/                             # Static assets
├── next.config.mjs                     # Next.js config
├── tailwind.config.ts                  # Tailwind config
└── package.json

/opt/celebskin/scripts/                 # Contabo — Pipeline scripts
├── scrape-boobsradar.js               # Playwright scraper
├── process-with-ai.js                 # Gemini AI processing (10 languages)
├── enrich-metadata.js                 # TMDB enrichment (photos, bios, posters)
├── watermark.js                        # FFmpeg video watermarking
├── generate-thumbnails.js             # FFmpeg screenshots + sprite + GIF
├── upload-to-cdn.js                   # BunnyCDN upload
├── publish-to-site.js                 # 10-language slug generation + publish
├── run-pipeline.js                    # Full pipeline orchestrator
├── lib/
│   ├── db.js                          # PostgreSQL connector (remote AbeloHost)
│   ├── logger.js                      # Structured logging
│   └── catalog-matcher.js             # Fuzzy matching (pg_trgm)
├── adapters/
│   ├── base-adapter.js                # Base scraper adapter
│   └── boobsradar-adapter.js          # BoobsRadar adapter
└── package.json
```

---

## Database Schema

20 tables with JSONB multilingual support:

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `sources` | Scraping sources | name, base_url, adapter_name |
| `raw_videos` | Raw scraped data | source_url, raw_title, raw_celebrities[], status |
| `videos` | Processed videos | title(JSONB), slug(JSONB), ai_confidence, status |
| `celebrities` | Celebrity profiles | name, name_localized(JSONB), tmdb_id, photo_url |
| `movies` | Movie/TV show | title, title_localized(JSONB), tmdb_id, poster_url |
| `tags` | Content tags | name_localized(JSONB), slug, videos_count |
| `categories` | Content categories | name_localized(JSONB), parent_id (tree) |
| `collections` | Curated collections | title(JSONB), is_auto |
| `celebrity_photos` | Multiple photos/celeb | photo_url, is_primary, source |
| `video_celebrities` | M:M video↔celebrity | — |
| `video_tags` | M:M video↔tag | — |
| `video_categories` | M:M video↔category | — |
| `movie_scenes` | M:M movie↔video | scene_number, scene_title(JSONB) |
| `movie_celebrities` | M:M movie↔celebrity | role |
| `collection_videos` | M:M collection↔video | sort_order |
| `ai_chat_sessions` | AI chat history | user_id, celebrity_id, persona_type |
| `ai_stories` | AI-generated stories | title(JSONB), content(JSONB), audio_url |
| `blog_posts` | Auto-generated blog | title(JSONB), content(JSONB), seo fields |
| `users` | User accounts | email, telegram_id, plan(free/premium/vip) |
| `processing_log` | Pipeline activity log | step, status, metadata(JSONB) |

**Extensions:** `uuid-ossp`, `pg_trgm`
**Triggers:** Auto-update `updated_at`, auto-count `celebrities.videos_count`
**Functions:** `search_celebrity_fuzzy()`, `search_movie_fuzzy()` — trigram similarity search

---

## Content Pipeline

7-step automated pipeline running on Contabo:

```
1. SCRAPE          →  Playwright browser scraping (BoobsRadar)
2. AI PROCESS      →  Gemini AI: celebrity/movie recognition + 10-language content
3. TMDB ENRICH     →  TMDB API: photos, bios, posters, filmography
4. WATERMARK       →  FFmpeg: "celeb.skin" overlay (30% opacity)
5. THUMBNAILS      →  FFmpeg: 8 screenshots + sprite sheet + 4s preview GIF
6. CDN UPLOAD      →  BunnyCDN Storage: videos, images, sprites
7. PUBLISH         →  Generate 10-language slugs, update counts, set published
```

### Pipeline Commands (on Contabo)

```bash
# Individual steps
node scrape-boobsradar.js --limit=20
node process-with-ai.js --limit=10 --model=gemini-2.5-pro
node enrich-metadata.js --limit=50
node watermark.js --limit=5
node generate-thumbnails.js --limit=5
node upload-to-cdn.js --limit=10 --cleanup
node publish-to-site.js --limit=20 --auto

# Full pipeline
node run-pipeline.js                          # all steps
node run-pipeline.js --test                   # limit=3 for testing
node run-pipeline.js --only=ai,tmdb           # specific steps only
node run-pipeline.js --skip=watermark,cdn     # skip steps
node run-pipeline.js --model=gemini-2.5-pro   # override AI model
```

### AI Models Available

| Model | Speed | Quality | Cost |
|-------|-------|---------|------|
| `gemini-2.5-flash` | Fast | Good | ~$0.005/video |
| `gemini-2.5-pro` | Moderate | Excellent | ~$0.02/video |
| `gemini-2.0-flash` | Fast | Good | ~$0.003/video |
| `gemini-2.0-pro` | Moderate | Excellent | ~$0.015/video |

### Admin Pipeline Control

The admin panel at `/admin/scraper` provides a full UI to:
- Start any pipeline step with custom options (limit, model, force, test)
- View real-time logs streamed from Contabo via SSH
- Monitor running processes
- View pipeline statistics (raw videos, processed, enriched, published)
- Track recent pipeline activity from processing_log

---

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 16
- Redis 7
- Nginx
- PM2
- FFmpeg (for thumbnails — Contabo)
- Playwright + Chromium (for scraping — Contabo)

### AbeloHost (Frontend)

```bash
# Clone
git clone git@github.com:tarasshevchenko78/celebskin.git /opt/celebskin/site
cd /opt/celebskin/site

# Install
npm install

# Database setup
sudo -u postgres psql -f db/schema.sql
sudo -u postgres psql -d celebskin -f db/seed.sql

# Build
npm run build

# Start with PM2
pm2 start npm --name celebskin -- start
pm2 save
```

### Contabo (Pipeline)

```bash
# Setup scripts
cd /opt/celebskin/scripts
npm install

# Configure environment
# Edit .env with: DB_HOST, GEMINI_API_KEY, TMDB_API_KEY, BUNNY_STORAGE_KEY

# Test pipeline
node run-pipeline.js --test
```

### Environment Variables (Contabo `.env`)

```env
DB_HOST=<abelohost-ip>
DB_PORT=5432
DB_NAME=celebskin
DB_USER=celebskin
DB_PASSWORD=<password>

GEMINI_API_KEY=<key>
GEMINI_MODEL=gemini-2.5-flash

TMDB_API_KEY=<key>
TMDB_ACCESS_TOKEN=<token>

BUNNY_STORAGE_ZONE=celebskin-media
BUNNY_STORAGE_KEY=<key>
BUNNY_CDN_URL=https://cdn.celeb.skin
BUNNY_ACCOUNT_KEY=<key>

SITE_URL=https://celeb.skin
```

---

## Admin Panel

**URL:** `https://celeb.skin/admin`
**Auth:** Basic Authentication (configured in `middleware.ts`)

| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/admin` | Overview stats, recent activity |
| Videos | `/admin/videos` | Video management, bulk approve/reject |
| Celebrities | `/admin/celebrities` | Celebrity CRUD, TMDB linking |
| Moderation | `/admin/moderation` | Content review queue |
| Pipeline | `/admin/scraper` | Full pipeline control with live logs |
| AI Pipeline | `/admin/ai` | AI processing stats, TMDB enrichment progress |
| Settings | `/admin/settings` | System configuration |

---

## API Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/pipeline` | Pipeline stats + running processes |
| `POST` | `/api/admin/pipeline` | Start pipeline action |
| `GET` | `/api/admin/pipeline/logs?lines=100` | Live logs from Contabo |
| `GET/POST` | `/api/admin/videos` | Video CRUD |
| `GET/POST` | `/api/admin/celebrities` | Celebrity CRUD |
| `GET/POST` | `/api/admin/moderation` | Moderation actions |
| `GET/POST` | `/api/admin/settings` | Settings management |
| `POST` | `/api/ai-chat` | AI chat messages |
| `GET` | `/api/search?q=...&locale=en` | Full-text search |

---

## BunnyCDN

- **Storage Zone:** `celebskin-media` (Frankfurt, DE)
- **Pull Zone:** `celebskin-cdn`
- **CDN URL:** `https://celebskin-cdn.b-cdn.net` (custom: `https://cdn.celeb.skin`)

### File Structure on CDN
```
/videos/{video-id}/video.mp4              # Original video
/videos/{video-id}/video_watermarked.mp4  # Watermarked copy
/videos/{video-id}/thumb_01.jpg           # Screenshots (01-08)
/videos/{video-id}/sprite.jpg             # Sprite sheet
/videos/{video-id}/preview.gif            # 4s preview GIF
/celebrities/{celebrity-id}/photo_1.jpg   # Celebrity photos
/movies/{movie-id}/poster.jpg             # Movie posters
```

---

## Deployment

```bash
cd /opt/celebskin/site
git pull
npm run build
pm2 restart celebskin
```

---

## Roadmap

### Completed
- [x] Phase 0: Project setup, DB schema, seed data, build pipeline
- [x] Phase 1 (partial): Scraping, AI processing, TMDB enrichment — tested with real data
- [x] Phase 3 (partial): Admin dashboard with full pipeline controls

### In Progress
- [ ] Pipeline: watermark, thumbnails, CDN upload, publish (code ready)
- [ ] CDN DNS: `cdn.celeb.skin` CNAME → `celebskin-cdn.b-cdn.net`

### Planned
- [ ] Phase 2: SEO (dynamic sitemap, Schema.org, hreflang)
- [ ] Phase 4: Telegram channel automation, auto-blog
- [ ] Phase 5: AI chat companions, AI stories
- [ ] Phase 6: Monetization (ExoClick ads, Stripe subscriptions)
- [ ] Phase 7: Advanced automation (visual recognition, IndexNow)

---

## License

Private project. All rights reserved.
