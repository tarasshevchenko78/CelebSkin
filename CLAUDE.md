# CelebSkin — Контекст для Claude Code

> **ВАЖНО**: Этот файл — главный источник контекста для Claude Code. Обновляй его после каждого значимого изменения в проекте. Также обновляй memory-файлы в `/root/.claude/projects/-root/memory/`.

## Проект
CelebSkin (celeb.skin) — мультиязычная платформа эротических сцен знаменитостей из фильмов/сериалов.

## Стек
- **Frontend**: Next.js 14.2.35, React 18, TypeScript, Tailwind CSS
- **DB**: PostgreSQL 16, Redis 7
- **AI**: Google Gemini (text + vision), TMDB API
- **CDN**: BunnyCDN (storage zone: `celebskin-media`, CDN: `celebskin-cdn.b-cdn.net`). **НЕ ИСПОЛЬЗОВАТЬ `cdn.celeb.skin`** — SSL сертификат сломан!
- **Локали**: en, de, es, fr, it, nl, pl, pt, ru, tr
- **Repo**: github.com/tarasshevchenko78/CelebSkin (branch: main)

## Серверы

| Сервер | IP | Роль | Доступ |
|--------|-----|------|--------|
| AbeloHost | 185.224.82.214 | Frontend + БД + Redis | Claude Code работает здесь |
| Contabo (DE) | 161.97.142.117 | Pipeline скрипты | `ssh root@161.97.142.117` |

## Рабочие директории
- **Сайт (AbeloHost)**: `/opt/celebskin/site/`
- **Pipeline скрипты (Contabo)**: `/opt/celebskin/scripts/`
- **Pipeline скрипты (в git)**: `scripts/` — зеркало Contabo, деплой вручную
- **PM2**: процесс `celebskin`, порт 3000
- **Логи pipeline**: `/opt/celebskin/scripts/logs/` (Contabo)
- **Прогресс-файл**: `/opt/celebskin/scripts/logs/progress.json` (Contabo, читается фронтом через API)

## Текущее состояние (07.03.2026)
- **30 видео** published (все с CDN watermark + CDN thumbnails, все проверены health-check)
- **13 фильмов** (все с постерами)
- **17 актрис** (3 без фото: Frances Raines, Misungi De La Nuit, Monica Macfer — TMDB не имеет)
- **Scheduler-based conveyor belt pipeline** (полностью переписан 07.03.2026)
  - `run-pipeline.js` — scheduler опрашивает БД каждые 5 сек на наличие работы
  - Каждый шаг обрабатывает до 3 видео одновременно (`MAX_PER_STEP=3`)
  - Видео переходят между шагами по готовности: scrape→AI→TMDB→watermark→thumbnails→CDN→publish
  - TMDB запускается ТОЛЬКО один раз после завершения ai-process (флаг `_enrichTriggered`)
  - Видео без полных данных → `needs_review` → навсегда уходят из конвейера
  - Кнопки отдельных шагов УБРАНЫ из UI — только "Run Full Pipeline"
  - PID tracking: `pipeline.pid` + `children.pid` для надёжного kill
  - `.stop` sentinel для drain mode
- **Admin UI переделан**: компактная статистика, визуализация конвейера, карточки видео
- **CDN URL**: `celebskin-cdn.b-cdn.net` (НЕ `cdn.celeb.skin` — SSL сломан!)
- **Video health-check** — `/admin/test-video` + API `/api/admin/video-health`
- Загрузка фото/постеров вручную через админку — реализована и задеплоена
- Все pipeline скрипты в git

---

## Pipeline (конвейер обработки видео)

```
scrape → ai-process → visual-recognize → tmdb-enrich → watermark → cdn-upload → thumbnails → publish
```

