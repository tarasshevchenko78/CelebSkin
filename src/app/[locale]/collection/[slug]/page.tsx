import type { Metadata } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/i18n';
import { getLocalizedField } from '@/lib/i18n';
import { getCollectionBySlug, getVideosForCollection } from '@/lib/db';
import type { Video } from '@/lib/types';
import VideoCard from '@/components/VideoCard';

export async function generateMetadata({ params }: { params: { locale: string; slug: string } }): Promise<Metadata> {
    let collection;
    try {
        collection = await getCollectionBySlug(params.slug);
    } catch (error) {
        console.error('[CollectionDetail] metadata DB error:', error);
    }
    const title = collection ? getLocalizedField(collection.title, params.locale) || params.slug : 'Collection';
    return {
        title: `${title} — CelebSkin`,
        alternates: { languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}/collection/${params.slug}`])) },
    };
}

export default async function CollectionDetailPage({ params }: { params: { locale: string; slug: string } }) {
    const locale = params.locale;

    let collection;
    try {
        collection = await getCollectionBySlug(params.slug);
    } catch (error) {
        console.error('[CollectionDetail] DB error:', error);
    }

    if (!collection) {
        const notFoundLabels: Record<string, string> = {
            en: 'Collection not found', ru: 'Коллекция не найдена', de: 'Sammlung nicht gefunden',
            fr: 'Collection introuvable', es: 'Colección no encontrada', pt: 'Coleção não encontrada',
            it: 'Collezione non trovata', pl: 'Kolekcja nie znaleziona', nl: 'Collectie niet gevonden',
            tr: 'Koleksiyon bulunamadı',
        };
        return (
            <div className="mx-auto max-w-7xl px-4 py-20 text-center">
                <h1 className="text-2xl font-bold text-white mb-4">{notFoundLabels[locale] || notFoundLabels.en}</h1>
            </div>
        );
    }

    const title = getLocalizedField(collection.title, locale) || params.slug;
    const description = getLocalizedField(collection.description, locale);

    let videos: Video[] = [];
    try {
        const result = await getVideosForCollection(collection.id);
        videos = result.data;
    } catch (error) {
        console.error('[CollectionDetail] videos error:', error);
    }

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            {/* Cover */}
            {collection.cover_url && (
                <div className="relative w-full h-48 sm:h-64 rounded-2xl overflow-hidden mb-8">
                    <img src={collection.cover_url} alt={title} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand-bg/90 to-transparent" />
                    <div className="absolute bottom-4 left-6">
                        <h1 className="text-3xl sm:text-4xl font-bold text-white drop-shadow-lg">{title}</h1>
                    </div>
                </div>
            )}

            {!collection.cover_url && (
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-6">{title}</h1>
            )}

            {description && (
                <p className="text-sm text-brand-text/80 leading-relaxed max-w-3xl mb-8">{description}</p>
            )}

            {videos.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {videos.map((video) => (
                        <VideoCard key={video.id} video={video} locale={locale} />
                    ))}
                </div>
            ) : (
                <p className="text-center text-brand-secondary py-12">No videos in this collection yet.</p>
            )}
        </div>
    );
}
