# CelebSkin — CLAUDE.md

## Архитектура
- **AbeloHost** (185.224.82.214): Next.js 14 App Router + TypeScript, PostgreSQL 16, Redis, Nginx, PM2
- **Contabo** (161.97.142.117): Pipeline scripts, FFmpeg, Playwright, AI processing (Gemini 3-flash-preview)
- **Home PC** (92.209.206.116): Windows, parallel watermark worker (`watermark_worker.py`), web dashboard :8585
- **Bunny CDN** (celebskin-cdn.b-cdn.net): Видео, скриншоты, фото, постеры
- **Домен**: celeb.skin (Namecheap)
- **GitHub**: tarasshevchenko78/CelebSkin

## Стек
- Next.js 14 App Router, TypeScript
- PostgreSQL 16 с JSONB для 10 языков (ru, en, de, fr, es, pt, it, pl, nl, tr)
- Redis — кэширование (TTL 60-300с)
- BunnyCDN — медиа хранилище и доставка
- Gemini 3-flash-preview — AI Vision анализ видео (без цензуры на explicit контент)
- Gemini 2.5 Flash — AI переводы, описания (legacy)
- TMDB API — метаданные фильмов и актрис
- PM2 — процесс менеджер
- FFmpeg — обработка видео

## Структура проекта
```
src/
  app/
    [locale]/          — публичные страницы (10 локалей)
    admin/             — админка (русский интерфейс)
    api/admin/         — API админки
    api/search/        — двухфазный поисковый API (Phase 1 synonym+fulltext, Phase 2 Gemini)
  lib/
    db/                — модули БД (pool, videos, celebrities, movies, search, settings, etc.)
    config.ts          — централизованный конфиг
    cache.ts           — Redis кэш с инвалидацией
    logger.ts          — структурированные логи
    gemini.ts          — Gemini API хелперы
    seo.ts             — hreflang хелпер
    bunny.ts           — Bunny CDN upload helper
    search/
      query-expander.ts — Gemini 2.5 Flash расширение поисковых запросов (Phase 2)
  components/
    VideoCard.tsx      — универсальная карточка видео с hover preview
    SearchDropdown.tsx — двухфазный поисковый dropdown в хедере
    BottomNav.tsx      — мобильная навигация
    ChipFilter.tsx     — chip-фильтры
    admin/             — компоненты админки
scripts/
  lib/
    config.js          — конфиг pipeline
    db.js              — подключение к БД
    bunny.js           — Bunny CDN операции
    retry.js           — retry wrapper
    dead-letter.js     — очередь ошибок
    state-machine.js   — state machine видео
    gemini.js          — Gemini API хелперы
    tags.js            — Tag system v3: 32 тега, 4 измерения, COUNTRY_GROUPS, normalizeTags()
  run-pipeline-v2.js   — Pipeline v2.0 оркестратор (8 in-memory queues, auto-resume)
  ai-vision-analyze.js — AI Vision анализ видео (Gemini 3-flash-preview, File API)
  run-xcadr-pipeline.js — XCADR Pipeline оркестратор (7 in-memory queues, данные в БД только при publish)
  xcadr/
    parse-xcadr.js     — парсер xcadr.online
    translate-xcadr.js — перевод через TMDB + Gemini
    match-xcadr.js     — поиск совпадений в БД
    map-tags.js        — маппинг тегов и коллекций
    download-and-process.js — скачивание + обработка видео (legacy)
    auto-import.js     — автоматический оркестратор (legacy)
    test-gemini.js     — тест Gemini API
  watermark.js         — наложение водяного знака (ultrafast + threads 0)
  generate-thumbnails.js — скриншоты + sprites + GIF (с CDN fallback)
  generate-preview.js  — hover preview clip (6с)
  upload-to-cdn.js     — загрузка на BunnyCDN (graceful skip при missing workdir)
  publish-to-site.js   — публикация с автомодерацией
  run-pipeline.js      — конвейер с event-driven scheduler
  sync-categories.js   — синхронизация категорий из boobsradar в БД
  deploy-web.sh
  deploy-pipeline.sh
  backup-db.sh
db/
  migrations/          — SQL миграции (001-012, 012 = pipeline v2)
```

