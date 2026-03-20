# CelebSkin — Задачи для выполнения
## Контекст проекта
- **Сайт:** celeb.skin — мультиязычный сайт обнажённых сцен знаменитостей
- **Языки:** 10 штук: en, ru, de, fr, es, pt, it, pl, nl, tr
- **Stack:** Next.js 14, TypeScript, PostgreSQL JSONB, Redis, BunnyCDN, Gemini 2.5 Flash
- **Проект на AbeloHost:** /opt/celebskin/
- **GitHub:** tarasshevchenko78/CelebSkin
- **PM2 процесс:** celebskin
- **Пайплайн скрипты на Contabo:** парсинг и AI обработка
## Пайплайн (порядок шагов)
1. Scraping (boobsradar) — парсинг контента
2. AI Processing (Gemini) — генерация тегов, описаний, названий по метаданным
3. 2b. Visual Recognition (Gemini Vision) — pending, ручной инструмент для сложных случаев, НЕ автоматический
4. TMDB Enrichment — обогащение данными из TMDB
5. Video Watermarking — наложение водяного знака
6. Thumbnail Generation — нарезка превью
## ВАЖНЫЕ ПРАВИЛА
- Sonnet промты: КОРОТКИЕ, один файл = одна задача
- НЕ менять AI модели без явного запроса
- Pipeline скрипты работают на Contabo, НЕ на AbeloHost
- video_url всегда NULL при Import — только download-and-process.js заполняет
- Gemini ответы требуют extractGeminiJSON из-за thinking tokens в parts[0]
---
## ✅ ВЫПОЛНЕНО
1. **Поиск по name_localized** — src/lib/db/search.ts — добавлены все 9 локалей (ru,de,fr,es,pt,it,pl,nl,tr) в GREATEST() и WHERE для celebrities и movies. PM2 перезапущен.
2. **Задачи 1+2: AI Vision + Hot Moments + Tag Taxonomy** — Gemini анализирует видео целиком через File API, определяет hot moments с таймстемпами, огоньки на шкале плеера, fallback на text-only при блокировке, upsert вместо INSERT, safety settings BLOCK_NONE.
3. **Задача 3: Slug 190→60** — toSlug() обрезает на 60 символов по целому слову.
---
## 📋 ОЧЕРЕДЬ ЗАДАЧ (в порядке приоритета)
### ЗАДАЧА 4 — Локализация UI
**Проблема:** части интерфейса захардкожены на английском.
**Файлы и что исправить:**
а) src/app/[locale]/celebrity/page.tsx — кнопки сортировки "Popular", "A-Z", "Most Videos" → перевести на язык текущей локали
б) src/app/[locale]/movie/page.tsx — "Most Scenes", "Latest", "A-Z" → перевести
в) src/app/[locale]/video/[slug]/page.tsx — sidebar: "More from", "Similar Scenes", "Review", breadcrumbs → перевести
г) src/app/[locale]/celebrity/[slug]/page.tsx — "Not found" → перевести
д) src/app/[locale]/movie/[slug]/page.tsx — "Not found" → перевести
**Как:** использовать существующую систему i18n проекта (найди как сделаны переводы в других компонентах и используй тот же подход)
---
### ЗАДАЧА 5 — Страница /about
**Файл:** создать src/app/[locale]/about/page.tsx
**Проблема:** Footer содержит ссылку на /{locale}/about, но страница не существует.
**Что сделать:** создать базовую страницу About с описанием сайта, мультиязычную.
---
### ЗАДАЧА 6 — Фото celebrities на CDN
**Проблема:** фото celebrities загружаются напрямую с image.tmdb.org. Нужно скачивать на BunnyCDN.
**Что сделать:** найти скрипт/функцию uploadCelebrityPhotos() и запустить для всех celebrities у которых фото ещё с TMDB.
---
## Конкуренты (для справки)
xcadr.online, nudecelebvideo.net, zorg.video, aznude.com, videocelebs.net, partycelebs.com, erotikkoleksiyon.com, celebritymovieblog.com, nudecelebrityblogs.net, celebsroulette.com, heroero.com, nudebase.com, celebjihad.com, erome.com, celebmasta.com, celebgate.org