Оркестратор: `run-pipeline.js` — **scheduler-based conveyor belt**:
- Scheduler loop каждые 5 сек: `getWorkAvailability()` → spawn шаги с работой
- Все шаги работают параллельно, каждый до 3 видео (`MAX_PER_STEP=3`)
- **Scrape**: запускается один раз в начале pipeline
- **AI Process**: стартует когда появляются `raw_videos.status='pending'`
- **TMDB Enrich**: запускается ОДИН РАЗ после завершения ai-process (флаг `_enrichTriggered`)
- **Watermark/Thumbnails/CDN/Publish**: стартуют по готовности видео в БД
- Видео без `video_file_url` → пропускаются скрейпером
- Видео без `video_url` после AI → `needs_review` (уходят из конвейера)
- PID tracking: `pipeline.pid` + `children.pid`; `.stop` файл для drain mode
- Завершение: 3 пустых цикла подряд без работы → pipeline complete

### Скрипты pipeline (`scripts/`)
| Файл | Назначение |
|------|-----------|
| `scrape-boobsradar.js` | Парсинг видео с источников → `raw_videos` |
| `process-with-ai.js` | Gemini AI анализ (Level 1: текст, Level 2: visual если confidence < 0.5) |
| `visual-recognize.js` | Отдельный visual recognition для low-confidence видео |
| `enrich-metadata.js` | TMDB обогащение (фото актрис, постеры, биографии) |
| `watermark.js` | Наложение watermark celeb.skin на видео (FFmpeg) |
| `upload-to-cdn.js` | Загрузка видео/фото/постеров на BunnyCDN + обновление URL в БД |
| `generate-thumbnails.js` | Screenshots, sprite sheet, preview GIF |
| `publish-to-site.js` | Публикация видео (status → published) + обновление счётчиков |
| `run-pipeline.js` | Оркестратор — конвейер (default) или sequential (`--sequential`) |

### Библиотеки pipeline (`scripts/lib/`)
| Файл | Назначение |
|------|-----------|
| `visual-recognizer.js` | Gemini Vision API: 2-этапная стратегия (Flash 1 кадр → Pro 6 кадров) |
| `frame-extractor.js` | FFmpeg извлечение ключевых кадров |
| `progress.js` | Прогресс-трекинг: `initSteps()`, `writeProgress()`, `completeStep()`, `markStepDone()`, `writeStepStatus()`, `clearAllProgress()`, **`setActiveItem()`**, **`removeActiveItem()`** |
| `db.js` | PostgreSQL подключение для pipeline |
| `logger.js` | Логирование в файл + консоль |
| `catalog-matcher.js` | Матчинг по каталогам |

### Прогресс-система (`progress.js`)
- **Формат файла**: `{ steps: { "scrape": {...}, "ai-process": {...} }, pipeline: {...}, updatedAt: "..." }`
- Каждый скрипт пишет в свой ключ через `writeProgress()` → `completeStep(finalData)` в конце
- `completeStep()` сохраняет: `videosDone`, `elapsedMs`, `startedAt`, `finishedAt`, `status: 'completed'`
- `markStepDone(stepName, finalData)` — для шагов с 0 элементами (вызывается оркестратором)
- `run-pipeline.js` в конце пишет `writePipelineProgress({ status: 'finished', stepTimings: [...] })`
- Фронтенд опрашивает `/api/admin/pipeline` → читает progress.json через SSH/API

### Запуск pipeline
```bash
# На Contabo
cd /opt/celebskin/scripts
node run-pipeline.js --limit=5          # конвейер, 5 видео (все шаги параллельно)
node run-pipeline.js --sequential       # классический последовательный режим
node run-pipeline.js --limit=1 --skip=scrape  # без скрейпинга
node run-pipeline.js --test             # тестовый режим (batch=1)
node enrich-metadata.js --force --limit=50     # принудительное обогащение TMDB
```

