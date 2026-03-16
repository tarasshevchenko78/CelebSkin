'use client';

import { useState, useEffect, useRef } from 'react';
import FavoriteButton from './FavoriteButton';

function formatViews(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
}

interface VideoDetailActionsProps {
    videoId: string;
    initialViews: number;
    initialLikes: number;
    initialDislikes: number;
}

export default function VideoDetailActions({
    videoId,
    initialViews,
    initialLikes,
    initialDislikes,
}: VideoDetailActionsProps) {
    const [views, setViews] = useState(initialViews);
    const [likes, setLikes] = useState(initialLikes);
    const [dislikes, setDislikes] = useState(initialDislikes);
    const [userVote, setUserVote] = useState<'like' | 'dislike' | null>(null);
    const [copied, setCopied] = useState(false);
    const viewTracked = useRef(false);

    useEffect(() => {
        if (viewTracked.current) return;
        viewTracked.current = true;
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

    useEffect(() => {
        fetch(`/api/videos/${videoId}/like`)
            .then(r => r.json())
            .then(data => {
                const vote = data.userVote as 'like' | 'dislike' | null;
                setUserVote(vote);
                // Sync live counts from server (bypasses stale page cache)
                if (data.likes != null) setLikes(data.likes);
                if (data.dislikes != null) setDislikes(data.dislikes);
                if (vote) localStorage.setItem(`vote_${videoId}`, vote);
                else localStorage.removeItem(`vote_${videoId}`);
            })
            .catch(() => {
                const stored = localStorage.getItem(`vote_${videoId}`);
                if (stored === 'like' || stored === 'dislike') setUserVote(stored);
            });
    }, [videoId]);

    const handleVote = async (action: 'like' | 'dislike') => {
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
                setUserVote(data.userVote);
                if (data.userVote) localStorage.setItem(`vote_${videoId}`, data.userVote);
                else localStorage.removeItem(`vote_${videoId}`);
            }
        } catch {}
    };

    const handleShare = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {}
    };

    const btn = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-sm transition-colors';

    return (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-sm text-gray-500">
                {views >= 10 ? `${formatViews(views)} views` : 'Recently added'}
            </span>
            <div className="flex items-center gap-2 ml-auto">
                <button
                    onClick={() => handleVote('like')}
                    className={`${btn} ${userVote === 'like' ? 'text-green-400 bg-green-400/10' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                >
                    <svg className="w-4 h-4" fill={userVote === 'like' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                    </svg>
                    <span className="hidden sm:inline text-xs">{formatViews(likes)}</span>
                </button>
                <button
                    onClick={() => handleVote('dislike')}
                    className={`${btn} ${userVote === 'dislike' ? 'text-red-400 bg-red-400/10' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                >
                    <svg className="w-4 h-4 rotate-180" fill={userVote === 'dislike' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                    </svg>
                    <span className="hidden sm:inline text-xs">{dislikes}</span>
                </button>
                <FavoriteButton itemType="video" itemId={videoId} />
                <button
                    onClick={handleShare}
                    className={`${btn} ${copied ? 'text-green-400 bg-green-400/10' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                >
                    {copied ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                    )}
                    <span className="hidden sm:inline">{copied ? 'Copied!' : 'Share'}</span>
                </button>
            </div>
        </div>
    );
}