## Два сервера — строгое разделение
- AbeloHost: ТОЛЬКО web app, БД, Redis. Никакого FFmpeg, AI обработки
- Contabo: ТОЛЬКО pipeline скрипты. Триггерится через SSH с AbeloHost
- Pipeline scripts на Contabo коннектятся к БД на AbeloHost (DB_HOST=185.224.82.214)
- Никогда не запускать pipeline на AbeloHost
- API ключи (Gemini, TMDB) хранятся в `settings` таблице БД (приоритет) + fallback на .env
- `getSettingOrEnv(dbKey, envFallback)` — единый геттер для API ключей

## Pipeline конвейер (Contabo)

### Основной flow
Scrape → AI → TMDB Enrich → Watermark → Thumbnails → CDN Upload → Preview → Publish

### Конвейерный принцип
- **Event-driven scheduler**: child exit → wakeScheduler() → мгновенный re-spawn (0мс вместо 3с)
- **3 параллельных видео**: каждый шаг обрабатывает до 3 видео одновременно
- **Конкурентные шаги**: AI + Watermark + CDN работают одновременно для разных видео
- **Водяной знак**: preset `veryfast` CRF 22, shared DB queue с Home Worker
- **CDN upload**: graceful skip если workdir удалён но CDN watermark уже есть
- **Thumbnails**: fallback на CDN URL если локальный tmp/ файл удалён

### Автопубликация / Модерация
- Полное видео (постер + фото актрис + описание + CDN) → `published`
- Неполное (нет постера / фото / описания / актрис) → `needs_review` → ручная модерация
- `fullPipelineReset()` сохраняет видео в статусе `needs_review`

### TMDB Enrichment
- Валидация TMDB_API_KEY при старте (exit если пустой)
- Не-найденные актрисы: `tmdb_id = -1` (не перепроверяются при следующих запусках)
- Multi-strategy search: year ± 1, без диакритики, TV show fallback

### scripts/.env (НЕ в git, нужен на ОБОИХ серверах)
Обязательные ключи: `DB_HOST`, `DB_PASSWORD`, `BUNNY_STORAGE_KEY`, `BUNNY_CDN_URL`, `GEMINI_API_KEY`, `TMDB_API_KEY`

## XCADR Pipeline (Contabo) — АКТУАЛЬНЫЙ (март 2026)

> Полное ТЗ: `/opt/celebskin/XCADR_PIPELINE_TZ.md`

### Оркестратор: `run-xcadr-pipeline.js` (1324 строки)
Единый pipeline с in-memory queues. **Данные в БД (videos/celebrities/movies) только при publish.**

### Pre-pipeline
- `parse-xcadr.js`: парсит xcadr.online → `xcadr_imports` staging
- Дедупликация: `published`/`duplicate` → пропуск; `failed`/`error` → сброс в `parsed`

### 7 worker шагов
| # | Шаг | Workers | Описание |
|---|------|---------|----------|
| 1 | download | 2 | KVS patterns → yt-dlp → video.mp4 (fallback boobsradar) |
| 2 | ai_vision | 2 | Temp video → Gemini 3-flash-preview → ai-results.json → cleanup temp |
| 3 | watermark | 2 | FFmpeg delogo xcadr + overlay celeb.skin (preset fast, CRF 19) |
| 4 | media | 2 | 8 screenshots, preview.mp4 (6s), preview.gif (4s) |
| 5 | cdn_upload | 3 | Все файлы → Bunny CDN |
| 6 | publish | 2 | CREATE video/celebrity/movie + TMDB enrich + bio/desc 10 langs + link all |
| 7 | cleanup | 2 | rm workdir |

### Publish: 4-шаговый поиск актрис/фильмов
1. По английскому имени → 2. По русскому имени → 3. TMDB API → 4. Create new (EN name)

