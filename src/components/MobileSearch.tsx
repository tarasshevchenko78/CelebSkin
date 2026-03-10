'use client';

import { useState } from 'react';

interface MobileSearchProps {
    locale: string;
    placeholder: string;
    quickTags?: Array<{ name: string; slug: string }>;
}

export default function MobileSearch({ locale, placeholder, quickTags }: MobileSearchProps) {
    const [query, setQuery] = useState('');

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const q = query.trim();
        if (q) {
            window.location.href = `/${locale}/search?q=${encodeURIComponent(q)}`;
        }
    }

    return (
        <div className="md:hidden">
            <form onSubmit={handleSubmit} className="relative">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-[#111113] border border-[#1a1a1e] rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-red-600/50 focus:outline-none transition-colors"
                />
                <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            </form>

            {quickTags && quickTags.length > 0 && (
                <div className="flex gap-2 overflow-x-auto scrollbar-hide mt-2">
                    {quickTags.map((tag) => (
                        <a
                            key={tag.slug}
                            href={`/${locale}/tag/${tag.slug}`}
                            className="shrink-0 px-3 py-1 rounded-full bg-gray-800/50 border border-gray-700 text-xs text-gray-300 hover:border-gray-500 transition-colors"
                        >
                            {tag.name}
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
}
