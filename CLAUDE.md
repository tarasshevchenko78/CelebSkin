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
    db/                — модули БД (pool, videos, celebrities, movies, search, etc.)
    config.ts          — централизованный конфиг
    cache.ts           — Redis кэш с инвалидацией
    logger.ts          — структурированные логи
    gemini.ts          — Gemini API хелперы
    seo.ts             — hreflang хелпер
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
  watermark.js         — наложение водяного знака
  generate-thumbnails.js
  generate-preview.js
  upload-to-cdn.js
  publish-to-site.js
  run-pipeline.js
  deploy-web.sh
  deploy-pipeline.sh
  backup-db.sh
db/
  migrations/          — SQL миграции (001-008)
```

## Два сервера — строгое разделение
- AbeloHost: ТОЛЬКО web app, БД, Redis. Никакого FFmpeg, AI обработки
- Contabo: ТОЛЬКО pipeline скрипты. Триггерится через SSH с AbeloHost
- Pipeline scripts на Contabo коннектятся к БД на AbeloHost (DB_HOST=185.224.82.214)
- Никогда не запускать pipeline на AbeloHost
- API ключи (Gemini, TMDB) хранятся на Contabo в /opt/celebskin/scripts/.env

## xcadr Pipeline (Contabo)
Порядок: parse → translate → match → map-tags → import (из админки) → download-and-process
- parse: парсит xcadr.online, сохраняет метаданные в xcadr_imports
- translate: переводит через TMDB + Gemini
- match: ищет совпадения в нашей БД
- map-tags: маппит русские теги на наши
- import: создаёт записи video/celebrity/movie в БД (из админки)
- download: скачивает видео, обрабатывает FFmpeg, заливает на CDN

## Известные баги (март 2026)
1. Import пишет boobsradar URL в video_url — должен быть NULL
2. Скачивается 480p вместо максимального качества
3. Водяной знак xcadr.online не убирается — delogo не реализован
4. Коллекции не привязываются к видео при Import
5. Draft статус для актрис/фильмов не реализован
6. AI описание — промт не обновлён на эротический стиль
7. Удаление видео из админки может не работать
8. Часть админки всё ещё на английском

## Правила
- НИКОГДА не менять AI модели без явного запроса Тараса
- НИКОГДА не запускать pipeline на AbeloHost — только на Contabo
- НИКОГДА не записывать boobsradar search URL в video_url
- Промты для Sonnet давать КОРОТКИЕ — по 1 багу, иначе пропускает
- Gemini модель: gemini-2.5-flash (с thinking tokens — использовать extractGeminiJSON)
- video_url при создании = NULL, заполняется только download-and-process.js
- Админка на русском языке