### Publish: обогащение
- **enrichCelebTMDB**: фото, дата рождения, национальность, bio → перевод на 10 языков (Gemini)
- **enrichMovieTMDB**: постер, жанры, студия, description → перевод на 10 языков (Gemini)
- **Связи**: video_celebrities, movie_scenes, movie_celebrities, video_tags, collection_videos

### Дедупликация
- `source_url` (xcadr URL) — уникальный индекс в `videos`
- При старте/завершении: DELETE из `xcadr_imports` всё кроме `published`/`duplicate`

### Кодирование видео
libx264, preset `fast`, CRF `19`, aac 128k, mp4 faststart

### UI + API
- Admin UI: `/admin/xcadr-pipeline` — прогресс-бары, вкладки Pipeline/Published/Failed/Import
- API proxy: `/api/admin/xcadr-pipeline/route.ts` → Contabo :3100
- AdminVideosTable: колонки «Источник» (xcadr/boobsradar) и «AI» (confidence bar / vision badge)
- Фильтрация по текущему запуску (`started_at`)

### ХАРДЛИНКИ (ВАЖНО!)
`run-xcadr-pipeline.js` и `pipeline-api.js` — хардлинки между `/opt/celebskin/scripts/` и `/opt/celebskin/site/scripts/`. Один файл = один inode. Менять в `/opt/celebskin/scripts/`.

### Legacy xcadr (deprecated)
Файлы: xcadr/auto-import.js, xcadr/download-and-process.js — не используются

## Pipeline v2.0 (Contabo) — НОВЫЙ

### Оркестратор: `run-pipeline-v2.js`
PipelineQueue + WorkerPool. Шаги download→ai_vision используют in-memory очереди. Watermark опрашивает БД (`watermark_ready`) через `FOR UPDATE SKIP LOCKED` — конкурирует с Home Worker.

### 8 шагов
| # | Шаг | Workers | Описание |
|---|------|---------|----------|
| 1 | download | 3 | Playwright network intercept → axios stream, 5min timeout, DOWNLOAD_QUEUE_MAX=5 |
| 2 | tmdb_enrich | 4 | TMDB API (Bearer JWT), nationality (ISO 2-letter), countries, draft статус |
| 3 | ai_vision | 3 | subprocess ai-vision-analyze.js + generate-multilang.js (10 locales) |
| 4 | watermark | 2 | FFmpeg veryfast CRF22, ATOMIC SQL claim (prevents double-processing with Home Worker) |
| 5 | media | 3 | Screenshots (1280px) at hot_moments timestamps, preview.mp4 (6s), preview.gif (4s) |
| 6 | cdn_upload | 4 | uploadFile() → Bunny Storage, все файлы → videos/{videoId}/ |
| 7 | publish | 3 | CDN HEAD check >500KB, verify translations 10 locales, block censored AI, link collection |
| 8 | cleanup | 3 | rm workdir (только если published + CDN URLs present), raw_videos → processed |

### CRITICAL: Watermark double-processing prevention
- Contabo watermark queue + Home worker polling can grab same video simultaneously
- processWatermark uses ATOMIC SQL claim: `UPDATE videos SET status='watermarking' WHERE id=$1 AND status NOT IN ('watermarking','watermarking_home','watermarked','published','failed','needs_review') AND pipeline_step NOT IN ('watermarked','media','cdn_upload','publish','cleanup')`
- If rowCount=0 → skip (another worker already claimed)

### CRITICAL: Donor video URL extraction
- boobsradar.com loads video URL via JavaScript (not in static HTML)
- Adapter uses Playwright with `networkidle` to intercept actual CDN URL
- Video URL chain: boobsradar → fuckcelebs.net/get_file → vcdn.fuckcelebs.net → ahcdn.com (real mp4)
- Some videos return 48-byte GIF stub instead of real video — processPublish HEAD-checks CDN file >500KB

