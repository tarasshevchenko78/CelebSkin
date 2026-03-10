import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';
import { getCelebrities } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Celebrity, PaginatedResult } from '@/lib/types';
import CelebrityCard from '@/components/CelebrityCard';

const titles: Record<string, string> = {
    en: 'Celebrities', ru: 'Знаменитости', de: 'Prominente', fr: 'Célébrités',
    es: 'Celebridades', pt: 'Celebridades', it: 'Celebrità',
    pl: 'Celebryci', nl: 'Beroemdheden', tr: 'Ünlüler',
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: `${titles[locale] || titles.en} — CelebSkin`,
        alternates: { languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}/celebrity`])) },
    };
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default async function CelebritiesPage({
    params,
    searchParams,
}: {
    params: { locale: string };
    searchParams: { sort?: string; letter?: string; page?: string };
}) {
    const locale = params.locale;
    const sort = searchParams.sort || 'popular';
    const letter = searchParams.letter || '';
    const page = parseInt(searchParams.page || '1');
    const perPage = 24;

    const sortMap: Record<string, string> = {
        popular: 'total_views',
        az: 'name',
        videos: 'videos_count',
    };
    const orderBy = sortMap[sort] || 'total_views';

    let result: PaginatedResult<Celebrity> = { data: [], total: 0, page: 1, limit: perPage, totalPages: 0 };
    try {
        result = await getCelebrities(page, perPage, orderBy, letter || undefined);
    } catch (error) {
        logger.error('Celebrities page DB error', { page: 'celebrities', error: error instanceof Error ? error.message : String(error) });
    }

    const celebs = result.data;
    const totalPages = result.totalPages;

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold text-white">
                    {titles[locale] || titles.en}
                </h1>
                <div className="flex gap-1.5">
                    {[
                        { key: 'popular', label: 'Popular' },
                        { key: 'az', label: 'A-Z' },
                        { key: 'videos', label: 'Most Videos' },
                    ].map(({ key, label }) => (
                        <a
                            key={key}
                            href={`/${locale}/celebrity?sort=${key}${letter ? `&letter=${letter}` : ''}`}
                            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${sort === key
                                    ? 'bg-brand-accent text-white'
                                    : 'bg-brand-card text-brand-secondary border border-brand-border hover:bg-brand-hover'
                                }`}
                        >
                            {label}
                        </a>
                    ))}
                </div>
            </div>

            {/* Alphabet filter */}
            <div className="flex flex-wrap gap-1 mb-6">
                <a
                    href={`/${locale}/celebrity?sort=${sort}`}
                    className={`w-7 h-7 flex items-center justify-center text-xs rounded transition-colors ${!letter ? 'bg-brand-accent text-white' : 'bg-brand-card text-brand-secondary border border-brand-border hover:bg-brand-hover'
                        }`}
                >
                    All
                </a>
                {alphabet.map((l) => (
                    <a
                        key={l}
                        href={`/${locale}/celebrity?sort=${sort}&letter=${l}`}
                        className={`w-7 h-7 flex items-center justify-center text-xs rounded transition-colors ${letter === l ? 'bg-brand-accent text-white' : 'bg-brand-card text-brand-secondary border border-brand-border hover:bg-brand-hover'
                            }`}
                    >
                        {l}
                    </a>
                ))}
            </div>

            {celebs.length > 0 ? (
                <div className="grid grid-cols-3 gap-6 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                    {celebs.map((celeb) => (
                        <CelebrityCard key={celeb.id} celebrity={celeb} locale={locale} />
                    ))}
                </div>
            ) : (
                <p className="text-center text-brand-secondary py-12">No celebrities found.</p>
            )}

            {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-3">
                    {page > 1 && (
                        <a
                            href={`/${locale}/celebrity?sort=${sort}${letter ? `&letter=${letter}` : ''}&page=${page - 1}`}
                            className="px-4 py-2 text-sm rounded-lg bg-brand-card border border-brand-border text-brand-secondary hover:bg-brand-hover transition-colors"
                        >
                            ← Previous
                        </a>
                    )}
                    <span className="text-sm text-brand-secondary">Page {page} of {totalPages}</span>
                    {page < totalPages && (
                        <a
                            href={`/${locale}/celebrity?sort=${sort}${letter ? `&letter=${letter}` : ''}&page=${page + 1}`}
                            className="px-4 py-2 text-sm rounded-lg bg-brand-card border border-brand-border text-brand-secondary hover:bg-brand-hover transition-colors"
                        >
                            Next →
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
