import type { Metadata } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/i18n';

export async function generateMetadata({
    params,
}: {
    params: { locale: string; slug: string };
}): Promise<Metadata> {
    // In production, fetch from DB and use localized title
    return {
        title: `Video — CelebSkin`,
        alternates: {
            languages: Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `/${loc}/video/${params.slug}`])
            ),
        },
    };
}

export default function VideoDetailPage({
    params,
}: {
    params: { locale: string; slug: string };
}) {
    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="mb-8 aspect-video w-full max-w-4xl mx-auto rounded-2xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-500">
                Video Player — {params.slug}
            </div>
            <div className="max-w-4xl mx-auto">
                <h1 className="text-2xl font-bold text-white mb-4">Video: {params.slug}</h1>
                <div className="flex gap-2 mb-6">
                    <span className="rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-400">HD</span>
                    <span className="rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-400">0:00</span>
                </div>
                <section className="mb-8">
                    <h2 className="text-lg font-semibold text-white mb-3">Celebrities</h2>
                    <div className="text-gray-500">Celebrity links placeholder</div>
                </section>
                <section className="mb-8">
                    <h2 className="text-lg font-semibold text-white mb-3">Tags</h2>
                    <div className="text-gray-500">Tags placeholder</div>
                </section>
                <section>
                    <h2 className="text-lg font-semibold text-white mb-3">Related Videos</h2>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                        {[1, 2, 3].map((i) => (
                            <div
                                key={i}
                                className="aspect-video rounded-xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-600"
                            >
                                Related {i}
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}