### AI Vision
- **Модель**: gemini-3-flash-preview (primary) → gemini-3.1-pro-preview → gemini-2.5-pro (fallback)
- **Gemini 3.x не имеет цензуры** на explicit контент (проверено)
- File API для видео >18MB (resumable upload)
- Fallback на donor tags через mapDonorTags() если все модели отказали

### Tag System v3 (`lib/tags.js`)
- **32 тега** в 4 измерениях: nudity_level (8), scene_type (12), context (7), media_type (5)
- `normalizeTags()`: 1 nudity + [bush] + 0-1 scene + 0-2 context + 1 media
- `mapDonorTags(donorTags)`: маппинг тегов донора → наша система
- `tag_mapping` таблица в DB (72 маппинга, migration 012)

### Страны и национальность
- `celebrities.nationality` → ISO 2-letter код (из TMDB place_of_birth через `extractNationality()`)
- `movies.countries` → VARCHAR(2)[] массив ISO кодов (из TMDB production_countries)
- `COUNTRY_GROUPS` в tags.js: asian, scandinavian, latin, eastern-european, western-european
- `BIRTH_COUNTRY_MAP`: 54 маппинга для парсинга "Springfield, Illinois, USA" → "US"

### Draft статус
- Celebrities и movies создаются со `status = 'draft'` в шаге tmdb_enrich
- Публикуются в шаге publish только вместе с видео
- Если CDN URLs отсутствуют → video → `needs_review` (не publish)

### Чистый старт (cleanupOnStart) — БЕЗ auto-resume
- **Новый запуск = чистый старт.** Никаких процессов из предыдущих запусков
- `cleanupOnStart()` при каждом старте:
  1. Удаляет ВСЕ незавершённые видео из DB (не published/failed/needs_review)
  2. Удаляет ВСЕ рабочие папки `/opt/celebskin/pipeline-work/` (ВРЕМЕННЫЕ файлы, не DB/CDN/scripts)
  3. Сбрасывает raw_videos `processing` → `pending` если видео не опубликовано
- **pipeline-work = ВРЕМЕННЫЕ файлы**: original.mp4, watermarked.mp4, thumbs, previews — всё что опубликовано уже на CDN
- raw_videos lifecycle: `pending` → `processing` → `processed`. Не опубликовано = сброс в `pending`

### Retry и dead-letter
- 3 retry на каждый шаг (5s, 15s, 45s delays)
- При исчерпании retries → dead_letter через `recordFailure()`
- Graceful shutdown: SIGINT/SIGTERM → workers завершают текущую работу

### CLI
```bash
node run-pipeline-v2.js                    # полный pipeline (чистый старт)
node run-pipeline-v2.js --limit=10         # макс 10 новых видео
node run-pipeline-v2.js --step=ai_vision   # только один шаг (debug)
```

### Миграция 012 (pipeline v2)
Новые колонки videos: `ai_vision_status`, `ai_vision_model`, `best_thumbnail_sec`, `preview_start_sec`, `donor_tags`, `pipeline_step`, `pipeline_error`
Новые статусы: downloading, downloaded, tmdb_enriching, tmdb_enriched, ai_analyzing, ai_analyzed, watermarking, media_generating, media_generated, cdn_uploading, cdn_uploaded, publishing, failed, draft
Таблица `tag_mapping`: donor_tag → our_tag_slug (72 записи)
`movies.countries`: VARCHAR(2)[] массив ISO кодов

## Известные баги (март 2026)
1. ~~Import пишет boobsradar URL в video_url~~ — ИСПРАВЛЕНО
2. ~~Скачивается 480p~~ — quality определяется ffprobe
3. ~~Водяной знак xcadr.online не убирается~~ — ИСПРАВЛЕНО: delogo в watermark шаге XCADR pipeline
4. ~~Коллекции не привязываются~~ — ИСПРАВЛЕНО
5. ~~Draft статус для актрис/фильмов~~ — РЕАЛИЗОВАНО
6. AI описание — промт не обновлён на эротический стиль
7. Удаление видео из админки может не работать
8. Часть админки всё ещё на английском
9. ~~PIPELINE_ERROR_DECODE при перемотке~~ — ИСПРАВЛЕНО (SAR=1:1). 303 старых видео нужна перекодировка
10. ~~Дубликаты фильмов с русскими названиями~~ — ИСПРАВЛЕНО: 4-шаговый поиск EN→RU→TMDB→create

