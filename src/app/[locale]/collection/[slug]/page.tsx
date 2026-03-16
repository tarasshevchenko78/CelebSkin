import type { Metadata } from 'next';
import { getLocalizedField, sceneLabel } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import { getCollectionBySlug, getVideosForCollection } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Video } from '@/lib/types';
import VideoCard from '@/components/VideoCard';
import JsonLd from '@/components/JsonLd';
import ExpandableText from '@/components/ExpandableText';

// ============================================
// i18n
// ============================================


const notFoundLabels: Record<string, string> = {
    en: 'Collection not found', ru: 'Коллекция не найдена', de: 'Sammlung nicht gefunden',
    fr: 'Collection introuvable', es: 'Colección no encontrada', pt: 'Coleção não encontrada',
    it: 'Collezione non trovata', pl: 'Kolekcja nie znaleziona', nl: 'Collectie niet gevonden',
    tr: 'Koleksiyon bulunamadı',
};

const backLabel: Record<string, string> = {
    en: '← All Collections', ru: '← Все коллекции', de: '← Alle Sammlungen',
    fr: '← Toutes les collections', es: '← Todas las colecciones', pt: '← Todas as coleções',
    it: '← Tutte le collezioni', pl: '← Wszystkie kolekcje', nl: '← Alle collecties',
    tr: '← Tüm Koleksiyonlar',
};

const emptyLabel: Record<string, string> = {
    en: 'No videos in this collection yet.', ru: 'В этой коллекции пока нет видео.',
    de: 'Noch keine Videos in dieser Sammlung.', fr: 'Aucune vidéo dans cette collection.',
    es: 'No hay videos en esta colección todavía.', pt: 'Nenhum vídeo nesta coleção ainda.',
    it: 'Nessun video in questa collezione.', pl: 'Brak filmów w tej kolekcji.',
    nl: "Nog geen video's in deze collectie.", tr: 'Bu koleksiyonda henüz video yok.',
};

// ============================================
// Metadata
// ============================================

export async function generateMetadata({ params }: { params: { locale: string; slug: string } }): Promise<Metadata> {
    let collection;
    try {
        collection = await getCollectionBySlug(params.slug);
    } catch (error) {
        logger.error('Collection metadata DB error', { page: 'collection/detail', error: error instanceof Error ? error.message : String(error) });
    }
    const title = collection ? getLocalizedField(collection.title, params.locale) || params.slug : 'Collection';
    const description = collection ? getLocalizedField(collection.description, params.locale) : undefined;
    return {
        title: `${title} — CelebSkin`,
        ...(description && { description }),
        alternates: buildAlternates(params.locale, `/collection/${params.slug}`),
    };
}

// ============================================
// Page
// ============================================

export default async function CollectionDetailPage({ params }: { params: { locale: string; slug: string } }) {
    const locale = params.locale;

    let collection;
    try {
        collection = await getCollectionBySlug(params.slug);
    } catch (error) {
        logger.error('Collection DB error', { page: 'collection/detail', error: error instanceof Error ? error.message : String(error) });
    }

    if (!collection) {
        return (
            <div className="mx-auto max-w-[1600px] px-4 py-20 text-center">
                <h1 className="text-2xl font-bold text-white mb-4">{notFoundLabels[locale] || notFoundLabels.en}</h1>
                <a href={`/${locale}/collection`} className="text-red-400 hover:text-red-300 transition-colors">
                    {backLabel[locale] || backLabel.en}
                </a>
            </div>
        );
    }

    const title = getLocalizedField(collection.title, locale) || collection.slug;
    const description = getLocalizedField(collection.description, locale);

    let videos: Video[] = [];
    let totalVideos = 0;
    try {
        const result = await getVideosForCollection(collection.id, 1, 100);
        videos = result.data;
        totalVideos = result.total;
    } catch (error) {
        logger.error('Collection videos error', { page: 'collection/detail', error: error instanceof Error ? error.message : String(error) });
    }

    // JSON-LD: ItemList
    const collectionLd = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: title,
        url: `https://celeb.skin/${locale}/collection/${collection.slug}`,
        ...(description && { description }),
        ...(collection.cover_url && { image: collection.cover_url }),
        ...(videos.length > 0 && {
            mainEntity: {
                '@type': 'ItemList',
                numberOfItems: totalVideos,
                itemListElement: videos.slice(0, 10).map((v, i) => ({
                    '@type': 'ListItem',
                    position: i + 1,
                    url: `https://celeb.skin/${locale}/video/${getLocalizedField(v.slug, locale) || getLocalizedField(v.slug, 'en')}`,
                })),
            },
        }),
    };

    return (
        <div className="mx-auto max-w-[1600px] px-4 py-4 md:py-6">
            <JsonLd data={collectionLd} />

            {/* Breadcrumb */}
            <a
                href={`/${locale}/collection`}
                className="inline-block text-sm text-gray-500 hover:text-gray-300 transition-colors mb-4"
            >
                {backLabel[locale] || backLabel.en}
            </a>

            {/* ── HERO ── */}
            {collection.cover_url ? (
                <div className="relative w-full h-48 sm:h-64 lg:h-72 rounded-2xl overflow-hidden mb-6">
                    <img
                        src={collection.cover_url}
                        alt={title}
                        className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                    <div className="absolute bottom-4 left-5 right-5">
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white drop-shadow-lg">{title}</h1>
                        {totalVideos > 0 && (
                            <p className="text-sm text-gray-300 mt-1">
                                {totalVideos} {sceneLabel(totalVideos, locale)}
                            </p>
                        )}
                    </div>
                </div>
            ) : (
                <div className="mb-6">
                    <h1 className="text-2xl sm:text-3xl font-bold text-white">{title}</h1>
                    {totalVideos > 0 && (
                        <p className="text-sm text-gray-400 mt-1">
                            {totalVideos} {sceneLabel(totalVideos, locale)}
                        </p>
                    )}
                </div>
            )}

            {/* Description */}
            {description && (
                <div className="max-w-3xl mb-6">
                    <ExpandableText text={description} />
                </div>
            )}

            {/* ── VIDEO GRID ── */}
            {videos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {videos.map((video) => (
                        <VideoCard key={video.id} video={video} locale={locale} />
                    ))}
                </div>
            ) : (
                <p className="text-center text-gray-500 py-16">
                    {emptyLabel[locale] || emptyLabel.en}
                </p>
            )}
        </div>
    );
}
