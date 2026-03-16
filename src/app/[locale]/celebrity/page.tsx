import type { Metadata } from 'next';
import { type SupportedLocale } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import { getCelebrities } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Celebrity, PaginatedResult } from '@/lib/types';
import CelebrityCard from '@/components/CelebrityCard';

const titles: Record<string, string> = {
    en: 'Celebrities', ru: 'Знаменитости', de: 'Prominente', fr: 'Célébrités',
    es: 'Celebridades', pt: 'Celebridades', it: 'Celebrità',
    pl: 'Celebryci', nl: 'Beroemdheden', tr: 'Ünlüler',
};

const sortLabels: Record<string, Record<string, string>> = {
    popular: { en: 'Popular', ru: 'Популярные', de: 'Beliebt', fr: 'Populaires', es: 'Populares', pt: 'Populares', it: 'Popolari', pl: 'Popularne', nl: 'Populair', tr: 'Popüler' },
    az:      { en: 'A–Z',     ru: 'А–Я',        de: 'A–Z',    fr: 'A–Z',         es: 'A–Z',       pt: 'A–Z',       it: 'A–Z',       pl: 'A–Z',       nl: 'A–Z',      tr: 'A–Z' },
    videos:  { en: 'Most Scenes', ru: 'Больше сцен', de: 'Meiste', fr: 'Plus de scènes', es: 'Más escenas', pt: 'Mais cenas', it: 'Più scene', pl: 'Więcej scen', nl: 'Meeste', tr: 'En çok' },
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: `${titles[locale] || titles.en} — CelebSkin`,
        alternates: buildAlternates(locale, '/celebrity'),
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
    const perPage = 56;

    const sortMap: Record<string, string> = {
        popular: 'videos_count',
        az:      'name',
        videos:  'videos_count',
    };
    const orderBy = sortMap[sort] || 'videos_count';

    let result: PaginatedResult<Celebrity> = { data: [], total: 0, page: 1, limit: perPage, totalPages: 0 };
    try {
        result = await getCelebrities(page, perPage, orderBy, letter || undefined);
    } catch (error) {
        logger.error('Celebrities page DB error', { page: 'celebrities', error: error instanceof Error ? error.message : String(error) });
    }

    const celebs = result.data;
    const totalPages = result.totalPages;

    return (
        <div className="mx-auto max-w-[1600px] px-4 pt-3 pb-8">

            {/* Sort tabs */}
            <div className="flex items-center gap-0 border-b border-gray-800 mb-4">
                {(['popular', 'az', 'videos'] as const).map((key) => (
                    <a
                        key={key}
                        href={`/${locale}/celebrity?sort=${key}${letter ? `&letter=${letter}` : ''}`}
                        className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                            sort === key
                                ? 'border-brand-accent text-brand-gold-light'
                                : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                    >
                        {sortLabels[key][locale] || sortLabels[key].en}
                    </a>
                ))}
            </div>

            {/* Alphabet filter */}
            <div className="flex flex-wrap gap-1 mb-5">
                <a
                    href={`/${locale}/celebrity?sort=${sort}`}
                    className={`h-7 px-2 flex items-center justify-center text-xs rounded transition-colors ${
                        !letter
                            ? 'bg-brand-accent/15 text-brand-gold-light border border-brand-accent'
                            : 'text-[#c0bba8] border border-brand-accent/30 hover:border-brand-accent hover:text-brand-gold-light'
                    }`}
                >
                    All
                </a>
                {alphabet.map((l) => (
                    <a
                        key={l}
                        href={`/${locale}/celebrity?sort=${sort}&letter=${l}`}
                        className={`w-7 h-7 flex items-center justify-center text-xs rounded transition-colors ${
                            letter === l
                                ? 'bg-brand-accent/15 text-brand-gold-light border border-brand-accent'
                                : 'text-[#c0bba8] border border-brand-accent/30 hover:border-brand-accent hover:text-brand-gold-light'
                        }`}
                    >
                        {l}
                    </a>
                ))}
            </div>

            {celebs.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-2.5">
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