## Реализовано (март 2026)
- Settings table: управление API ключами (Gemini, TMDB) из админки `/admin/settings`
- AI re-enrich: динамические ключи из DB, логирование ошибок, детальные сообщения
- Скриншоты: lightbox с навигацией, захват кадра с видео (canvas + FFmpeg fallback), разрешение 1280px, восстановлен ScreenshotPicker в админке
- Водяной знак: UI для загрузки PNG, выбор паттерна движения, настройка прозрачности/масштаба
- Категории boobsradar: `sync-categories.js` с реальными счётчиками (pagination × 20) напрямую в таблицу `collections`, фильтр в pipeline UI
- XCadr: dropdown категорий, badges коллекций в таблице импорта
- Pipeline reset: `fullPipelineReset()` при старте — сохраняет needs_review видео
- Pipeline конвейер: event-driven scheduler, мгновенный re-spawn, parallel steps
- Publish автомодерация: полные → published, неполные → needs_review
- Интеграция "Подборок" (Collections) вместо старых категорий в Scraper Pipeline: UI скрапера теперь читает актуальные счётчики из `collections`.
- Документация деплоя: Web App НЕ на Vercel! Работает через PM2 на AbeloHost. Деплой: `cd /opt/celebskin/site && npm run build && pm2 restart celebskin`. Git push НЕ деплоит автоматически.
- **PM2 auto-startup**: systemd `pm2-root.service` enabled. PM2 автоматически стартует при рестарте сервера. `pm2 save` обязателен после любых изменений процессов.
- Фиксы багов: устранены дубликаты фильмов (проверка точного названия в `xcadr/route.ts`), восстановлен UI скриншотов в админке, исправлены локальные ссылки CDN на `celebskin-cdn.b-cdn.net`.
- **Watermark fix (13.03.2026)**: `-sar 1:1`, `-keyint_min 48 -sc_threshold 0`, `-af aresample=async=1:first_pts=0`, `-fflags +genpts+discardcorrupt`, `-max_muxing_queue_size 4096` — исправляет PIPELINE_ERROR_DECODE при seek в Chrome
- Новые скрипты: `scan-broken-videos.js` (сканирование SAR), `reprocess-broken-videos.js` (перекодировка старых видео)
- **Pipeline v2.0 (15.03.2026)**: `run-pipeline-v2.js` — 8-шаговый оркестратор с in-memory очередями, AI Vision (Gemini 3-flash-preview), Tag System v3 (32 тега), auto-resume, draft статус для celebrities/movies, миграция 012
- **Теги и UI (16.03.2026)**:
  - 32 канонических тега с `is_canonical=true`, `name_localized` (10 языков), `videos_count`
  - `backfill-tags.js` — бэкфил тегов для 613 старых видео через `tag_mapping` + `DONOR_MAP`
  - Публичный сайт: только canonical теги из `video_tags JOIN tags WHERE is_canonical=true`; categories не показываются
  - Панель тегов `/video`: sticky, золотая тема (`brand-accent`), drag-scroll, sort dropdown отдельно
  - `getAllTags()`: фильтр `is_canonical=true AND videos_count > 0`
- **Pipeline fixes (16.03.2026)**:
  - Дедупликация: скрапер проверяет `videos JOIN raw_videos` вместо только `raw_videos`
  - `resumeFromWorkdirs()`: удаляет orphan raw_videos + сбрасывает stuck `processing` → `processed`
  - `fetchPendingVideos()`: fix `$2::text` cast для PostgreSQL type inference
  - Early stop: скрапер прекращает сканирование при достижении limit новых видео (`earlyStop` flag)
  - Stop endpoint: `SIGTERM` → 5s timeout → `SIGKILL` fallback
  - SIGTERM kills scraper subprocess immediately (`scraperChild.kill("SIGKILL")`)
