'use client';

import { useState } from 'react';
import { SUPPORTED_LOCALES, LOCALE_NAMES, type SupportedLocale } from '@/lib/i18n';
import type { LocalizedField } from '@/lib/types';

interface LocalizedTabsProps {
    value: LocalizedField;
    onChange: (updated: LocalizedField) => void;
    multiline?: boolean;
    label: string;
    readOnly?: boolean;
}

export default function LocalizedTabs({
    value,
    onChange,
    multiline = false,
    label,
    readOnly = false,
}: LocalizedTabsProps) {
    const [active, setActive] = useState<SupportedLocale>('en');

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <label className="text-sm font-medium text-gray-300 block mb-2">{label}</label>
            <div className="flex gap-1 mb-3 flex-wrap">
                {SUPPORTED_LOCALES.map((loc) => (
                    <button
                        key={loc}
                        type="button"
                        onClick={() => setActive(loc)}
                        className={`text-xs px-2 py-1 rounded transition-colors ${
                            active === loc
                                ? 'bg-purple-600 text-white'
                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        } ${value[loc] ? '' : 'opacity-50'}`}
                    >
                        {loc.toUpperCase()}
                    </button>
                ))}
            </div>
            {multiline ? (
                <textarea
                    value={value[active] || ''}
                    onChange={(e) => onChange({ ...value, [active]: e.target.value })}
                    readOnly={readOnly}
                    rows={4}
                    className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                    placeholder={`${LOCALE_NAMES[active]}...`}
                />
            ) : (
                <input
                    value={value[active] || ''}
                    onChange={(e) => onChange({ ...value, [active]: e.target.value })}
                    readOnly={readOnly}
                    className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                    placeholder={`${LOCALE_NAMES[active]}...`}
                />
            )}
        </div>
    );
}
