/**
 * catalog-matcher.js — AI-поиск и сопоставление актрис и фильмов.
 *
 * КАК РАБОТАЕТ ПОИСК:
 *
 * 1. ПАРСИНГ ЗАГОЛОВКА (parseTitle в адаптере):
 *    - Извлекает имена актрис по паттернам: "Kate Winslet nude" → "Kate Winslet"
 *    - Извлекает название фильма: "Ammonite (2020)" → "Ammonite", 2020
 *
 * 2. FUZZY MATCHING В БД (pg_trgm):
 *    - Ищет похожие имена среди существующих актрис (similarity > 0.3)
 *    - Учитывает алиасы: "Scarlett Johansson" = "ScarJo"
 *    - Ищет фильмы по похожему названию + год
 *
 * 3. GEMINI AI АНАЛИЗ:
 *    - AI получает: raw_title, description, tags, celebrities из парсера
 *    - AI определяет: точные имена актрис, правильное название фильма, год
 *    - AI возвращает уверенность (confidence) для каждого матча
 *
 * 4. АВТОСОЗДАНИЕ ИЛИ ПРИВЯЗКА:
 *    - Если найден матч в каталоге (similarity > 0.7) → привязка к существующей записи
 *    - Если матч не найден → создаётся новая запись в каталоге
 *    - Обновляются счётчики (video_count, scene_count)
 *
 * КАК ВНОСЯТСЯ ДАННЫЕ:
 *
 * A) Автоматически при парсинге:
 *    - Адаптер извлекает raw-данные из HTML (title, flashvars, meta)
 *    - AI обогащает и нормализует (Gemini)
 *    - Каталог обновляется автоматически
 *
 * B) Через панель управления (ручное управление):
 *    - Каталог фильмов: список, постеры, привязки к сценам
 *    - Каталог актрис: список, фото, привязки к роликам
 *    - Поиск и фильтрация по имени/названию
 */

import slugify from 'slugify';
import {
  searchCelebrityFuzzy, searchMovieFuzzy,
  findOrCreateCelebrity, findOrCreateMovie,
  linkVideoCelebrity, linkMovieScene, linkMovieCelebrity,
  addActressPhoto, updateActress,
} from './db.js';

/**
 * Сопоставить имя актрисы с каталогом.
 *
 * Алгоритм:
 * 1. Нормализуем имя (trim, capitalize)
 * 2. Fuzzy search по pg_trgm (similarity > 0.3)
 * 3. Если высокий матч (> 0.7) → используем существующую запись
 * 4. Если нет → создаём новую запись
 *
 * @param {string} name - имя актрисы (из AI или парсера)
 * @param {object} extraData - доп. данные { photo_url, bio, aliases }
 * @returns {{ celebrityId: number, isNew: boolean, matchScore: number }}
 */
export async function matchActress(name, extraData = {}) {
  const normalized = normalizeName(name);
  if (!normalized || normalized.length < 2) return null;

  const slug = makeSlug(normalized);

  // Шаг 1: Fuzzy поиск в каталоге
  const matches = await searchCelebrityFuzzy(normalized, 0.3);

  if (matches.length > 0 && matches[0].sim > 0.7) {
    // Высокое совпадение — привязываем к существующей записи
    const existing = matches[0];

    // Обновляем данные если есть новые
    if (extraData.photo_url || extraData.bio) {
      await updateActress(existing.id, {
        photo_url: extraData.photo_url,
        bio: extraData.bio,
      });
    }

    return {
      celebrityId: existing.id,
      name: existing.name,
      isNew: false,
      matchScore: existing.sim,
    };
  }

  // Шаг 2: Нет матча — создаём новую запись
  const celebrityId = await findOrCreateCelebrity(normalized, slug);

  // Добавляем доп. данные
  if (extraData.photo_url) {
    await addActressPhoto(celebrityId, extraData.photo_url, null, true, 'ai');
    await updateActress(celebrityId, { photo_url: extraData.photo_url });
  }
  if (extraData.aliases?.length) {
    await updateActress(celebrityId, { aliases: extraData.aliases });
  }

  return {
    celebrityId,
    name: normalized,
    isNew: true,
    matchScore: 0,
  };
}