- **Pipeline v2 fixes (16.03.2026)**:
  - AI Vision: fixed `bestResult.model` → `model` in saveResults() (was crashing all saves)
  - maxOutputTokens: 2048 → 8192 (prevent JSON truncation)
  - Detached child process: file-based stdio, survives `pm2 restart pipeline-api`
  - File size limit: `maxSizeMb` param, HEAD request check before download
  - Start button: source default `''` → `'boobsradar'`
  - Category counts: query fix `collections WHERE is_auto = true` → `collections`
- **Home Watermark Worker (16.03.2026)**:
  - Python script on user's Windows PC, web dashboard on `:8585`
  - Shared DB queue: both Contabo (2 slots) and home worker poll `watermark_ready` with `FOR UPDATE SKIP LOCKED`
  - Flow: SCP download → FFmpeg veryfast CRF22 → BunnyCDN upload → SCP back → DB update
  - Pipeline polls for `watermarked` videos from home worker → enqueues to `media` step
  - Error retry: 3 attempts, then `watermark_failed`. CDN upload: 3 retries with 10s delay
  - Pipeline completion waits for `watermarking_home` videos in DB
- **Pipeline Hardening & Data Quality (18.03.2026)**:
  - Scraper speedup: page-level early stop (2 consecutive full-skip pages → stop), Set preloading, silent skipping
  - Broken thumbnails: `repair-thumbnails.js` + API endpoint + admin UI (scan/repair buttons)
  - CDN download: Storage API (`storage.bunnycdn.com` + AccessKey) instead of CDN URL (was 403)
  - Dynamic FFmpeg timeout: 5× duration, min 60 min (was fixed 30 min)
  - Stuck video recovery: main loop re-enqueues videos stuck >10 min
  - 404/403 instant fail: `NonRetryableError` class, no retries for HTTP 404/403
  - video_url fix: removed `raw?.video_file_url` fallback — no more boobsradar URLs in player
  - Celebrity name cleanup: `cleanCelebrityName()` in pipeline, regex fix in adapter, 47 garbage entries fixed
  - Duration backfill: 8 videos → ffprobe via Bunny Storage API
  - Quality backfill: 119 videos HD/SD/Unknown → real quality via ffprobe
  - Collections Title Case: 37 ALL CAPS → Title Case, `toTitleCase()` in `sync-categories.js`
  - setsar=1 in FFmpeg watermark, AI Vision timeout 5→10 min
  - Dedup by original_title: backfilled 2135 videos, scraper checks publishedTitles Set

- **Pipeline Restoration (18.03.2026)**:
  - `generate-multilang.js` recreated (was missing) — Gemini 3-flash-preview, 10 locales, accepts `--video-id`
  - Gemini key rotation: comma-separated keys, `nextSessionKey()` locks one key per upload+generate cycle (File API key-bound)
  - Translation check in processPublish: blocks without ru title/review/seo
  - Collection linking: `donor_category` from `raw_videos` → `collection_videos`
  - Download timeout 10→30 min
  - Start button debounce (3s yellow "Запускается...")
  - `resetInProgressVideos` preserves `needs_review` and `failed`
  - `ai_vision_error` written on Gemini fallback for UI display
  - 133 orphan Bunny folders deleted

