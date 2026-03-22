import type { Metadata } from 'next';
import { getLocalizedField } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import { getTagBySlug, getVideosByTag } from '@/lib/db';
import { logger } from '@/lib/logger';
import VideoCard from '@/components/VideoCard';

export async function generateMetadata({ params }: { params: { locale: string; slug: string } }): Promise<Metadata> {
    let tag;
    try {
        tag = await getTagBySlug(params.slug);
    } catch (error) {
        logger.error('Tag page metadata DB error', { page: 'tag/detail', error: error instanceof Error ? error.message : String(error) });
    }
    const tagName = tag ? getLocalizedField(tag.name_localized, params.locale) || tag.name : params.slug;
    return {
        title: `${tagName} — CelebSkin`,
        alternates: buildAlternates(params.locale, `/tag/${params.slug}`),
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
        logger.error('Tag page DB error', { page: 'tag/detail', error: error instanceof Error ? error.message : String(error) });
    }
    const tagName = tag ? getLocalizedField(tag.name_localized, locale) || tag.name : params.slug;
    const videos = videosResult?.data || [];

    return (
        <div className="mx-auto max-w-[1600px] px-4 py-8">
            {/* Breadcrumbs */}
            <nav className="mb-4 text-sm text-brand-muted" aria-label="Breadcrumb">
                <ol className="flex flex-wrap items-center gap-1">
                    <li><a href={`/${locale}`} className="hover:text-brand-accent transition-colors">Home</a></li>
                    <li className="text-brand-border">/</li>
                    <li><a href={`/${locale}/video`} className="hover:text-brand-accent transition-colors">{locale === 'ru' ? 'Видео' : 'Videos'}</a></li>
                    <li className="text-brand-border">/</li>
                    <li className="text-brand-text">#{tagName}</li>
                </ol>
            </nav>

            <h1 className="mb-6 text-2xl sm:text-3xl font-bold text-white">
                <span className="text-brand-secondary font-normal mr-2">#</span>{tagName}
            </h1>

            {tag && (
                <p className="text-sm text-brand-secondary mb-6">{tag.videos_count} {locale === 'ru' ? 'сцен' : 'scenes'}</p>
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
