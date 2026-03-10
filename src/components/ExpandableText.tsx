'use client';

import { useState } from 'react';

interface ExpandableTextProps {
    text: string;
    readMoreLabel?: string;
}

export default function ExpandableText({ text, readMoreLabel = 'Read more' }: ExpandableTextProps) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div>
            <p className={`text-sm text-gray-300/90 leading-relaxed whitespace-pre-line ${expanded ? '' : 'line-clamp-3 md:line-clamp-none'}`}>
                {text}
            </p>
            {!expanded && (
                <button
                    onClick={() => setExpanded(true)}
                    className="md:hidden text-sm text-red-400 hover:text-red-300 mt-1"
                >
                    {readMoreLabel}
                </button>
            )}
        </div>
    );
}