- **Система поиска (18-19.03.2026)**:
  - PostgreSQL: `search_index` (unified full-text), `search_synonyms` (69 строк, 10 языков), `smart_search()` функция (5-уровневый скоринг: exact_tag 100 → celebrity_fuzzy 80 → fulltext_en 50 → fulltext_all 40 → trigram 30)
  - Расширения: pg_trgm, unaccent
  - 8 триггеров автообновления search_index при CRUD videos/celebrities/collections/tags
  - Детерминистичные UUID: celebrities (0001-{id}), collections (0002-{id}), tags (0003-{id})
  - API: `GET /api/search?q=&phase=1|2&lang=&hydrate=true` — synonym lookup, smart_search, dedup, grouping, Redis cache (1ч)
  - Phase 2: Gemini 2.5 Flash (`query-expander.ts`) — извлечение имён, тегов, фильмов, 3с timeout, 24ч Redis cache
  - `SearchDropdown.tsx`: двухфазный dropdown в Header, debounce 400мс, auto phase 2 при <20 результатах, solid bg #11100e
  - `[locale]/search/page.tsx`: полная страница результатов с гидрированными сущностями, горизонтальные скроллы, grid видео, noindex
  - Header обновлён: SearchDropdown вместо статичной формы

- **Gemini API Key Fixes (25.03.2026)**:
  - 3 Gemini API ключа (Paid Tier 1) — ротация через запятую в `GEMINI_API_KEY`
  - Ключи хранятся в БД `settings.gemini_api_key` (через запятую) + `.env` на Contabo
  - UI Настроек: 3 отдельных поля `gemini_api_key_1/2/3` → мержатся в одну строку `gemini_api_key`
  - **CRITICAL FIX**: dotenv НЕ перезаписывает уже установленные `process.env` vars. Pipeline-api.js передаёт `env: {...process.env}` дочерним процессам. При обновлении ключей — **ОБЯЗАТЕЛЬНО перезапустить pipeline-api.js** на Contabo: `cd /opt/celebskin/scripts && kill $(pgrep -f pipeline-api) && nohup node pipeline-api.js > logs/pipeline-api.log 2>&1 &`
  - `isTransientError`: добавлены `quota`, `exceeded`, `RESOURCE_EXHAUSTED` — quota ошибки → `error` (retryable), не `censored`
  - Quota break: при 429/quota — break + sleep 15s → следующая модель с другим ключом
  - Throttle 10s между моделями при ошибках
  - AI Vision concurrency: 3 → 2 воркера
  - DB constraint `videos_ai_vision_status_check`: добавлен статус `error`
  - Pipeline-api.js запускать из `/opt/celebskin/scripts/` (там node_modules), НЕ из `/opt/celebskin/site/scripts/`

## Правила
- НИКОГДА не менять AI модели без явного запроса Тараса
- НИКОГДА не запускать pipeline на AbeloHost — только на Contabo
- НИКОГДА не записывать boobsradar search URL в video_url
- НИКОГДА не публиковать видео без русских переводов (title.ru, review.ru, seo_title.ru)
- НИКОГДА не использовать `process-with-ai.js` в pipeline v2 (это v1 скрипт для raw_videos)
- `generate-multilang.js` — единственный скрипт для переводов в pipeline v2
- Gemini File API: upload и generateContent ОБЯЗАНЫ использовать ОДИН И ТОТ ЖЕ API ключ
- Gemini AI Vision: gemini-3-flash-preview. Legacy: gemini-2.5-flash
- video_url при создании = NULL, заполняется pipeline (cdn_upload шаг)
- При смене Gemini API ключей — ОБЯЗАТЕЛЬНО: `pm2 restart pipeline-api --update-env`
- Pipeline-api.js управляется через PM2 на Contabo (process name: `pipeline-api`)
- `run-xcadr-pipeline.js` и `pipeline-api.js` — ХАРДЛИНКИ, менять в `/opt/celebskin/scripts/`
- Актрисы и фильмы хранятся с АНГЛИЙСКИМИ именами, локализация в JSONB (name_localized, title_localized)
- Дедупликация xcadr видео по `source_url` (уникальный индекс), НЕ по original_title
- xcadr_imports: только `published` и `duplicate` остаются, остальное удаляется при старте/завершении
- Pipeline запускается ТОЛЬКО из UI (`/admin/xcadr-pipeline`), НЕ из CLI
- Админка на русском языке
- Полное ТЗ XCADR Pipeline: `/opt/celebskin/XCADR_PIPELINE_TZ.md`
