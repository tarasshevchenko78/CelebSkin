'use client';

import { useState, useCallback, useMemo } from 'react';

export function useRowSelection<T extends string | number>(allIds: T[]) {
    const [selected, setSelected] = useState<Set<T>>(new Set());

    const toggle = useCallback((id: T) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const toggleAll = useCallback(() => {
        setSelected(prev =>
            prev.size === allIds.length ? new Set() : new Set(allIds)
        );
    }, [allIds]);

    const clear = useCallback(() => setSelected(new Set()), []);

    const isAllSelected = useMemo(
        () => allIds.length > 0 && selected.size === allIds.length,
        [allIds.length, selected.size]
    );

    return {
        selected,
        toggle,
        toggleAll,
        clear,
        isAllSelected,
        selectedCount: selected.size,
        selectedIds: Array.from(selected),
    };
}
