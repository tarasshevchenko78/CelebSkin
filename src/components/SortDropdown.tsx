'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface SortDropdownProps {
    options: Array<{ label: string; value: string }>;
    selected: string;
    onChange: (value: string) => void;
}

export default function SortDropdown({ options, selected, onChange }: SortDropdownProps) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedLabel = options.find((o) => o.value === selected)?.label || 'Sort';

    // Close on click outside
    const handleClickOutside = useCallback((e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
            setOpen(false);
        }
    }, []);

    // Close on Escape
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false);
    }, []);

    useEffect(() => {
        if (open) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open, handleClickOutside, handleKeyDown]);

    function handleSelect(value: string) {
        onChange(value);
        setOpen(false);
    }

    return (
        <div ref={containerRef} className="relative">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-card text-sm text-[#c0bba8] border border-brand-accent/30 hover:border-brand-accent/60 hover:text-brand-gold-light transition-all duration-200 whitespace-nowrap"
            >
                {selectedLabel}
                <svg
                    className={`w-3 h-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && (
                <div className="absolute right-0 top-full mt-1 bg-brand-card border border-brand-accent/30 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] z-20 min-w-[150px] py-1 backdrop-blur-xl">
                    {options.map((option) => (
                        <button
                            key={option.value}
                            onClick={() => handleSelect(option.value)}
                            className={`block w-full text-left px-3 py-2 text-sm transition-colors hover:bg-brand-accent/10 ${
                                option.value === selected ? 'text-brand-gold-light' : 'text-[#c0bba8]'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
