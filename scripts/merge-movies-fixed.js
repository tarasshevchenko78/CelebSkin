import dotenv from "dotenv";
dotenv.config();
import { query } from './lib/db.js';
import logger from './lib/logger.js';

async function mergeDuplicateMovies() {
    logger.info('Начинаем объединение дубликатов фильмов по tmdb_id...');

    // Найдём группы фильмов с одинаковым tmdb_id
    const { rows: groups } = await query(`
        SELECT tmdb_id, array_agg(id ORDER BY id) as ids
        FROM movies
        WHERE tmdb_id IS NOT NULL AND tmdb_id > 0
        GROUP BY tmdb_id
        HAVING COUNT(*) > 1
    `);

    logger.info(\`Найдено \${groups.length} фильмов-дубликатов\`);

    let mergedCount = 0;
    let deletedCount = 0;

    for (const group of groups) {
        // Оставим первый фильм (самый старый), остальные - на удаление
        const targetMovieId = group.ids[0];
        const moviesToDelete = group.ids.slice(1);

        logger.info(\`\nСлияние tmdb_id \${group.tmdb_id}. Оставляем id=\${targetMovieId}, удаляем \${moviesToDelete.join(', ')}\`);

        try {
            await query('BEGIN');

            for (const oldId of moviesToDelete) {
                // Перенести сцены (movie_scenes), игнорируя конфликты уникальности (ON CONFLICT DO NOTHING)
                const resScenes = await query(\`
                    INSERT INTO movie_scenes (movie_id, video_id, created_at)
                    SELECT $1, video_id, created_at
                    FROM movie_scenes
                    WHERE movie_id = $2
                    ON CONFLICT (movie_id, video_id) DO NOTHING
                \`, [targetMovieId, oldId]);

                // Удалить старые привязки
                await query('DELETE FROM movie_scenes WHERE movie_id = $1', [oldId]);

                // Перенести теги если есть связи (ON CONFLICT DO NOTHING)
                await query(\`
                    INSERT INTO movie_tags (movie_id, tag_id)
                    SELECT $1, tag_id FROM movie_tags WHERE movie_id = $2
                    ON CONFLICT DO NOTHING
                \`, [targetMovieId, oldId]);
                await query('DELETE FROM movie_tags WHERE movie_id = $1', [oldId]);

                // Перенести категории (ON CONFLICT DO NOTHING)
                await query(\`
                    INSERT INTO movie_categories (movie_id, category_id)
                    SELECT $1, category_id FROM movie_categories WHERE movie_id = $2
                    ON CONFLICT DO NOTHING
                \`, [targetMovieId, oldId]);
                await query('DELETE FROM movie_categories WHERE movie_id = $1', [oldId]);

                // Удалить сам фильм
                const resDel = await query('DELETE FROM movies WHERE id = $1', [oldId]);
                deletedCount += resDel.rowCount;
            }

            // Обновить scene_count у оставшегося фильма
            await query(\`
                UPDATE movies
                SET scene_count = (SELECT COUNT(*) FROM movie_scenes WHERE movie_id = $1)
                WHERE id = $1
            \`, [targetMovieId]);

            await query('COMMIT');
            mergedCount++;
            logger.info(\`  [OK] Успешно объединено\`);

        } catch (err) {
            await query('ROLLBACK');
            logger.error(\`  [ERROR] Ошибка слияния: \${err.message}\`);
        }
    }

    logger.info(\`\\nГотово! Групп слито: \${mergedCount}. Фильмов удалено: \${deletedCount}.\`);
    process.exit(0);
}

mergeDuplicateMovies().catch(console.error);
