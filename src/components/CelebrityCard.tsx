'use client';

import { useState } from 'react';
import type { Celebrity } from '@/lib/types';
import { getLocalizedField } from '@/lib/i18n';

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
            className="group flex flex-col items-center gap-2 shrink-0 w-[100px] sm:w-[120px]"
        >
            {/* Photo */}
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden border-2 border-brand-border group-hover:border-brand-accent transition-colors duration-300">
                {celebrity.photo_url && !imgError ? (
                    <img
                        src={celebrity.photo_url}
                        alt={name}
                        loading="lazy"
                        onError={() => setImgError(true)}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-brand-card to-brand-hover flex items-center justify-center">
                        <span className="text-brand-secondary font-semibold text-lg">
                            {getInitials(celebrity.name)}
                        </span>
                    </div>
                )}

                {/* Videos count badge */}
                {celebrity.videos_count > 0 && (
                    <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 bg-brand-accent text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[24px] text-center shadow-lg">
                        {celebrity.videos_count}
                    </span>
                )}
            </div>

            {/* Name */}
            <span className="text-xs text-brand-secondary group-hover:text-brand-text text-center leading-tight line-clamp-2 transition-colors duration-200">
                {name}
            </span>
        </a>
    );
}
