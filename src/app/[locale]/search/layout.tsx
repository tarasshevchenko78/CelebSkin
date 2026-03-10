import type { Metadata } from 'next';
import { buildAlternates } from '@/lib/seo';

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
    return {
        title: 'Search — CelebSkin',
        alternates: buildAlternates(params.locale, '/search'),
    };
}

export default function SearchLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