/**
 * Сопоставить фильм с каталогом.
 *
 * Алгоритм:
 * 1. Fuzzy search по названию + фильтр по году (если задан)
 * 2. Если матч > 0.7 → существующая запись
 * 3. Если нет → создаём
 * 4. Привязываем видео как сцену фильма
 *
 * @param {string} title - название фильма
 * @param {object} data - { year, title_ru, poster_url, studio, director }
 * @returns {{ movieId: number, isNew: boolean, matchScore: number }}
 */
export async function matchMovie(title, data = {}) {
  const normalized = title?.trim();
  if (!normalized || normalized.length < 2) return null;

  const slug = makeSlug(normalized + (data.year ? `-${data.year}` : ''));

  // Шаг 1: Fuzzy поиск
  const matches = await searchMovieFuzzy(normalized, 0.3);

  // Если есть год — ищем точное совпадение с годом
  if (data.year && matches.length > 0) {
    const exactYearMatch = matches.find(m => m.year === data.year && m.sim > 0.6);
    if (exactYearMatch) {
      return {
        movieId: exactYearMatch.id,
        title: exactYearMatch.title,
        isNew: false,
        matchScore: exactYearMatch.sim,
      };
    }
  }

  if (matches.length > 0 && matches[0].sim > 0.7) {
    return {
      movieId: matches[0].id,
      title: matches[0].title,
      isNew: false,
      matchScore: matches[0].sim,
    };
  }

  // Шаг 2: Создаём новый фильм
  const movieId = await findOrCreateMovie({
    title: normalized,
    title_ru: data.title_ru || null,
    slug,
    year: data.year || null,
    poster_url: data.poster_url || null,
    description: data.description || null,
    studio: data.studio || null,
    director: data.director || null,
    genres: data.genres || [],
    ai_matched: true,
  });

  return {
    movieId,
    title: normalized,
    isNew: true,
    matchScore: 0,
  };
}

/**
 * Полный матчинг видео → каталоги.
 *
 * Вызывается после AI-обработки. Принимает результат Gemini и привязывает
 * видео к каталогам актрис и фильмов.
 *
 * @param {string} processedVideoId - UUID обработанного видео
 * @param {object} aiResult - результат Gemini AI
 * @param {object} rawData - сырые данные парсера
 * @returns {{ celebrities: Array, movie: object|null }}
 */
export async function matchVideoToCatalogs(processedVideoId, aiResult, rawData = {}) {
  const result = { celebrities: [], movie: null };

  // === АКТРИСЫ ===
  const celebrityNames = aiResult.celebrities || rawData.raw_celebrities || [];
  for (const name of celebrityNames) {
    const match = await matchActress(name, {
      photo_url: null, // будет заполнено при скрейпинге фото
    });
    if (match) {
      await linkVideoCelebrity(processedVideoId, match.celebrityId);
      result.celebrities.push(match);
    }
  }

  // === ФИЛЬМ ===
  const movieTitle = aiResult.movie_title || aiResult.original_title || rawData.movie_title;
  if (movieTitle) {
    const movieMatch = await matchMovie(movieTitle, {
      year: aiResult.year || rawData.year || null,
      title_ru: aiResult.movie_title_ru || null,
      studio: aiResult.studio || null,
    });

    if (movieMatch) {
      // Привязываем видео как сцену фильма
      await linkMovieScene(movieMatch.movieId, processedVideoId);

      // Привязываем актрис к фильму
      for (const celebrity of result.celebrities) {
        await linkMovieCelebrity(movieMatch.movieId, celebrity.celebrityId);
      }

      result.movie = movieMatch;
    }
  }

  return result;
}

// ============================================
// Утилиты
// ============================================

function normalizeName(name) {
  if (!name) return '';
  return name
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function makeSlug(text) {
  return slugify(text, { lower: true, strict: true, locale: 'en' });
}
