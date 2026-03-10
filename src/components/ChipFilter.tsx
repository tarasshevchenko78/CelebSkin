'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

interface ChipFilterProps {
    items: Array<{ label: string; value: string; count?: number }>;
    selected: string[];
    onChange: (selected: string[]) => void;
    multiSelect?: boolean;
}

export default function ChipFilter({ items, selected, onChange, multiSelect = false }: ChipFilterProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const checkScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        setCanScrollLeft(el.scrollLeft > 4);
        setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
    }, []);

    useEffect(() => {
        checkScroll();
        const el = scrollRef.current;
        if (!el) return;
        el.addEventListener('scroll', checkScroll, { passive: true });
        window.addEventListener('resize', checkScroll);
        return () => {
            el.removeEventListener('scroll', checkScroll);
            window.removeEventListener('resize', checkScroll);
        };
    }, [checkScroll, items]);

    function handleClick(value: string) {
        if (multiSelect) {
            const next = selected.includes(value)
                ? selected.filter((v) => v !== value)
                : [...selected, value];
            onChange(next);
        } else {
            onChange(selected.includes(value) ? [] : [value]);
        }
    }

    return (
        <div className="relative min-w-0">
            {/* Left fade */}
            {canScrollLeft && (
                <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#08060a] to-transparent z-10 pointer-events-none" />
            )}

            {/* Chips */}
            <div
                ref={scrollRef}
                className="flex gap-2 overflow-x-auto scrollbar-hide py-0.5"
            >
                {items.map((item) => {
                    const isSelected = selected.includes(item.value);
                    return (
                        <button
                            key={item.value}
                            onClick={() => handleClick(item.value)}
                            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap cursor-pointer transition-colors border ${
                                isSelected
                                    ? 'bg-red-600/20 text-red-400 border-red-600'
                                    : 'bg-gray-800/50 text-gray-300 border-gray-700 hover:border-gray-500'
                            }`}
                        >
                            {item.label}
                            {item.count != null && (
                                <span className={isSelected ? 'ml-1 text-red-400/60' : 'ml-1 text-gray-500'}>
                                    ({item.count})
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Right fade */}
            {canScrollRight && (
                <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#08060a] to-transparent z-10 pointer-events-none" />
            )}
        </div>
    );
}