### Порядок шагов (scheduler-based)
```
scrape: запускается 1 раз в начале
ai-process: когда есть raw_videos.status='pending'
tmdb-enrich: ОДИН РАЗ после завершения ai-process (флаг _enrichTriggered)
watermark: когда videos.status IN ('enriched','auto_recognized') + video_url есть
thumbnails: когда videos.status='watermarked' + нет CDN thumbnail
cdn-upload: когда есть tmp/ URL'ы
publish: когда watermarked + CDN URLs для видео И thumbnail
```
Видео без полных данных на любом шаге → `needs_review` → навсегда покидает конвейер.

---

## Frontend — Ключевые файлы

### Публичные страницы
| Файл | Назначение |
|------|-----------|
| `src/app/[locale]/video/[slug]/page.tsx` | Страница видео |
| `src/app/[locale]/celebrity/[slug]/page.tsx` | Страница знаменитости + фильмография |
| `src/app/[locale]/movie/[slug]/page.tsx` | Страница фильма |
| `src/app/[locale]/search/page.tsx` | Поиск |

### Админка (`/admin/*`)
| Файл | Назначение |
|------|-----------|
| `src/app/admin/celebrities/page.tsx` | Список актрис (серверный, пагинация, поиск) |
| `src/app/admin/celebrities/[id]/page.tsx` | Редактирование актрисы + **загрузка фото на BunnyCDN** |
| `src/app/admin/movies/page.tsx` | Список фильмов |
| `src/app/admin/movies/[id]/page.tsx` | Редактирование фильма + **загрузка постера на BunnyCDN** |
| `src/app/admin/videos/page.tsx` | Список видео |
| `src/app/admin/videos/[id]/page.tsx` | Детальная страница видео |
| `src/app/admin/scraper/page.tsx` | Pipeline управление + прогресс |
| `src/app/admin/moderation/page.tsx` | Модерация unknown видео |
| `src/app/admin/ai/page.tsx` | AI чат |
| `src/components/admin/PipelineControls.tsx` | Компонент UI pipeline (step panels, тайминги, activeItems progress bars) |
| `src/app/admin/test-video/page.tsx` | **Тестовая страница воспроизведения видео** (browser playback test) |
| `src/components/admin/LocalizedTabs.tsx` | Табы локализации для edit-страниц |
| `src/components/admin/AdminCelebritiesTable.tsx` | Таблица актрис |

### API routes
| Файл | Назначение |
|------|-----------|
| `src/app/api/admin/pipeline/route.ts` | Pipeline actions (start, stop, status) |
| `src/app/api/admin/upload/route.ts` | **Загрузка изображений на BunnyCDN** (фото актрис, постеры фильмов) |
| `src/app/api/admin/celebrities/[id]/route.ts` | CRUD актрис |
| `src/app/api/admin/movies/[id]/route.ts` | CRUD фильмов |
| `src/app/api/admin/videos/[id]/route.ts` | CRUD видео |
| `src/app/api/admin/moderation/route.ts` | Модерация (approve/reject/reanalyze) |
| `src/app/api/admin/pipeline-logs/route.ts` | Логи pipeline |
| `src/app/api/admin/video-health/route.ts` | **Health-check всех видео URL** (серверная проверка CDN) |

### Библиотеки
| Файл | Назначение |
|------|-----------|
| `src/lib/db.ts` | SQL-запросы, пул подключений. `enrichVideoWithRelations()` — подгружает celebrities (c photo_url), movie (c poster_url), tags |
| `src/lib/types.ts` | TypeScript интерфейсы (Video, Celebrity, Movie, etc.) |
| `src/lib/i18n.ts` | `getLocalizedField(field, locale)` — доступ к LocalizedField JSONB |
| `src/middleware.ts` | i18n routing + Basic Auth для /admin |

---

## База данных (PostgreSQL 16)

