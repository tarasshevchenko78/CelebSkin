# CelebSkin — Контекст для Claude Code

> **ВАЖНО**: Этот файл — главный источник контекста для Claude Code. Обновляй его после каждого значимого изменения в проекте. Также обновляй memory-файлы в `/root/.claude/projects/-root/memory/`.

## Проект
CelebSkin (celeb.skin) — мультиязычная платформа эротических сцен знаменитостей из фильмов/сериалов.

## Стек
- **Frontend**: Next.js 14.2.35, React 18, TypeScript, Tailwind CSS
- **DB**: PostgreSQL 16, Redis 7
- **AI**: Google Gemini (text + vision), TMDB API
- **CDN**: BunnyCDN (storage zone: `celebskin-media`, CDN: `celebskin-cdn.b-cdn.net`)
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

## Текущее состояние (04.03.2026)
- **14+ видео** published (все с CDN watermark + CDN thumbnails)
- **13 фильмов** (все с постерами)
- **17 актрис** (3 без фото: Frances Raines, Misungi De La Nuit, Monica Macfer — TMDB не имеет)
- **Конвейерный pipeline** — все шаги работают параллельно (настоящий conveyor belt)
- Pipeline progress система полностью переработана (тайминги, данные завершения, нет устаревших данных)
- Загрузка фото/постеров вручную через админку — реализована и задеплоена
- Все pipeline скрипты в git

---

## Pipeline (конвейер обработки видео)

```
scrape → ai-process → visual-recognize → tmdb-enrich → watermark → cdn-upload → thumbnails → publish
```

Оркестратор: `run-pipeline.js` — два режима:
- **Conveyor (default)**: все шаги запускаются параллельно. Scrape, AI, watermark, publish — всё одновременно. Каждое видео проходит pipeline независимо. Как только скрапер закачал видео — AI сразу его подхватывает, пока остальные ещё качаются.
- **Sequential (`--sequential`)**: классический режим, шаги один за другим.

Конвейерная архитектура:
- `runOnceWorker()` — одноразовые шаги (scrape) работают параллельно с polling воркерами
- `runStepWorker()` — polling цикл: запуск скрипта → парсинг результата → sleep 10s → повтор
- Зависимости проверяются ТОЛЬКО при idle termination (не при запуске)
- Idle: 3 пустых poll подряд + все upstream deps завершены → воркер останавливается

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
| `progress.js` | Прогресс-трекинг: `initSteps()`, `writeProgress()`, `completeStep()`, `markStepDone()`, `writeStepStatus()`, `clearAllProgress()` |
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

### Зависимости шагов (conveyor mode)
```
scrape: []                          # нет зависимостей, одноразовый
ai-process: [scrape]                # ждёт пока scrape хотя бы начнёт
visual-recognize: [ai-process]      # ждёт AI
tmdb-enrich: [ai-process]           # ждёт AI
watermark: [ai-process]             # ждёт AI
thumbnails: [watermark]             # ждёт watermark
cdn-upload: [watermark, thumbnails] # ждёт обоих
publish: [cdn-upload]               # ждёт CDN upload
```

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
| `src/components/admin/PipelineControls.tsx` | Компонент UI pipeline (step panels, тайминги, completion state) |
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
2. **upload-to-cdn.js фильтр**: `WHERE thumbnail_url LIKE 'tmp/%'` может не подхватить видео с внешними URL.
3. **enrich-metadata.js gap**: Фильмы уже в БД с `tmdb_id IS NULL` не обогащаются при обычном pipeline. Нужен Step 3.
4. **Pipeline скрипты деплоятся вручную** — нет автоматической синхронизации git → Contabo.

### Решённые (04.03.2026)
1. Битые thumbnails видео — исправлено через re-upload с tmp-путями
2. Фото актрис и постеры фильмов не отображались на frontend — добавлен conditional rendering
3. Ложные связи от visual recognition — добавлены проверки confidence >= 0.7
4. Pipeline прогресс-бары показывали чушь — полная переработка progress.js + всех скриптов + фронтенда
5. `upload-to-cdn.js` crash (`videos is not defined`) — исправлена область видимости переменной
6. TMDB enrichment не обогащал существующие фильмы — запущен `--force`

---

## Pending задачи (не реализованы)
- [ ] Watermark: промежуточный прогресс (FFmpeg progress tracking, сейчас 0% или 100%)
- [ ] Pipeline ETA: прогнозирование времени на основе истории + размера файла
- [ ] Per-video total pipeline time summary log
- [ ] `enrich-metadata.js` Step 3: обогащение фильмов с `tmdb_id IS NULL`
- [ ] Автоматический деплой скриптов на Contabo (CI/CD или git hook)

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
