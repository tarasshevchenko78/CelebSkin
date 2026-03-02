import type { Metadata } from 'next';
import { SUPPORTED_LOCALES } from '@/lib/i18n';

export async function generateMetadata({
    params,
}: {
    params: { locale: string; slug: string };
}): Promise<Metadata> {
    return {
        title: `Movie — CelebSkin`,
        alternates: {
            languages: Object.fromEntries(
                SUPPORTED_LOCALES.map((loc) => [loc, `/${loc}/movie/${params.slug}`])
            ),
        },
    };
}

export default function MovieDetailPage({
    params,
}: {
    params: { locale: string; slug: string };
}) {
    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="flex flex-col gap-8 md:flex-row">
                <div className="w-full md:w-56 shrink-0">
                    <div className="aspect-[2/3] rounded-2xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-500">
                        Poster
                    </div>
                </div>
                <div className="flex-1">
                    <h1 className="text-3xl font-bold text-white mb-2">{params.slug}</h1>
                    <div className="flex gap-4 mb-6 text-sm text-gray-400">
                        <span>Year: —</span>
                        <span>0 scenes</span>
                    </div>
                    <section className="mb-8">
                        <h2 className="text-lg font-semibold text-white mb-3">Description</h2>
                        <p className="text-gray-400">Description placeholder</p>
                    </section>
                    <section>
                        <h2 className="text-lg font-semibold text-white mb-4">Scenes</h2>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                            {[1, 2, 3].map((i) => (
                                <div
                                    key={i}
                                    className="aspect-video rounded-xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-600"
                                >
                                    Scene {i}
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
