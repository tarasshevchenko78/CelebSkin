import type { Metadata } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/i18n';

export async function generateMetadata({
    params,
}: {
    params: { locale: string; slug: string };
}): Promise<Metadata> {
    return {
        title: `Tag: ${params.slug} — CelebSkin`,
        alternates: {
            languages: Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `/${loc}/tag/${params.slug}`])
            ),
        },
    };
}

export default function TagPage({
    params,
}: {
    params: { locale: string; slug: string };
}) {
    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <h1 className="mb-8 text-3xl font-bold text-white">
                Tag: {params.slug}
            </h1>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div
                        key={i}
                        className="aspect-video rounded-xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-600"
                    >
                        Video {i}
                    </div>
                ))}
            </div>
        </div>
    );
}
