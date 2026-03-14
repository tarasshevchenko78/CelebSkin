# CelebSkin — CLAUDE.md

## Архитектура
- **AbeloHost** (185.224.82.214): Next.js 14 App Router + TypeScript, PostgreSQL 16, Redis, Nginx, PM2
- **Contabo** (161.97.142.117): Pipeline scripts, FFmpeg, Playwright, AI processing (Gemini 2.5 Flash)
- **Bunny CDN** (celebskin-cdn.b-cdn.net): Видео, скриншоты, фото, постеры
- **Домен**: celeb.skin (Namecheap)
- **GitHub**: tarasshevchenko78/CelebSkin

## Стек
- Next.js 14 App Router, TypeScript
- PostgreSQL 16 с JSONB для 10 языков (ru, en, de, fr, es, pt, it, pl, nl, tr)
- Redis — кэширование (TTL 60-300с)
- BunnyCDN — медиа хранилище и доставка
- Gemini 2.5 Flash — AI обработка, переводы, описания
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
  lib/
    db/                — модули БД (pool, videos, celebrities, movies, search, settings, etc.)
    config.ts          — централизованный конфиг
    cache.ts           — Redis кэш с инвалидацией
    logger.ts          — структурированные логи
    gemini.ts          — Gemini API хелперы
    seo.ts             — hreflang хелпер
    bunny.ts           — Bunny CDN upload helper
  components/
    VideoCard.tsx      — универсальная карточка видео с hover preview
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
  xcadr/
    parse-xcadr.js     — парсер xcadr.online
    translate-xcadr.js — перевод через TMDB + Gemini
    match-xcadr.js     — поиск совпадений в БД
    map-tags.js        — маппинг тегов и коллекций
    download-and-process.js — скачивание + обработка видео
    auto-import.js     — автоматический оркестратор
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
  migrations/          — SQL миграции (001-009, 009 = settings table)
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
- **Водяной знак**: preset `ultrafast` + `-threads 0` + timeout 30мин
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

## xcadr Pipeline (Contabo)
Порядок: parse → translate → match → map-tags → import (из админки) → download-and-process
- parse: парсит xcadr.online, сохраняет метаданные в xcadr_imports
- translate: переводит через TMDB + Gemini
- match: ищет совпадения в нашей БД
- map-tags: маппит русские теги на наши
- import: создаёт записи video/celebrity/movie в БД (из админки)
- download: скачивает видео, обрабатывает FFmpeg, заливает на CDN

## Известные баги (март 2026)
1. ~~Import пишет boobsradar URL в video_url — должен быть NULL~~ — video_url используется watermark шагом, перезаписывается CDN upload
2. Скачивается 480p вместо максимального качества
3. Водяной знак xcadr.online не убирается — delogo не реализован
4. ~~Коллекции не привязываются к видео при Import~~ — ИСПРАВЛЕНО
5. Draft статус для актрис/фильмов не реализован
6. AI описание — промт не обновлён на эротический стиль
7. Удаление видео из админки может не работать
8. Часть админки всё ещё на английском
9. ~~PIPELINE_ERROR_DECODE при перемотке видео в Chrome~~ — ИСПРАВЛЕНО в watermark.js (SAR=1:1, фиксированные keyframes, audio resample). Старые 303 видео всё ещё имеют нестандартный SAR — нужна перекодировка через `reprocess-broken-videos.js`
10. 53 видео привязаны к 2+ фильмам (дубли: оригинал + перевод названия) — AI/TMDB создают дубликаты фильмов

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
- Документация деплоя: выяснено, что Web App задеплоен на Vercel (push в `master` обновляет UI админки на `celeb.skin`).
- Фиксы багов: устранены дубликаты фильмов (проверка точного названия в `xcadr/route.ts`), восстановлен UI скриншотов в админке, исправлены локальные ссылки CDN на `celebskin-cdn.b-cdn.net`.
- **Watermark fix (13.03.2026)**: `-sar 1:1`, `-keyint_min 48 -sc_threshold 0`, `-af aresample=async=1:first_pts=0`, `-fflags +genpts+discardcorrupt`, `-max_muxing_queue_size 4096` — исправляет PIPELINE_ERROR_DECODE при seek в Chrome
- Новые скрипты: `scan-broken-videos.js` (сканирование SAR), `reprocess-broken-videos.js` (перекодировка старых видео)

## Правила
- НИКОГДА не менять AI модели без явного запроса Тараса
- НИКОГДА не запускать pipeline на AbeloHost — только на Contabo
- НИКОГДА не записывать boobsradar search URL в video_url
- Промты для Sonnet давать КОРОТКИЕ — по 1 багу, иначе пропускает
- Gemini модель: gemini-2.5-flash (с thinking tokens — использовать extractGeminiJSON)
- video_url при создании = NULL, заполняется только download-and-process.js
- Админка на русском языке
