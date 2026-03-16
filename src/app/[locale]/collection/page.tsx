import type { Metadata } from 'next';
import { getLocalizedField } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import { getFeaturedCollections, getTagCollections } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Collection } from '@/lib/types';

// ============================================
// i18n
// ============================================

const pageTitle: Record<string, string> = {
    en: 'Collections', ru: 'Коллекции', de: 'Sammlungen', fr: 'Collections',
    es: 'Colecciones', pt: 'Coleções', it: 'Collezioni',
    pl: 'Kolekcje', nl: 'Collecties', tr: 'Koleksiyonlar',
};

const featuredLabel: Record<string, string> = {
    en: 'Featured Collections', ru: 'Рекомендуемые', de: 'Empfohlene Sammlungen', fr: 'Collections en vedette',
    es: 'Colecciones destacadas', pt: 'Coleções em destaque', it: 'Collezioni in evidenza',
    pl: 'Polecane kolekcje', nl: 'Uitgelichte collecties', tr: 'Öne Çıkan Koleksiyonlar',
};

const byTagLabel: Record<string, string> = {
    en: 'Browse by Scene Type', ru: 'По типу сцены', de: 'Nach Szenentyp', fr: 'Par type de scène',
    es: 'Por tipo de escena', pt: 'Por tipo de cena', it: 'Per tipo di scena',
    pl: 'Według typu sceny', nl: 'Op scènetype', tr: 'Sahne türüne göre',
};

const videosWord: Record<string, string> = {
    en: 'videos', ru: 'видео', de: 'Videos', fr: 'vidéos',
    es: 'videos', pt: 'vídeos', it: 'video',
    pl: 'filmów', nl: "video's", tr: 'video',
};

const emptyLabel: Record<string, string> = {
    en: 'No collections available yet.', ru: 'Коллекций пока нет.', de: 'Noch keine Sammlungen verfügbar.',
    fr: 'Aucune collection disponible.', es: 'No hay colecciones disponibles todavía.',
    pt: 'Nenhuma coleção disponível ainda.', it: 'Nessuna collezione disponibile.',
    pl: 'Brak kolekcji.', nl: 'Nog geen collecties beschikbaar.', tr: 'Henüz koleksiyon yok.',
};

// ============================================
// Metadata
// ============================================

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale;
    const title = pageTitle[locale] || pageTitle.en;
    return {
        title: `${title} — CelebSkin`,
        alternates: buildAlternates(locale, '/collection'),
    };
}

// ============================================
// Collection card helper
// ============================================

function CollectionCard({ collection, locale }: { collection: Collection; locale: string }) {
    const title = getLocalizedField(collection.title, locale) || collection.slug;
    const description = getLocalizedField(collection.description, locale);

    return (
        <a
            href={`/${locale}/collection/${collection.slug}`}
            className="group relative rounded-xl overflow-hidden bg-gray-800/30 border border-gray-800 hover:border-gray-600 transition-all duration-300"
        >
            {/* Cover image or gradient placeholder */}
            <div className="aspect-[3/2] relative overflow-hidden">
                {collection.cover_url ? (
                    <img
                        src={collection.cover_url}
                        alt={title}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-red-900/30 to-gray-800 flex items-center justify-center">
                        <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                    </div>
                )}
                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                {/* Video count badge */}
                {collection.videos_count > 0 && (
                    <span className="absolute top-2 right-2 bg-black/70 text-white text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1"><svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg>
                        {collection.videos_count} {videosWord[locale] || videosWord.en}
                    </span>
                )}

                {/* Title on overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-3">
                    <h3 className="text-base font-semibold text-white line-clamp-1 group-hover:text-red-400 transition-colors">
                        {title}
                    </h3>
                </div>
            </div>

            {/* Description below image */}
            {description && (
                <div className="px-2 py-1.5">
                    <p className="text-xs text-gray-400 line-clamp-1">{description}</p>
                </div>
            )}
        </a>
    );
}

// ============================================
// Page
// ============================================

export default async function CollectionsPage({ params }: { params: { locale: string } }) {
    const locale = params.locale;

    let featured: Collection[] = [];
    let tagCollections: Collection[] = [];

    try {
        const [featuredResult, tagResult] = await Promise.all([
            getFeaturedCollections(6),
            getTagCollections(5),
        ]);
        featured = featuredResult;
        tagCollections = tagResult;
    } catch (error) {
        logger.error('Collections page error', { page: 'collections', error: error instanceof Error ? error.message : String(error) });
    }

    const hasContent = featured.length > 0 || tagCollections.length > 0;

    return (
        <div className="mx-auto max-w-[1600px] px-4 py-4 md:py-5">
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-4">
                {pageTitle[locale] || pageTitle.en}
            </h1>

            {/* Featured collections — large cards */}
            {featured.length > 0 && (
                <section className="mb-5">
                    <h2 className="text-lg font-semibold text-white mb-3">
                        {featuredLabel[locale] || featuredLabel.en}
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {featured.map((c) => (
                            <CollectionCard key={c.id} collection={c} locale={locale} />
                        ))}
                    </div>
                </section>
            )}

            {/* Tag-based collections — sorted by video count */}
            {tagCollections.length > 0 && (
                <section>
                    <h2 className="text-lg font-semibold text-white mb-3">
                        {byTagLabel[locale] || byTagLabel.en}
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {tagCollections.map((c) => (
                            <CollectionCard key={c.id} collection={c} locale={locale} />
                        ))}
                    </div>
                </section>
            )}

            {/* Empty state */}
            {!hasContent && (
                <p className="text-center text-gray-500 py-16">
                    {emptyLabel[locale] || emptyLabel.en}
                </p>
            )}
        </div>
    );
}