### Основные таблицы
| Таблица | Назначение |
|---------|-----------|
| `videos` | Основные видео (id UUID, title JSONB, slug, status, video_url, thumbnail_url, etc.) |
| `celebrities` | Актрисы (id SERIAL, name, slug, photo_url, bio JSONB, tmdb_id, etc.) |
| `movies` | Фильмы (id SERIAL, title, slug, poster_url, year, tmdb_id, etc.) |
| `movie_scenes` | Связь video ↔ movie (video_id, movie_id, scene_number) |
| `video_celebrities` | Связь video ↔ celebrity (video_id, celebrity_id, confidence) |
| `movie_celebrities` | Связь movie ↔ celebrity (movie_id, celebrity_id, role) |
| `tags` | Теги (id, name JSONB, slug) |
| `video_tags` | Связь video ↔ tag |
| `raw_videos` | Сырые видео от скрейпера (до обработки AI) |
| `processing_log` | Лог обработки pipeline |

### Статусы видео (`videos.status`)
```
new → processing → enriched → auto_recognized → watermarked → published
Также: needs_review, unknown_with_suggestions, unknown, rejected, dmca_removed
```

### Колонки распознавания (`videos`)
- `recognition_data` JSONB — сырые результаты Gemini Vision
- `recognition_method` VARCHAR — 'metadata', 'visual', 'manual'
- `ai_confidence` FLOAT — общий confidence score (0.0–1.0)
- `ai_data` JSONB — результат AI анализа (celebrities, movie_title, etc.)

### Подключение к БД
```
Host: 127.0.0.1, Port: 5432, DB: celebskin, User: celebskin
```

---

## 3-уровневая архитектура распознавания

1. **Level 1**: Текстовые метаданные (filename, URL, description) → Gemini text → confidence
2. **Level 2**: Визуальное (Gemini Vision) — только если Level 1 confidence < 0.5
3. **Level 3**: Ручная модерация через админку (`/admin/moderation`)

### Правила безопасности visual recognition
- `visual-recognize.js` НЕ создаёт связи в БД — только сохраняет `recognition_data`
- `process-with-ai.js` проверяет confidence >= 0.7 для каждого актёра и фильма
- Не перезаписывает уже определённые из метаданных данные
- Связи создаются только: `process-with-ai.js` (с проверками) или модератор (админка)

---

## Загрузка изображений (Upload)

### API: `POST /api/admin/upload`
- FormData: `{ file: File, type: 'celebrity' | 'movie', id: string, slug: string }`
- Валидация: только images, макс 10MB
- Загружает на BunnyCDN Storage: `celebrities/{slug}/photo.{ext}` или `movies/{slug}/poster.{ext}`
- Обновляет `photo_url` / `poster_url` в БД
- CDN URL: `https://celebskin-cdn.b-cdn.net/{path}`

### BunnyCDN credentials (в .env.local)
- Storage zone: `celebskin-media`
- Host: `storage.bunnycdn.com`
- API: PUT `https://storage.bunnycdn.com/{zone}/{path}` с заголовком `AccessKey`

---

## Деплой

```bash
# Frontend (AbeloHost)
cd /opt/celebskin/site && npm run build && pm2 restart celebskin

# Pipeline скрипты (Contabo) — ручной деплой
scp scripts/*.js root@161.97.142.117:/opt/celebskin/scripts/
scp scripts/lib/*.js root@161.97.142.117:/opt/celebskin/scripts/lib/
```

### Git
```bash
cd /opt/celebskin/site
git add <files>
git commit -m "message"
git push origin main
```

---

## Известные проблемы и ограничения

### Активные
1. **3 актрисы без фото** (Frances Raines, Misungi De La Nuit, Monica Macfer) — TMDB не имеет. Можно загрузить вручную через админку.
2. **`cdn.celeb.skin` SSL сломан** — кастомный CDN домен не имеет SSL cert на BunnyCDN. Используется `celebskin-cdn.b-cdn.net`. **Не менять!**
3. **enrich-metadata.js gap**: Фильмы уже в БД с `tmdb_id IS NULL` не обогащаются при обычном pipeline. Нужен Step 3.
4. **Pipeline скрипты деплоятся вручную** — `rsync -avz --delete scripts/ root@161.97.142.117:/opt/celebskin/scripts/ --exclude=tmp --exclude=node_modules --exclude=.env`
5. **Что-то меняет статус published видео обратно на enriched** — если у видео нет watermarked URL и CDN video URL, кто-то (pipeline worker?) откатывает статус. Нужно расследовать.

