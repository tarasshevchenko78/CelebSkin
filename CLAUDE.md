# CelebSkin — Контекст для Claude Code

## Проект
CelebSkin (celeb.skin) — мультиязычная платформа эротических сцен знаменитостей из фильмов/сериалов.

## Стек
- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS
- **DB**: PostgreSQL 16, Redis 7
- **AI**: Google Gemini (text + vision), TMDB API
- **CDN**: BunnyCDN (celebskin-cdn.b-cdn.net)
- **Локали**: en, de, es, fr, it, nl, pl, pt, ru, tr

## Серверы

| Сервер | IP | Роль | Доступ |
|--------|-----|------|--------|
| AbeloHost | 185.224.82.214 | Frontend + БД | Claude Code работает здесь |
| Contabo (DE) | 161.97.142.117 | Pipeline скрипты | `ssh root@161.97.142.117` |

## Рабочие директории
- **Сайт (AbeloHost)**: `/opt/celebskin/site/`
- **Pipeline скрипты (Contabo)**: `/opt/celebskin/scripts/`
- **Pipeline скрипты (в git)**: `scripts/` — зеркало Contabo, деплой вручную
- **PM2**: процесс `celebskin`, порт 3000

## Pipeline (конвейер обработки видео)
```
scrape → ai-process → visual-recognize → tmdb-enrich → watermark → cdn-upload → thumbnails → publish
```

### Скрипты pipeline (`scripts/`)
| Файл | Назначение |
|------|-----------|
| `scrape-boobsradar.js` | Парсинг видео с источников |
| `process-with-ai.js` | Gemini AI анализ (Level 1: текст, Level 2: visual) |
| `visual-recognize.js` | Отдельный visual recognition для low-confidence видео |
| `enrich-metadata.js` | TMDB обогащение (фото, постеры, биографии) |
| `watermark.js` | Наложение watermark celeb.skin |
| `upload-to-cdn.js` | Загрузка на BunnyCDN + обновление URL в БД |
| `generate-thumbnails.js` | Screenshots, sprite sheet, preview GIF |
| `publish-to-site.js` | Публикация + обновление счётчиков |
| `run-pipeline.js` | Оркестратор — запускает шаги последовательно |

### Библиотеки pipeline (`scripts/lib/`)
| Файл | Назначение |
|------|-----------|
| `visual-recognizer.js` | Gemini Vision API: 2-этапная стратегия (Flash → Pro) |
| `frame-extractor.js` | FFmpeg извлечение ключевых кадров |
| `db.js` | PostgreSQL подключение для pipeline |
| `logger.js` | Логирование в файл + консоль |
| `progress.js` | Прогресс-бар для pipeline UI |
| `catalog-matcher.js` | Матчинг по каталогам |

## Ключевые файлы фронтенда
| Файл | Назначение |
|------|-----------|
| `src/lib/db.ts` | Все SQL-запросы. `enrichVideoWithRelations()` подгружает celebrities (с photo_url), movie (с poster_url), tags |
| `src/lib/types.ts` | TypeScript интерфейсы |
| `src/app/[locale]/video/[slug]/page.tsx` | Страница видео |
| `src/app/[locale]/celebrity/[slug]/page.tsx` | Страница знаменитости + фильмография |
| `src/app/[locale]/movie/[slug]/page.tsx` | Страница фильма |
| `src/components/admin/PipelineControls.tsx` | UI управления конвейером |
| `src/app/api/admin/pipeline/route.ts` | API для pipeline actions |
| `src/app/admin/moderation/page.tsx` | Модерация unknown видео с вариантами от Gemini |
| `src/app/api/admin/moderation/route.ts` | API модерации (approve/reject/reanalyze) |

## База данных

### Основные таблицы
`videos`, `celebrities`, `movies`, `movie_scenes`, `video_celebrities`, `movie_celebrities`, `tags`, `video_tags`, `raw_videos`, `processing_log`

### Статусы видео
```
new → processing → enriched → auto_recognized → watermarked → published
Также: needs_review, unknown_with_suggestions, unknown, rejected, dmca_removed
```

### Колонки распознавания (videos)
- `recognition_data` JSONB — сырые результаты Gemini Vision
- `recognition_method` VARCHAR — 'metadata', 'visual', 'manual'
- `ai_confidence` FLOAT — общий confidence score (0.0–1.0)

## 3-уровневая архитектура распознавания
1. **Level 1**: Текстовые метаданные (filename, URL) → Gemini text → confidence
2. **Level 2**: Визуальное (Gemini Vision) — только если Level 1 confidence < 0.5
3. **Level 3**: Ручная модерация через админку

### Правила безопасности visual recognition
- `visual-recognize.js` НЕ создаёт связи в БД — только сохраняет recognition_data
- `process-with-ai.js` проверяет confidence >= 0.7 для каждого актёра и фильма
- Не перезаписывает уже определённые из метаданных данные
- Связи создаются только: process-with-ai.js (с проверками) или модератор (админка)

## Деплой
```bash
# Frontend (AbeloHost)
cd /opt/celebskin/site && npm run build && pm2 restart celebskin

# Pipeline скрипты (Contabo) — ручной деплой
scp scripts/*.js root@161.97.142.117:/opt/celebskin/scripts/
scp scripts/lib/*.js root@161.97.142.117:/opt/celebskin/scripts/lib/
```

## Текущее состояние (04.03.2026)
- **10 видео** published, все с CDN watermark + CDN thumbnails
- **13 celebrities** (12 с фото, Frances Raines без фото — нет в TMDB)
- **10 movies** (все с постерами)
- Pipeline скрипты в git (коммит 905ef75)

## Известные проблемы
1. **upload-to-cdn.js фильтр**: `WHERE thumbnail_url LIKE 'tmp/%'` может не подхватить видео с внешними URL. Рассмотреть расширение фильтра.
2. **Frances Raines** без фото — ожидаемо, TMDB не имеет данных.
3. **Pipeline скрипты деплоятся вручную** — нет автоматической синхронизации git → Contabo.

## История изменений

### 04.03.2026
- Реализован visual recognition pipeline (Gemini Vision + TMDB verification)
- Исправлено отображение фото актрис и постеров фильмов на frontend
- Исправлены ложные связи от visual recognition (проверки confidence)
- Перегенерированы thumbnails для видео с битыми превью
- Все pipeline скрипты добавлены в git
- TMDB enrichment для всех celebrities и movies
