import type { Metadata } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/i18n';

export async function generateMetadata({
    params,
}: {
    params: { locale: string; slug: string };
}): Promise<Metadata> {
    return {
        title: `Celebrity — CelebSkin`,
        alternates: {
            languages: Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `/${loc}/celebrity/${params.slug}`])
            ),
        },
    };
}

export default function CelebrityDetailPage({
    params,
}: {
    params: { locale: string; slug: string };
}) {
    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="flex flex-col gap-8 md:flex-row">
                <div className="w-full md:w-64 shrink-0">
                    <div className="aspect-[3/4] rounded-2xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-500">
                        Photo
                    </div>
                </div>
                <div className="flex-1">
                    <h1 className="text-3xl font-bold text-white mb-2">{params.slug}</h1>
                    <div className="flex gap-4 mb-6 text-sm text-gray-400">
                        <span>0 videos</span>
                        <span>0 views</span>
                    </div>
                    <section className="mb-8">
                        <h2 className="text-lg font-semibold text-white mb-3">Biography</h2>
                        <p className="text-gray-400">Bio placeholder</p>
                    </section>
                    <section>
                        <h2 className="text-lg font-semibold text-white mb-4">Videos</h2>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                            {[1, 2, 3].map((i) => (
                                <div
                                    key={i}
                                    className="aspect-video rounded-xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-600"
                                >
                                    Video {i}
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