### Решённые (07.03.2026)
1. **CDN URL `cdn.celeb.skin` → `celebskin-cdn.b-cdn.net`** — SSL сертификат был сломан, все видео/thumbnail/sprite URL в БД заменены
2. **Строгий порядок конвейера** — publish теперь принимает ТОЛЬКО видео со статусом `watermarked` + CDN URLs для video И thumbnail
3. **Per-video activeItems прогресс** — все 5 pipeline шагов отображают индивидуальный прогресс для каждого видео
4. **VideoPlayer улучшен** — play() promise handling, детальные коды ошибок, crossOrigin
5. **6 битых видео удалены** — boobsradar source URLs протухли (403), видео не подлежали восстановлению
6. **Video health-check** — API + UI страница для проверки всех CDN URL и browser playback

### Решённые (04.03.2026)
1. Битые thumbnails видео — исправлено через re-upload с tmp-путями
2. Фото актрис и постеры фильмов не отображались на frontend — добавлен conditional rendering
3. Ложные связи от visual recognition — добавлены проверки confidence >= 0.7
4. Pipeline прогресс-бары показывали чушь — полная переработка progress.js + всех скриптов + фронтенда
5. `upload-to-cdn.js` crash (`videos is not defined`) — исправлена область видимости переменной
6. TMDB enrichment не обогащал существующие фильмы — запущен `--force`

---

## Pending задачи (не реализованы)
- [ ] Watermark: промежуточный прогресс (FFmpeg progress tracking через activeItems)
- [ ] Pipeline ETA: прогнозирование времени на основе истории + размера файла
- [ ] Per-video total pipeline time summary log
- [ ] `enrich-metadata.js` Step 3: обогащение фильмов с `tmdb_id IS NULL`
- [ ] Автоматический деплой скриптов на Contabo (CI/CD или git hook)
- [ ] Починить SSL для `cdn.celeb.skin` на BunnyCDN (Custom Hostname → Enable SSL)
- [ ] Расследовать кто меняет status published → enriched для видео без CDN watermark URL

---

## Конфиг-файлы
- `.env.local` — все секреты (БД, Redis, BunnyCDN, Admin)
- `next.config.js` — Next.js конфиг
- `middleware.ts` — i18n routing + Basic Auth
- `tailwind.config.ts` — Tailwind

## Память Claude Code
- `/root/.claude/projects/-root/memory/MEMORY.md` — краткий обзор (загружается в контекст автоматически)
- `/root/.claude/projects/-root/memory/architecture.md` — архитектура
- `/root/.claude/projects/-root/memory/known-issues.md` — баги и фиксы

---

## История изменений

### 07.03.2026 (сессия 6+7) — Pipeline scheduler rewrite + UI redesign
- **Pipeline полностью переписан**: scheduler-based conveyor belt
  - `run-pipeline.js`: DB-driven `getWorkAvailability()` каждые 5 сек
  - `MAX_PER_STEP=3` видео одновременно в каждом шаге
  - PID tracking (`pipeline.pid` + `children.pid`), `.stop` sentinel для drain
- **TMDB enrich**: флаг `_enrichTriggered` — только после завершения ai-process, один раз
- **Баг-фиксы**:
  - SQL UNION type mismatch в scraper (убран `::text`)
  - `continue` → `return` в async map (Promise.all)
  - ai-process: проверка `raw_videos.status='pending'` (было `videos.status='new'`)
  - Валидация video_file_url в process-with-ai.js и scraper
  - Auto-cleanup stuck videos → needs_review
  - Zombie `processing_log` записи — исключены `admin:*`, лимит 1 час
