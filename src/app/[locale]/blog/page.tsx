import type { Metadata } from 'next';
import { type SupportedLocale, getLocalizedField } from '@/lib/i18n';
import { buildAlternates } from '@/lib/seo';
import { getBlogPosts } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { BlogPost, PaginatedResult } from '@/lib/types';

const titles: Record<string, string> = {
    en: 'Blog', ru: 'Блог', de: 'Blog', fr: 'Blog',
    es: 'Blog', pt: 'Blog', it: 'Blog',
    pl: 'Blog', nl: 'Blog', tr: 'Blog',
};

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    const locale = params.locale as SupportedLocale;
    return {
        title: `${titles[locale] || titles.en} — CelebSkin`,
        alternates: buildAlternates(locale, '/blog'),
    };
}

export default async function BlogPage({
    params,
    searchParams,
}: {
    params: { locale: string };
    searchParams: { page?: string };
}) {
    const locale = params.locale;
    const page = parseInt(searchParams.page || '1');
    const perPage = 12;

    let result: PaginatedResult<BlogPost> = { data: [], total: 0, page: 1, limit: perPage, totalPages: 0 };
    try {
        result = await getBlogPosts(page, perPage);
    } catch (error) {
        logger.error('Blog page DB error', { page: 'blog', error: error instanceof Error ? error.message : String(error) });
    }

    const posts = result.data;
    const totalPages = result.totalPages;

    const emptyLabels: Record<string, string> = {
        en: 'No blog posts yet.', ru: 'Пока нет статей.', de: 'Noch keine Blogbeiträge.',
        fr: 'Aucun article pour le moment.', es: 'Aún no hay artículos.',
        pt: 'Nenhum artigo ainda.', it: 'Nessun articolo ancora.',
        pl: 'Brak artykułów.', nl: 'Nog geen blogposts.', tr: 'Henüz yazı yok.',
    };

    return (
        <div className="mx-auto max-w-[1600px] px-4 py-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-6">
                {titles[locale] || titles.en}
            </h1>

            {posts.length > 0 ? (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {posts.map((post) => {
                        const postTitle = getLocalizedField(post.title, locale);
                        const excerpt = getLocalizedField(post.excerpt, locale);
                        return (
                            <a
                                key={post.id}
                                href={`/${locale}/blog/${post.slug}`}
                                className="group block rounded-xl overflow-hidden border border-brand-border bg-brand-card hover:bg-brand-hover transition-colors"
                            >
                                {post.cover_url && (
                                    <div className="aspect-video overflow-hidden">
                                        <img
                                            src={post.cover_url}
                                            alt={postTitle}
                                            loading="lazy"
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                        />
                                    </div>
                                )}
                                <div className="p-4">
                                    <h2 className="text-base font-semibold text-white line-clamp-2 group-hover:text-brand-accent transition-colors">
                                        {postTitle}
                                    </h2>
                                    {excerpt && (
                                        <p className="mt-2 text-sm text-brand-secondary line-clamp-3">{excerpt}</p>
                                    )}
                                    {post.published_at && (
                                        <time className="mt-3 block text-xs text-brand-muted">
                                            {new Date(post.published_at).toLocaleDateString(locale)}
                                        </time>
                                    )}
                                </div>
                            </a>
                        );
                    })}
                </div>
            ) : (
                <p className="text-center text-brand-secondary py-12">{emptyLabels[locale] || emptyLabels.en}</p>
            )}

            {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-3">
                    {page > 1 && (
                        <a
                            href={`/${locale}/blog?page=${page - 1}`}
                            className="px-4 py-2 text-sm rounded-lg bg-brand-card border border-brand-border text-brand-secondary hover:bg-brand-hover transition-colors"
                        >
                            ← Previous
                        </a>
                    )}
                    <span className="text-sm text-brand-secondary">
                        Page {page} of {totalPages}
                    </span>
                    {page < totalPages && (
                        <a
                            href={`/${locale}/blog?page=${page + 1}`}
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
