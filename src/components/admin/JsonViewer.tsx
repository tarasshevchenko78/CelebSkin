'use client';

import { useState } from 'react';

interface JsonViewerProps {
    data: Record<string, unknown> | null | undefined;
    label?: string;
}

export default function JsonViewer({ data, label = 'AI Raw Response' }: JsonViewerProps) {
    const [expanded, setExpanded] = useState(false);

    if (!data) return null;

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between p-4 text-sm font-medium text-gray-300 hover:bg-gray-800/50 transition-colors"
            >
                <span>{label}</span>
                <span className="text-gray-500 text-xs">{expanded ? '[-] Collapse' : '[+] Expand'}</span>
            </button>
            {expanded && (
                <div className="p-4 border-t border-gray-800 max-h-96 overflow-y-auto">
                    <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap">
                        {JSON.stringify(data, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
}
