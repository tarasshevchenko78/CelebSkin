import type { Metadata } from 'next';
import { getLocalizedField } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import { getCollections, getFeaturedCollections } from '@/lib/db';
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

const allLabel: Record<string, string> = {
    en: 'All Collections', ru: 'Все коллекции', de: 'Alle Sammlungen', fr: 'Toutes les collections',
    es: 'Todas las colecciones', pt: 'Todas as coleções', it: 'Tutte le collezioni',
    pl: 'Wszystkie kolekcje', nl: 'Alle collecties', tr: 'Tüm Koleksiyonlar',
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
            <div className="aspect-[16/9] relative overflow-hidden">
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
                    <span className="absolute top-2 right-2 bg-black/70 text-white text-xs font-medium px-2 py-0.5 rounded-full">
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
                <div className="px-3 py-2">
                    <p className="text-xs text-gray-400 line-clamp-2">{description}</p>
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
    let allCollections: Collection[] = [];

    try {
        const [featuredResult, allResult] = await Promise.all([
            getFeaturedCollections(6),
            getCollections(1, 50),
        ]);
        featured = featuredResult;
        allCollections = allResult.data;
    } catch (error) {
        logger.error('Collections page error', { page: 'collections', error: error instanceof Error ? error.message : String(error) });
    }

    // Non-featured collections (exclude featured from "All" to avoid duplicates)
    const featuredIds = new Set(featured.map(c => c.id));
    const nonFeatured = allCollections.filter(c => !featuredIds.has(c.id));

    const hasContent = featured.length > 0 || nonFeatured.length > 0;

    return (
        <div className="mx-auto max-w-[1600px] px-4 py-6 md:py-8">
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-6">
                {pageTitle[locale] || pageTitle.en}
            </h1>

            {/* Featured collections — large cards */}
            {featured.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-lg font-semibold text-white mb-4">
                        {featuredLabel[locale] || featuredLabel.en}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {featured.map((c) => (
                            <CollectionCard key={c.id} collection={c} locale={locale} />
                        ))}
                    </div>
                </section>
            )}

            {/* All other collections */}
            {nonFeatured.length > 0 && (
                <section>
                    {featured.length > 0 && (
                        <h2 className="text-lg font-semibold text-white mb-4">
                            {allLabel[locale] || allLabel.en}
                        </h2>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {nonFeatured.map((c) => (
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
