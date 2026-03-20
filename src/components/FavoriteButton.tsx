'use client';

import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';

interface Props {
    itemType: 'video' | 'celebrity';
    itemId: string;
    /** compact: icon only; default: icon + label */
    compact?: boolean;
    className?: string;
}

export default function FavoriteButton({ itemType, itemId, compact, className = '' }: Props) {
    const { user, openAuthModal, setPendingFavorite } = useAuth();
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(false);

    // Sync state from server when logged in
    useEffect(() => {
        if (!user) {
            // Fallback to localStorage for logged-out users
            try {
                const key = `fav_${itemType}_${itemId}`;
                setSaved(localStorage.getItem(key) === '1');
            } catch {}
            return;
        }
        fetch(`/api/user/favorites?type=${itemType}&id=${itemId}`)
            .then(r => r.json())
            .then(d => { if (d.favorite !== undefined) setSaved(d.favorite); })
            .catch(() => {});
    }, [user, itemType, itemId]);

    const handleClick = async () => {
        if (!user) {
            setPendingFavorite({ itemType, itemId });
            openAuthModal();
            return;
        }
        if (loading) return;
        setLoading(true);
        const method = saved ? 'DELETE' : 'POST';
        try {
            const res = await fetch('/api/user/favorites', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_type: itemType, item_id: itemId }),
            });
            const data = await res.json();
            if (data.ok) setSaved(data.favorite);
        } catch {}
        setLoading(false);
    };

    const base = compact
        ? `flex items-center justify-center transition-colors ${className}`
        : `flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-sm transition-colors ${className}`;

    const color = saved
        ? 'text-yellow-400 bg-yellow-400/10'
        : 'text-gray-400 hover:text-white hover:bg-gray-700';

    return (
        <button
            onClick={handleClick}
            disabled={loading}
            title={saved ? 'Remove from favorites' : 'Add to favorites'}
            className={`${base} ${compact ? '' : color} ${compact && saved ? 'text-yellow-400' : compact ? 'text-gray-400 hover:text-yellow-400' : ''}`}
        >
            <svg
                className={compact ? 'w-5 h-5' : 'w-4 h-4'}
                fill={saved ? 'currentColor' : 'none'}
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            {!compact && <span className="hidden sm:inline">{saved ? 'Saved' : 'Save'}</span>}
        </button>
    );
}
