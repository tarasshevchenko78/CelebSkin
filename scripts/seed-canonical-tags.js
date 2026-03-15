#!/usr/bin/env node
/**
 * seed-canonical-tags.js — Seed 34 canonical tags with 10-locale translations
 * Idempotent: upserts by slug, promotes existing tags to canonical
 *
 * Usage: node seed-canonical-tags.js
 */

import { query, pool } from './lib/db.js';

const CANONICAL_TAGS = [
  // ═══════════════════════════════════════════
  // NUDITY LEVEL
  // ═══════════════════════════════════════════
  {
    slug: 'topless', group: 'nudity_level', sort: 1,
    name: 'Topless',
    loc: { en: 'Topless', ru: 'Топлес', de: 'Oben ohne', fr: 'Seins nus', es: 'Topless', pt: 'Topless', it: 'Topless', pl: 'Topless', nl: 'Topless', tr: 'Üstsüz' }
  },
  {
    slug: 'full-frontal', group: 'nudity_level', sort: 2,
    name: 'Full Frontal',
    loc: { en: 'Full Frontal', ru: 'Полная обнажёнка', de: 'Voll frontal', fr: 'Nu intégral', es: 'Desnudo frontal', pt: 'Nu frontal', it: 'Nudo frontale', pl: 'Pełny frontal', nl: 'Volledig frontaal', tr: 'Tam çıplak' }
  },
  {
    slug: 'butt', group: 'nudity_level', sort: 3,
    name: 'Butt',
    loc: { en: 'Butt', ru: 'Ягодицы', de: 'Po', fr: 'Fesses', es: 'Trasero', pt: 'Bumbum', it: 'Sedere', pl: 'Pośladki', nl: 'Billen', tr: 'Kalça' }
  },
  {
    slug: 'pussy', group: 'nudity_level', sort: 4,
    name: 'Pussy',
    loc: { en: 'Pussy', ru: 'Вагина', de: 'Muschi', fr: 'Chatte', es: 'Coño', pt: 'Buceta', it: 'Figa', pl: 'Cipka', nl: 'Kutje', tr: 'Am' }
  },
  {
    slug: 'bush', group: 'nudity_level', sort: 5,
    name: 'Bush',
    loc: { en: 'Bush', ru: 'Волосы на лобке', de: 'Schamhaar', fr: 'Toison pubienne', es: 'Vello púbico', pt: 'Pelos pubianos', it: 'Pelo pubico', pl: 'Owłosienie łonowe', nl: 'Schaamhaar', tr: 'Kasık kılı' }
  },
  {
    slug: 'nude', group: 'nudity_level', sort: 6,
    name: 'Nude',
    loc: { en: 'Nude', ru: 'Обнажённая', de: 'Nackt', fr: 'Nue', es: 'Desnuda', pt: 'Nua', it: 'Nuda', pl: 'Naga', nl: 'Naakt', tr: 'Çıplak' }
  },
  {
    slug: 'sideboob', group: 'nudity_level', sort: 7,
    name: 'Sideboob',
    loc: { en: 'Sideboob', ru: 'Вид сбоку', de: 'Seitliche Brust', fr: 'Sein de côté', es: 'Pecho lateral', pt: 'Seio lateral', it: 'Seno laterale', pl: 'Boczny biust', nl: 'Zijborst', tr: 'Yan göğüs' }
  },
  {
    slug: 'see-through', group: 'nudity_level', sort: 8,
    name: 'See-Through',
    loc: { en: 'See-Through', ru: 'Просвечивает', de: 'Durchsichtig', fr: 'Transparent', es: 'Transparente', pt: 'Transparente', it: 'Trasparente', pl: 'Prześwitujące', nl: 'Doorzichtig', tr: 'Şeffaf' }
  },
  {
    slug: 'implied-nudity', group: 'nudity_level', sort: 9,
    name: 'Implied Nudity',
    loc: { en: 'Implied Nudity', ru: 'Подразумеваемая нагота', de: 'Angedeutete Nacktheit', fr: 'Nudité implicite', es: 'Desnudez implícita', pt: 'Nudez implícita', it: 'Nudità implicita', pl: 'Domyślna nagość', nl: 'Gesuggereerde naaktheid', tr: 'Üstü kapalı çıplaklık' }
  },
  {
    slug: 'cleavage', group: 'nudity_level', sort: 10,
    name: 'Cleavage',
    loc: { en: 'Cleavage', ru: 'Декольте', de: 'Dekolleté', fr: 'Décolleté', es: 'Escote', pt: 'Decote', it: 'Scollatura', pl: 'Dekolt', nl: 'Decolleté', tr: 'Göğüs dekoltesi' }
  },

  // ═══════════════════════════════════════════
  // SCENE TYPE
  // ═══════════════════════════════════════════
  {
    slug: 'sex-scene', group: 'scene_type', sort: 1,
    name: 'Sex Scene',
    loc: { en: 'Sex Scene', ru: 'Секс сцена', de: 'Sexszene', fr: 'Scène de sexe', es: 'Escena de sexo', pt: 'Cena de sexo', it: 'Scena di sesso', pl: 'Scena seksu', nl: 'Seksscène', tr: 'Seks sahnesi' }
  },
  {
    slug: 'explicit', group: 'scene_type', sort: 2,
    name: 'Explicit',
    loc: { en: 'Explicit', ru: 'Откровенная', de: 'Explizit', fr: 'Explicite', es: 'Explícita', pt: 'Explícita', it: 'Esplicita', pl: 'Dosadna', nl: 'Expliciet', tr: 'Açık saçık' }
  },
  {
    slug: 'mainstream', group: 'scene_type', sort: 3,
    name: 'Mainstream',
    loc: { en: 'Mainstream', ru: 'Мейнстрим', de: 'Mainstream', fr: 'Mainstream', es: 'Mainstream', pt: 'Mainstream', it: 'Mainstream', pl: 'Mainstream', nl: 'Mainstream', tr: 'Ana akım' }
  },
  {
    slug: 'blowjob', group: 'scene_type', sort: 4,
    name: 'Blowjob',
    loc: { en: 'Blowjob', ru: 'Минет', de: 'Blowjob', fr: 'Fellation', es: 'Mamada', pt: 'Boquete', it: 'Pompino', pl: 'Lodzik', nl: 'Pijpbeurt', tr: 'Oral seks' }
  },
  {
    slug: 'cunnilingus', group: 'scene_type', sort: 5,
    name: 'Cunnilingus',
    loc: { en: 'Cunnilingus', ru: 'Куннилингус', de: 'Cunnilingus', fr: 'Cunnilingus', es: 'Cunnilingus', pt: 'Cunilíngua', it: 'Cunnilingus', pl: 'Cunnilingus', nl: 'Cunnilingus', tr: 'Cunnilingus' }
  },
  {
    slug: 'lesbian', group: 'scene_type', sort: 6,
    name: 'Lesbian',
    loc: { en: 'Lesbian', ru: 'Лесбийская сцена', de: 'Lesbisch', fr: 'Lesbienne', es: 'Lesbiana', pt: 'Lésbica', it: 'Lesbica', pl: 'Lesbijka', nl: 'Lesbisch', tr: 'Lezbiyen' }
  },
  {
    slug: 'masturbation', group: 'scene_type', sort: 7,
    name: 'Masturbation',
    loc: { en: 'Masturbation', ru: 'Мастурбация', de: 'Masturbation', fr: 'Masturbation', es: 'Masturbación', pt: 'Masturbação', it: 'Masturbazione', pl: 'Masturbacja', nl: 'Masturbatie', tr: 'Mastürbasyon' }
  },
  {
    slug: 'striptease', group: 'scene_type', sort: 8,
    name: 'Striptease',
    loc: { en: 'Striptease', ru: 'Стриптиз', de: 'Striptease', fr: 'Striptease', es: 'Striptease', pt: 'Striptease', it: 'Striptease', pl: 'Striptiz', nl: 'Striptease', tr: 'Striptiz' }
  },
  {
    slug: 'threesome', group: 'scene_type', sort: 9,
    name: 'Threesome',
    loc: { en: 'Threesome', ru: 'Тройка', de: 'Dreier', fr: 'Plan à trois', es: 'Trío', pt: 'Ménage à trois', it: 'Triangolo', pl: 'Trójkąt', nl: 'Trio', tr: 'Üçlü' }
  },
  {
    slug: 'group-sex', group: 'scene_type', sort: 10,
    name: 'Group Sex',
    loc: { en: 'Group Sex', ru: 'Групповой секс', de: 'Gruppensex', fr: 'Sexe en groupe', es: 'Sexo grupal', pt: 'Sexo em grupo', it: 'Sesso di gruppo', pl: 'Seks grupowy', nl: 'Groepsseks', tr: 'Grup seks' }
  },
  {
    slug: 'bdsm', group: 'scene_type', sort: 11,
    name: 'BDSM',
    loc: { en: 'BDSM', ru: 'БДСМ', de: 'BDSM', fr: 'BDSM', es: 'BDSM', pt: 'BDSM', it: 'BDSM', pl: 'BDSM', nl: 'BDSM', tr: 'BDSM' }
  },
  {
    slug: 'romantic', group: 'scene_type', sort: 12,
    name: 'Romantic',
    loc: { en: 'Romantic', ru: 'Романтическая', de: 'Romantisch', fr: 'Romantique', es: 'Romántica', pt: 'Romântica', it: 'Romantica', pl: 'Romantyczna', nl: 'Romantisch', tr: 'Romantik' }
  },
  {
    slug: 'rape-scene', group: 'scene_type', sort: 13,
    name: 'Rape Scene',
    loc: { en: 'Rape Scene', ru: 'Сцена насилия', de: 'Vergewaltigungsszene', fr: 'Scène de viol', es: 'Escena de violación', pt: 'Cena de estupro', it: 'Scena di stupro', pl: 'Scena gwałtu', nl: 'Verkrachtingsscène', tr: 'Tecavüz sahnesi' }
  },

  // ═══════════════════════════════════════════
  // SETTING
  // ═══════════════════════════════════════════
  {
    slug: 'shower', group: 'setting', sort: 1,
    name: 'Shower',
    loc: { en: 'Shower', ru: 'Душ', de: 'Dusche', fr: 'Douche', es: 'Ducha', pt: 'Chuveiro', it: 'Doccia', pl: 'Prysznic', nl: 'Douche', tr: 'Duş' }
  },
  {
    slug: 'bath', group: 'setting', sort: 2,
    name: 'Bath',
    loc: { en: 'Bath', ru: 'Ванна', de: 'Bad', fr: 'Bain', es: 'Baño', pt: 'Banho', it: 'Bagno', pl: 'Kąpiel', nl: 'Bad', tr: 'Banyo' }
  },
  {
    slug: 'pool', group: 'setting', sort: 3,
    name: 'Pool',
    loc: { en: 'Pool', ru: 'Бассейн', de: 'Pool', fr: 'Piscine', es: 'Piscina', pt: 'Piscina', it: 'Piscina', pl: 'Basen', nl: 'Zwembad', tr: 'Havuz' }
  },
  {
    slug: 'beach', group: 'setting', sort: 4,
    name: 'Beach',
    loc: { en: 'Beach', ru: 'Пляж', de: 'Strand', fr: 'Plage', es: 'Playa', pt: 'Praia', it: 'Spiaggia', pl: 'Plaża', nl: 'Strand', tr: 'Plaj' }
  },
  {
    slug: 'bed-scene', group: 'setting', sort: 5,
    name: 'Bed Scene',
    loc: { en: 'Bed Scene', ru: 'Постельная сцена', de: 'Bettszene', fr: 'Scène au lit', es: 'Escena en la cama', pt: 'Cena na cama', it: 'Scena a letto', pl: 'Scena łóżkowa', nl: 'Bedscène', tr: 'Yatak sahnesi' }
  },
  {
    slug: 'outdoor', group: 'setting', sort: 6,
    name: 'Outdoor',
    loc: { en: 'Outdoor', ru: 'На природе', de: 'Im Freien', fr: 'En plein air', es: 'Al aire libre', pt: 'Ao ar livre', it: "All'aperto", pl: 'Na zewnątrz', nl: 'Buiten', tr: 'Açık hava' }
  },

  // ═══════════════════════════════════════════
  // SOURCE TYPE
  // ═══════════════════════════════════════════
  {
    slug: 'movie', group: 'source_type', sort: 1,
    name: 'Movie',
    loc: { en: 'Movie', ru: 'Фильм', de: 'Film', fr: 'Film', es: 'Película', pt: 'Filme', it: 'Film', pl: 'Film', nl: 'Film', tr: 'Film' }
  },
  {
    slug: 'tv-series', group: 'source_type', sort: 2,
    name: 'TV Series',
    loc: { en: 'TV Series', ru: 'Сериал', de: 'TV-Serie', fr: 'Série TV', es: 'Serie de TV', pt: 'Série de TV', it: 'Serie TV', pl: 'Serial TV', nl: 'TV-serie', tr: 'TV Dizisi' }
  },
  {
    slug: 'photoshoot', group: 'source_type', sort: 3,
    name: 'Photoshoot',
    loc: { en: 'Photoshoot', ru: 'Фотосессия', de: 'Fotoshooting', fr: 'Séance photo', es: 'Sesión de fotos', pt: 'Ensaio fotográfico', it: 'Servizio fotografico', pl: 'Sesja zdjęciowa', nl: 'Fotoshoot', tr: 'Fotoğraf çekimi' }
  },

  // ═══════════════════════════════════════════
  // BODY
  // ═══════════════════════════════════════════
  {
    slug: 'pregnant', group: 'body', sort: 1,
    name: 'Pregnant',
    loc: { en: 'Pregnant', ru: 'Беременная', de: 'Schwanger', fr: 'Enceinte', es: 'Embarazada', pt: 'Grávida', it: 'Incinta', pl: 'W ciąży', nl: 'Zwanger', tr: 'Hamile' }
  },
  {
    slug: 'tattoo', group: 'body', sort: 2,
    name: 'Tattoo',
    loc: { en: 'Tattoo', ru: 'Татуировка', de: 'Tattoo', fr: 'Tatouage', es: 'Tatuaje', pt: 'Tatuagem', it: 'Tatuaggio', pl: 'Tatuaż', nl: 'Tattoo', tr: 'Dövme' }
  },
];

