import type { Metadata } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/i18n';
import { getLocalizedField } from '@/lib/i18n';
import { getTagBySlug, getVideosByTag } from '@/lib/db';
import VideoCard from '@/components/VideoCard';

export async function generateMetadata({ params }: { params: { locale: string; slug: string } }): Promise<Metadata> {
    let tag;
    try {
        tag = await getTagBySlug(params.slug);
    } catch (error) {
        console.error('[TagPage] metadata DB error:', error);
    }
    const tagName = tag ? getLocalizedField(tag.name_localized, params.locale) || tag.name : params.slug;
    return {
        title: `${tagName} — CelebSkin`,
        alternates: { languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}/tag/${params.slug}`])) },
    };
}

export default async function TagPage({ params }: { params: { locale: string; slug: string } }) {
    const locale = params.locale;

    let tag;
    let videosResult;
    try {
        tag = await getTagBySlug(params.slug);
        videosResult = await getVideosByTag(params.slug);
    } catch (error) {
        console.error('[TagPage] DB error:', error);
    }
    const tagName = tag ? getLocalizedField(tag.name_localized, locale) || tag.name : params.slug;
    const videos = videosResult?.data || [];

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <h1 className="mb-6 text-2xl sm:text-3xl font-bold text-white">
                <span className="text-brand-secondary font-normal mr-2">#</span>{tagName}
            </h1>

            {tag && (
                <p className="text-sm text-brand-secondary mb-6">{tag.videos_count} videos</p>
            )}

            {videos.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {videos.map((v) => (
                        <VideoCard key={v.id} video={v} locale={locale} />
                    ))}
                </div>
            ) : (
                <p className="text-center text-brand-secondary py-12">No videos found for this tag.</p>
            )}
        </div>
    );
}
