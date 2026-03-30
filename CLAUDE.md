# CelebSkin — CLAUDE.md

> Последнее обновление: 29.03.2026

## Оглавление
1. [Quick Start](#quick-start)
2. [Архитектура: Два сервера + Home Worker](#архитектура)
3. [Структура проекта](#структура-проекта)
4. [XCADR Pipeline (основной)](#xcadr-pipeline)
5. [Pipeline v2 (парсинг BubsRadar)](#pipeline-v2)
6. [Home Watermark Worker](#home-watermark-worker)
7. [Web App](#web-app)
8. [Правила (ДЕЛАТЬ / НЕ ДЕЛАТЬ)](#правила)
9. [Справочник](#справочник)

---

## Quick Start

**Ты на AbeloHost** (185.224.82.214) — здесь web app, БД, Redis.

- Пересборка сайта: `cd /opt/celebskin/site && ./rebuild.sh` (НИКОГДА не `rm -rf .next && npm run build` — есть Next.js 14.2.35 баг)
- Pipeline запускается ТОЛЬКО из UI (`/admin/xcadr-pipeline`), ТОЛЬКО на Contabo
- Исходники pipeline — на AbeloHost (`site/scripts/`), деплой на Contabo через `scp`
- Gemini API ключи — ТОЛЬКО из БД (`settings.gemini_api_key`), НЕ из .env
- Админка на русском языке
- GitHub: tarasshevchenko78/CelebSkin

---

## Архитектура

### Три машины

| Машина | IP | Роль | PM2 процесс |
|--------|----|------|-------------|
| **AbeloHost** | 185.224.82.214 | Next.js 14, PostgreSQL 16, Redis, Nginx | `celebskin` |
| **Contabo** | 161.97.142.117 | Pipeline scripts, FFmpeg, Playwright, WARP | `pipeline-api` |
| **Home PC** | 92.209.206.116 | Windows, `watermark_worker.py`, dashboard :8585 | — |

**Bunny CDN**: celebskin-cdn.b-cdn.net — видео, скриншоты, фото, постеры
**Домен**: celeb.skin (Namecheap)

### Файловая структура на двух серверах

**Оба сервера** имеют `/opt/celebskin/site/` — это один и тот же git repo (GitHub: tarasshevchenko78/CelebSkin), но **git pull делается независимо** и версии могут расходиться.

| Путь | AbeloHost | Contabo |
|------|-----------|---------|
| `/opt/celebskin/site/` | Git repo, Next.js app (PM2: `celebskin`) | Git repo (может отставать от AbeloHost) |
| `/opt/celebskin/site/scripts/` | Исходники pipeline (git-tracked) | Рабочие скрипты pipeline + ~20 доп. скриптов (только на Contabo) |
| `/opt/celebskin/scripts` | НЕТ (удалена) | **Симлинк** → `site/scripts` |
| `/opt/celebskin/site/.env.local` | DB, API keys | — |
| `/opt/celebskin/site/scripts/.env` | — | DB_HOST, GEMINI_API_KEY, TMDB_API_KEY, BUNNY_STORAGE_KEY |
| `/opt/celebskin/pipeline-work/` | — | Рабочие файлы (shared с Home Worker) |
| `/opt/celebskin/xcadr-work/` | — | Рабочие файлы XCADR |
| `/opt/celebskin/watermark_worker.py` | — | Python скрипт для Home Worker |

### Деплой изменений

**Web app (AbeloHost):** редактировать файлы → `./rebuild.sh` → PM2 рестартует

**Pipeline скрипты (Contabo):** на Contabo `/opt/celebskin/scripts` — это симлинк на `site/scripts`, поэтому файлы деплоятся через scp напрямую в `site/scripts/`:

```bash
# Деплой конкретного файла
scp /opt/celebskin/site/scripts/run-xcadr-pipeline.js root@161.97.142.117:/opt/celebskin/site/scripts/
scp /opt/celebskin/site/scripts/xcadr/parse-xcadr.js root@161.97.142.117:/opt/celebskin/site/scripts/xcadr/

# Перезапуск pipeline API после изменений
ssh root@161.97.142.117 "cd /opt/celebskin/scripts && pm2 restart pipeline-api"
```

> **ВАЖНО:** `git pull` на Contabo может затереть файлы которые были изменены через scp! Contabo часто отстаёт от AbeloHost по git. Pipeline скрипты синхронизируются через scp, НЕ через git pull.

---

## Структура проекта

```
site/
  src/
    app/
      [locale]/              — публичные страницы (10 локалей: ru,en,de,fr,es,pt,it,pl,nl,tr)
      admin/                 — админка (русский интерфейс)
      api/admin/             — API админки
      api/search/            — двухфазный поисковый API
    lib/
      db/                    — модули БД (pool, videos, celebrities, movies, search, settings)
      config.ts              — централизованный конфиг
      cache.ts               — Redis кэш с инвалидацией
      gemini.ts              — Gemini API хелперы
      search/query-expander.ts — Gemini 2.5 Flash расширение запросов (Phase 2)
    components/
      VideoCard.tsx          — карточка видео с hover preview
      SearchDropdown.tsx     — двухфазный dropdown в хедере
  scripts/
    run-xcadr-pipeline.js    — XCADR Pipeline оркестратор (основной)
    run-pipeline-v2.js       — Pipeline v2 оркестратор (парсинг BubsRadar)
    pipeline-api.js          — Express API для UI (порт 3100 на Contabo)
    ai-vision-analyze.js     — Gemini AI Vision анализ видео
    xcadr/                   — парсер, перевод, маппинг для xcadr.online
    lib/                     — общие модули pipeline (config, db, bunny, retry, gemini, tags)
  db/migrations/             — SQL миграции (001-012)
  rebuild.sh                 — безопасная пересборка (Next.js 14.2.35 workaround)
```

---

## XCADR Pipeline (основной)

> Полное ТЗ: `/opt/celebskin/XCADR_PIPELINE_TZ.md`

Единый pipeline для парсинга xcadr.online. Данные в production БД **только при publish**.

### Оркестратор: `run-xcadr-pipeline.js`

Streaming: парсер в фоне → feeder polls DB каждые 5 сек → 7 in-memory queues.

| # | Шаг | Workers | Описание |
|---|------|---------|----------|
| 1 | download | 2 | yt-dlp через WARP SOCKS5 → video.mp4 |
| 2 | ai_vision | 2 | Gemini 3-flash-preview → ai-results.json |
| 3 | watermark | 1 | FFmpeg delogo 4 углов + overlay celeb.skin. 1 слот Contabo, остальное → Home Worker |
| 4 | media | 2 | 8 screenshots, preview.mp4 (6s), preview.gif (4s) |
| 5 | cdn_upload | 3 | Все файлы → Bunny CDN |
| 6 | publish | 2 | CREATE video/celebrity/movie + TMDB enrich + перевод 10 языков + tags + collections |
| 7 | cleanup | 2 | rm workdir |

### Publish: поиск актрис
1. По EN имени → 2. По RU имени → 3. TMDB API → 4. Create new

### WARP auto-recovery
- `ensureWarpAlive()`: сначала `warp-cli status` → перезапуск ТОЛЬКО если Disconnected, cooldown 60с
- Парсер НЕ перезапускает warp-svc — только ждёт 10с и retry
- RETRY_DELAYS: `[10s, 30s, 60s, 120s]`

### Устойчивость к крэшам
- File-based stdio (не через pipe) → выживает при `pm2 restart pipeline-api`
- Умный SIGTERM: первый от pm2 restart **игнорируется**, кнопка "Стоп" в UI → PID file → реальный stop
- EPIPE обработка

### Дедупликация
- `source_url` — уникальный индекс в `videos`
- Тройная проверка в publish: source_url → xcadr video ID → xcadr_imports published

### Cleanup при старте
- `cleanupOnStart()` удаляет xcadr-work dirs (НЕ удаляет watermarked/media_cdn_done/watermarking_home)
- Два рабочих каталога: `xcadr-work/{xcadrId}/` (основной) + `pipeline-work/{videoId}/` (shared с Home Worker)

---

## Pipeline v2 (парсинг BubsRadar)

### Оркестратор: `run-pipeline-v2.js`

Используется для парсинга с boobsradar.com. PipelineQueue + WorkerPool, 8 in-memory очередей.

| # | Шаг | Workers | Описание |
|---|------|---------|----------|
| 1 | download | 3 | Playwright network intercept → axios stream |
| 2 | tmdb_enrich | 4 | TMDB API, nationality, countries, draft статус |
| 3 | ai_vision | 3 | Gemini AI Vision + generate-multilang.js (10 локалей) |
| 4 | watermark | 2 | FFmpeg veryfast CRF22, atomic SQL claim (shared с Home Worker) |
| 5 | media | 3 | Screenshots + preview.mp4 + preview.gif |
| 6 | cdn_upload | 4 | uploadFile() → Bunny Storage |
| 7 | publish | 3 | CDN HEAD >500KB, verify 10 locales, link collections |
| 8 | cleanup | 3 | rm workdir |

### Ключевые особенности
- **Donor URL extraction**: boobsradar → fuckcelebs.net → ahcdn.com (real mp4). Playwright + networkidle
- **GIF stub detection**: HEAD check CDN >500KB (некоторые видео отдают 48-byte GIF)
- **Draft статус**: celebrities/movies создаются как draft, публикуются вместе с видео
- **Чистый старт**: `cleanupOnStart()` удаляет все незавершённые, сбрасывает processing → pending

### CLI
```bash
node run-pipeline-v2.js                    # полный pipeline
node run-pipeline-v2.js --limit=10         # макс 10 видео
node run-pipeline-v2.js --step=ai_vision   # только один шаг (debug)
```

---

## Home Watermark Worker

`watermark_worker.py` — Python скрипт на Windows PC (Home), web dashboard на `:8585`.

### Full flow (не только watermark!)
1. Claims видео из DB: `status='watermarking_home'`
2. SCP download с Contabo → FFmpeg (delogo 4 углов + overlay celeb.skin)
3. Screenshots + preview → BunnyCDN upload → SCP results back → DB update
4. `pipeline_step='media_cdn_done'` → pipeline маршрутизирует в publish (bypass media/cdn)

### Координация с Contabo
- Shared DB queue: Contabo (1 слот) + Home (4 FFmpeg workers) опрашивают `watermark_ready`
- `FOR UPDATE SKIP LOCKED` — atomic claim
- SkipError pattern: Contabo мгновенно пропускает если Home уже обработал
- Файл на Contabo: `/opt/celebskin/watermark_worker.py`

---

## Web App

### Поисковая система (двухфазная)

**Phase 1**: Синонимы (`search_synonyms`, 69 строк) + `smart_search()` PostgreSQL функция (5-уровневый скоринг: exact_tag → celebrity_fuzzy → fulltext_en → fulltext_all → trigram)

**Phase 2**: Gemini 2.5 Flash (`query-expander.ts`) — семантическое расширение запроса, 5-10 синонимов, лимит 100. Всегда запускается. AI результаты в отдельной фиолетовой секции "AI Search".

API: `GET /api/search?q=&phase=1|2&lang=&hydrate=true`

### Slug Redirects (33,926 записей)
- Таблица `slug_redirects` (old_slug PK → new_slug, entity_type, locale)
- 4018 видео × 9 локалей — старые не-EN slug → redirect на EN slug
- `getSlugRedirect()` в `lib/db/videos.ts`, кэш 24ч Redis
- `permanentRedirect()` (308) в video page

### Redis кэширование
- TTL 60-300с для страниц, 1ч для поиска, 24ч для slug redirects
- `cache.ts` — `cached(key, fn, ttl)` wrapper

### Пересборка
```bash
cd /opt/celebskin/site && ./rebuild.sh
```
`rebuild.sh` — останавливает PM2, чистит .next, создаёт workaround файлы (Next.js 14.2.35 баг), билдит, стартует PM2, проверяет.

---

## Правила

### НИКОГДА
- НЕ менять AI модели без запроса Тараса
- НЕ запускать pipeline на AbeloHost — только на Contabo
- НЕ записывать URL boobsradar в `video_url`
- НЕ публиковать видео без русских переводов (title.ru, review.ru, seo_title.ru)
- НЕ использовать `rm -rf .next && npm run build` — только `./rebuild.sh`
- НЕ удалять опубликованные видео без разрешения Тараса
- НЕ убивать процессы без разрешения

### ВСЕГДА
- Pipeline — ТОЛЬКО из UI (`/admin/xcadr-pipeline`)
- Имена актрис/фильмов — АНГЛИЙСКИЕ (локализация в JSONB)
- Gemini File API: upload и generateContent — ОДИН И ТОТ ЖЕ API ключ
- При смене Gemini ключей → `pm2 restart pipeline-api --update-env` на Contabo
- При изменении pipeline скриптов → scp на Contabo
- Cleanup: UPDATE status='failed', НЕ DELETE
- Batch все изменения кода → один `./rebuild.sh` в конце

---

## Справочник

### Gemini модели
| Модель | Назначение |
|--------|-----------|
| gemini-3-flash-preview | AI Vision анализ видео (primary), переводы |
| gemini-2.5-flash | Query expansion (Phase 2 поиск), legacy переводы |

### Ключевые таблицы БД
| Таблица | Назначение |
|---------|-----------|
| `videos` | Видео (source_url уникальный, JSONB title/slug/review × 10 языков) |
| `celebrities` | Актрисы (name EN, slug unique, name_localized JSONB, bio JSONB) |
| `movies` | Фильмы (title EN, countries varchar(2)[] ISO) |
| `xcadr_imports` | Staging для XCADR pipeline |
| `slug_redirects` | 33,926 редиректов старых slug → EN slug |
| `search_index` | Unified full-text поиск |
| `search_synonyms` | 69 синонимов для поиска (10 языков) |
| `settings` | API ключи, настройки (gemini_api_key через запятую) |
| `tags` | 32 канонических тега (is_canonical, name_localized) |

### Полезные команды
```bash
# Пересборка сайта (AbeloHost)
cd /opt/celebskin/site && ./rebuild.sh

# Деплой pipeline скрипта на Contabo (через scp, НЕ git pull!)
scp /opt/celebskin/site/scripts/<file> root@161.97.142.117:/opt/celebskin/site/scripts/<file>

# SSH на Contabo
ssh root@161.97.142.117

# Логи сайта (AbeloHost)
pm2 logs celebskin --lines 50

# Логи pipeline (Contabo)
ssh root@161.97.142.117 "pm2 logs pipeline-api --lines 50"

# БД (AbeloHost)
psql -U celebskin -d celebskin

# Статус WARP (Contabo)
ssh root@161.97.142.117 "warp-cli status"

# Проверить расхождение git между серверами
git log --oneline -1  # AbeloHost HEAD
ssh root@161.97.142.117 "git -C /opt/celebskin/site log --oneline -1"  # Contabo HEAD
```
