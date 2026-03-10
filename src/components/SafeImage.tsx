'use client';

import { useState } from 'react';

interface SafeImageProps {
    src: string;
    alt: string;
    className?: string;
    loading?: 'lazy' | 'eager';
    fallback: React.ReactNode;
}

/**
 * Image with built-in error handling.
 * Shows `fallback` if image fails to load.
 */
export default function SafeImage({ src, alt, className, loading = 'lazy', fallback }: SafeImageProps) {
    const [error, setError] = useState(false);

    if (error) {
        return <>{fallback}</>;
    }

    return (
        <img
            src={src}
            alt={alt}
            loading={loading}
            onError={() => setError(true)}
            className={className}
        />
    );
}
