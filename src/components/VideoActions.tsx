'use client';

import { useState, useEffect, useRef } from 'react';

function formatViews(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
}

interface VideoActionsProps {
    videoId: string;
    initialViews: number;
    initialLikes: number;
    initialDislikes: number;
    durationFormatted?: string;
    quality?: string;
}

export default function VideoActions({
    videoId,
    initialViews,
    initialLikes,
    initialDislikes,
    durationFormatted,
    quality,
}: VideoActionsProps) {
    const [views, setViews] = useState(initialViews);
    const [likes, setLikes] = useState(initialLikes);
    const [dislikes, setDislikes] = useState(initialDislikes);
    const [userAction, setUserAction] = useState<'like' | 'dislike' | null>(null);
    const viewTracked = useRef(false);

    // Track view on page load (once)
    useEffect(() => {
        if (viewTracked.current) return;
        viewTracked.current = true;

        // Check if already viewed in this session
        const viewedKey = `viewed_${videoId}`;
        if (sessionStorage.getItem(viewedKey)) return;

        fetch(`/api/videos/${videoId}/view`, { method: 'POST' })
            .then(r => r.json())
            .then(data => {
                if (data.views) setViews(data.views);
                sessionStorage.setItem(viewedKey, '1');
            })
            .catch(() => {});
    }, [videoId]);

    // Check localStorage for previous like/dislike
    useEffect(() => {
        const stored = localStorage.getItem(`vote_${videoId}`);
        if (stored === 'like' || stored === 'dislike') {
            setUserAction(stored);
        }
    }, [videoId]);

    const handleVote = async (action: 'like' | 'dislike') => {
        if (userAction === action) return; // Already voted this way

        try {
            const res = await fetch(`/api/videos/${videoId}/like`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            const data = await res.json();
            if (data.likes !== undefined) {
                setLikes(data.likes);
                setDislikes(data.dislikes);
                setUserAction(action);
                localStorage.setItem(`vote_${videoId}`, action);
            }
        } catch {
            // silently fail
        }
    };

    return (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            {durationFormatted && (
                <span className="text-brand-secondary">{durationFormatted}</span>
            )}
            {quality && (
                <span className="bg-brand-accent text-white text-xs font-bold px-2 py-0.5 rounded">{quality}</span>
            )}
            <span className="text-brand-secondary">{formatViews(views)} views</span>
            <div className="flex items-center gap-2 ml-auto">
                <button
                    onClick={() => handleVote('like')}
                    className={`flex items-center gap-1 transition-colors ${
                        userAction === 'like' ? 'text-green-400' : 'text-brand-secondary hover:text-green-400'
                    }`}
                >
                    <svg className="w-4 h-4" fill={userAction === 'like' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                    </svg>
                    <span className="text-xs">{formatViews(likes)}</span>
                </button>
                <button
                    onClick={() => handleVote('dislike')}
                    className={`flex items-center gap-1 transition-colors ${
                        userAction === 'dislike' ? 'text-red-400' : 'text-brand-secondary hover:text-red-400'
                    }`}
                >
                    <svg className="w-4 h-4 rotate-180" fill={userAction === 'dislike' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                    </svg>
                    <span className="text-xs">{dislikes}</span>
                </button>
            </div>
        </div>
    );
}