- **Admin UI переделан**:
  - Compact summary bar (вместо 11 карточек)
  - Pipeline flow visualization (цепочка шагов с количеством видео)
  - Video journey cards (всегда видимы, не только при запуске)
  - Individual step buttons УБРАНЫ (только "Run Full Pipeline")
  - Yellow dots = ожидание, Purple = обработка
- **API route**: добавлены `flowCounts`, `inProgressVideos`, фикс activeSteps

### 07.03.2026 (сессия 4+5)
- **CRITICAL FIX: CDN URL `cdn.celeb.skin` сломан** — SSL cert покрывал только `*.b-cdn.net`
  - `.env` на обоих серверах → `BUNNY_CDN_URL=https://celebskin-cdn.b-cdn.net`
  - Дефолты в скриптах → `celebskin-cdn.b-cdn.net`
  - Все хардкоды `cdn.celeb.skin` убраны из publish, cdn-upload, thumbnails, run-pipeline
  - 50+ URL в БД заменены (video_url, video_url_watermarked, thumbnail_url, sprite_url, preview_gif_url, screenshots)
- **Строгий порядок конвейера** (Part 1 плана):
  - `publish-to-site.js`: только `status='watermarked'` + CDN URLs для видео И thumbnail
  - `generate-thumbnails.js`: только `status='watermarked'`
  - `upload-to-cdn.js`: только `status IN ('watermarked','published')`
- **Per-video activeItems прогресс** (Part 2 плана):
  - `progress.js`: `setActiveItem(id, {label, subStep, pct})`, `removeActiveItem(id)`, auto-flush
  - Все 5 pipeline скриптов: watermark, thumbnails, cdn-upload, ai-process, publish — трекинг sub-steps
  - `PipelineControls.tsx`: purple progress bars с ETA, elapsed time, sub-step labels
- **Video health-check**:
  - API: `/api/admin/video-health` (серверная проверка HEAD запросами всех CDN URL)
  - UI: `/admin/test-video` (browser playback test — canplay/error events)
- **VideoPlayer улучшен**: play() promise, детальные ошибки, crossOrigin
- **6 битых видео удалены** (boobsradar URLs expired, 403 Forbidden)
- Итого: 30 published, все healthy

### 04.03.2026 (сессия 3)
- **Конвейерный pipeline** — все шаги работают параллельно (true conveyor belt)
  - `runOnceWorker()` для одноразовых шагов (scrape), запускается параллельно с polling
  - `runStepWorker()` — polling loop (10s interval, maxIdlePolls=3)
  - Зависимости проверяются при idle termination, не при запуске
  - Фронтенд: idle/waiting статусы, "Conveyor Pipeline" badge, несколько active шагов
- Протестировано: видео проходит AI → watermark → CDN → publish пока другие ещё в AI

### 04.03.2026 (сессия 2)
- Переработана система прогресса pipeline: `completeStep()`, `markStepDone()`, тайминги, нет stale данных
- Фронтенд: тайминги шагов, "Pipeline Complete" state, корректные проценты завершения
- Добавлена загрузка фото актрис и постеров фильмов через админку (BunnyCDN upload API)
- Исправлен crash `upload-to-cdn.js` (scope bug `videos is not defined`)
- TMDB enrichment `--force` для всех актрис и фильмов
- 2 новых видео обработаны через pipeline

### 04.03.2026 (сессия 1)
- Реализован visual recognition pipeline (Gemini Vision + TMDB verification)
- Исправлено отображение фото актрис и постеров фильмов на frontend
- Исправлены ложные связи от visual recognition (проверки confidence)
- Перегенерированы thumbnails для видео с битыми превью
- Все pipeline скрипты добавлены в git
- TMDB enrichment для всех celebrities и movies