async function main() {
  console.log(`Seeding ${CANONICAL_TAGS.length} canonical tags...`);

  let created = 0, updated = 0;

  for (const tag of CANONICAL_TAGS) {
    const result = await query(
      `INSERT INTO tags (name, slug, name_localized, is_canonical, tag_group, sort_order)
       VALUES ($1, $2, $3::jsonb, true, $4, $5)
       ON CONFLICT (slug) DO UPDATE SET
         is_canonical = true,
         tag_group = EXCLUDED.tag_group,
         sort_order = EXCLUDED.sort_order,
         name_localized = EXCLUDED.name_localized,
         name = EXCLUDED.name
       RETURNING (xmax = 0) AS inserted`,
      [tag.name, tag.slug, JSON.stringify(tag.loc), tag.group, tag.sort]
    );

    if (result.rows[0]?.inserted) {
      created++;
      console.log(`  + ${tag.slug} (${tag.group})`);
    } else {
      updated++;
      console.log(`  ~ ${tag.slug} (${tag.group}) — promoted to canonical`);
    }
  }

  console.log(`\nDone: ${created} created, ${updated} updated`);

  // Summary by group
  const groups = await query(
    `SELECT tag_group, COUNT(*) as cnt FROM tags WHERE is_canonical = true GROUP BY tag_group ORDER BY tag_group`
  );
  console.log('\nCanonical tags by group:');
  for (const g of groups.rows) {
    console.log(`  ${g.tag_group}: ${g.cnt}`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
