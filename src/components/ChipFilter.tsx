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

    // Drag-scroll state
    const [isDragging, setIsDragging] = useState(false);
    const dragStartX = useRef(0);
    const dragScrollLeft = useRef(0);
    const dragMoved = useRef(false);

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
        // Ignore click if user was dragging
        if (dragMoved.current) return;
        if (multiSelect) {
            const next = selected.includes(value)
                ? selected.filter((v) => v !== value)
                : [...selected, value];
            onChange(next);
        } else {
            onChange(selected.includes(value) ? [] : [value]);
        }
    }

    // Drag-scroll handlers (desktop only, touch handled natively)
    const onMouseDown = useCallback((e: React.MouseEvent) => {
        const el = scrollRef.current;
        if (!el) return;
        setIsDragging(true);
        dragMoved.current = false;
        dragStartX.current = e.pageX - el.offsetLeft;
        dragScrollLeft.current = el.scrollLeft;
    }, []);

    const onMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging) return;
        const el = scrollRef.current;
        if (!el) return;
        e.preventDefault();
        const x = e.pageX - el.offsetLeft;
        const walk = (x - dragStartX.current) * 1.5;
        if (Math.abs(walk) > 3) dragMoved.current = true;
        el.scrollLeft = dragScrollLeft.current - walk;
    }, [isDragging]);

    const onMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    return (
        <div className="relative min-w-0">
            {/* Left fade */}
            {canScrollLeft && (
                <div className="absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-brand-bg to-transparent z-10 pointer-events-none" />
            )}

            {/* Chips */}
            <div
                ref={scrollRef}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                className={`flex gap-2 overflow-x-auto scrollbar-hide py-0.5 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            >
                {items.map((item) => {
                    const isSelected = selected.includes(item.value);
                    return (
                        <button
                            key={item.value}
                            onClick={() => handleClick(item.value)}
                            className={`px-4 py-1.5 rounded-full text-sm whitespace-nowrap cursor-pointer transition-all duration-200 border ${
                                isSelected
                                    ? 'bg-brand-accent/15 text-brand-gold-light border-brand-accent font-medium'
                                    : 'bg-transparent text-[#c0bba8] border-brand-accent/30 hover:border-brand-accent/60 hover:text-brand-gold-light hover:bg-brand-accent/5'
                            }`}
                        >
                            {item.label}
                            {item.count != null && (
                                <span className={isSelected ? 'ml-1 text-brand-gold-light/60' : 'ml-1 text-brand-muted'}>
                                    ({item.count})
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Right fade */}
            {canScrollRight && (
                <div className="absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-brand-bg to-transparent z-10 pointer-events-none" />
            )}
        </div>
    );
}
