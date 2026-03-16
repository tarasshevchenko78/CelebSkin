'use client';

import { useState } from 'react';
import type { Celebrity } from '@/lib/types';
import { getLocalizedField, sceneLabel } from '@/lib/i18n';

interface CelebrityCardProps {
    celebrity: Celebrity;
    locale: string;
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
}

export default function CelebrityCard({ celebrity, locale }: CelebrityCardProps) {
    const [imgError, setImgError] = useState(false);
    const name = getLocalizedField(celebrity.name_localized, locale) || celebrity.name;

    return (
        <a
            href={`/${locale}/celebrity/${celebrity.slug}`}
            className="group shrink-0"
            draggable={false}
        >
            <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-gray-900 border border-gray-800 group-hover:border-brand-accent transition-colors duration-200">
                {celebrity.photo_url && !imgError ? (
                    <img
                        src={celebrity.photo_url}
                        alt={name}
                        loading="lazy"
                        draggable={false}
                        onError={() => setImgError(true)}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                ) : (
                    <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                        <span className="text-3xl text-gray-600">{getInitials(celebrity.name)}</span>
                    </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent pt-8 pb-2 px-2">
                    <p className="text-sm font-medium text-white line-clamp-2 leading-tight group-hover:text-brand-gold-light transition-colors">
                        {name}
                    </p>
                    {celebrity.videos_count > 0 && (
                        <span className="text-xs text-gray-400">{celebrity.videos_count} {sceneLabel(celebrity.videos_count, locale)}</span>
                    )}
                </div>
            </div>
        </a>
    );
}
