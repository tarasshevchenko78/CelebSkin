import type { Metadata } from 'next';
import { SUPPORTED_LOCALES, getLocalizedField } from '@/lib/i18n';
import { getBlogPostBySlug } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { locale: string; slug: string } }): Promise<Metadata> {
    let post;
    try {
        post = await getBlogPostBySlug(params.slug);
    } catch (error) {
        console.error('[BlogPost] metadata DB error:', error);
    }
    const title = post
        ? getLocalizedField(post.seo_title, params.locale) || getLocalizedField(post.title, params.locale) || 'Blog'
        : 'Blog';
    const description = post ? getLocalizedField(post.seo_description, params.locale) : undefined;
    return {
        title: `${title} — CelebSkin`,
        description,
        alternates: { languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}/blog/${params.slug}`])) },
    };
}

export default async function BlogPostPage({ params }: { params: { locale: string; slug: string } }) {
    const locale = params.locale;

    let post;
    try {
        post = await getBlogPostBySlug(params.slug);
    } catch (error) {
        console.error('[BlogPost] DB error:', error);
    }

    if (!post) {
        const notFoundLabels: Record<string, string> = {
            en: 'Article not found', ru: 'Статья не найдена', de: 'Artikel nicht gefunden',
            fr: 'Article introuvable', es: 'Artículo no encontrado', pt: 'Artigo não encontrado',
            it: 'Articolo non trovato', pl: 'Artykuł nie znaleziony', nl: 'Artikel niet gevonden',
            tr: 'Makale bulunamadı',
        };
        const backLabels: Record<string, string> = {
            en: '← Back to blog', ru: '← Назад в блог', de: '← Zurück zum Blog',
            fr: '← Retour au blog', es: '← Volver al blog', pt: '← Voltar ao blog',
            it: '← Torna al blog', pl: '← Wróć do bloga', nl: '← Terug naar blog',
            tr: '← Bloga dön',
        };
        return (
            <div className="mx-auto max-w-3xl px-4 py-20 text-center">
                <h1 className="text-2xl font-bold text-white mb-4">{notFoundLabels[locale] || notFoundLabels.en}</h1>
                <a href={`/${locale}/blog`} className="text-brand-accent hover:underline">{backLabels[locale] || backLabels.en}</a>
            </div>
        );
    }

    const title = getLocalizedField(post.title, locale);
    const content = getLocalizedField(post.content, locale);

    return (
        <article className="mx-auto max-w-3xl px-4 py-8">
            {/* Back link */}
            <a href={`/${locale}/blog`} className="inline-block text-sm text-brand-secondary hover:text-brand-accent transition-colors mb-6">
                ← Blog
            </a>

            {/* Cover image */}
            {post.cover_url && (
                <div className="aspect-video rounded-2xl overflow-hidden mb-8 border border-brand-border">
                    <img src={post.cover_url} alt={title} className="w-full h-full object-cover" />
                </div>
            )}

            {/* Title */}
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">{title}</h1>

            {/* Date */}
            {post.published_at && (
                <time className="block text-sm text-brand-muted mb-8">
                    {new Date(post.published_at).toLocaleDateString(locale, {
                        year: 'numeric', month: 'long', day: 'numeric',
                    })}
                </time>
            )}

            {/* Content */}
            {content && (
                <div
                    className="prose prose-invert prose-sm sm:prose-base max-w-none prose-headings:text-white prose-p:text-brand-text/85 prose-a:text-brand-accent"
                    dangerouslySetInnerHTML={{ __html: content }}
                />
            )}
        </article>
    );
}
