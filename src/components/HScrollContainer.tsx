'use client';

import { useRef, useCallback } from 'react';

export default function HScrollContainer({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const dragging = useRef(false);
    const startX = useRef(0);
    const scrollLeft = useRef(0);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        if (!ref.current) return;
        dragging.current = true;
        startX.current = e.pageX - ref.current.offsetLeft;
        scrollLeft.current = ref.current.scrollLeft;
        ref.current.style.cursor = 'grabbing';
        ref.current.style.userSelect = 'none';
    }, []);

    const onMouseUp = useCallback(() => {
        dragging.current = false;
        if (ref.current) {
            ref.current.style.cursor = 'grab';
            ref.current.style.userSelect = '';
        }
    }, []);

    const onMouseMove = useCallback((e: React.MouseEvent) => {
        if (!dragging.current || !ref.current) return;
        e.preventDefault();
        const x = e.pageX - ref.current.offsetLeft;
        const walk = (x - startX.current) * 1.2;
        ref.current.scrollLeft = scrollLeft.current - walk;
    }, []);

    return (
        <div
            ref={ref}
            className={`flex gap-4 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4 md:mx-0 md:px-0 cursor-grab select-none ${className}`}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onMouseMove={onMouseMove}
        >
            {children}
        </div>
    );
}
