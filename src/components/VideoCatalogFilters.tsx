'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import FilterBar from './FilterBar';

interface VideoCatalogFiltersProps {
    tags: Array<{ label: string; value: string; count?: number }>;
    sortOptions: Array<{ label: string; value: string }>;
    selectedTag: string;
    selectedSort: string;
}

export default function VideoCatalogFilters({
    tags,
    sortOptions,
    selectedTag,
    selectedSort,
}: VideoCatalogFiltersProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const buildUrl = useCallback(
        (overrides: { sort?: string; tag?: string }) => {
            const params = new URLSearchParams();
            const sort = overrides.sort ?? searchParams.get('sort') ?? '';
            const tag = overrides.tag ?? searchParams.get('tag') ?? '';

            if (sort && sort !== 'latest') params.set('sort', sort);
            if (tag) params.set('tag', tag);
            // Always reset to page 1 on filter/sort change

            const qs = params.toString();
            return qs ? `${pathname}?${qs}` : pathname;
        },
        [pathname, searchParams]
    );

    const handleSortChange = useCallback(
        (sort: string) => {
            router.push(buildUrl({ sort }));
        },
        [router, buildUrl]
    );

    const handleTagChange = useCallback(
        (tags: string[]) => {
            // Single-select: use last selected tag, or empty for "All"
            const tag = tags.length > 0 ? tags[tags.length - 1] : '';
            router.push(buildUrl({ tag }));
        },
        [router, buildUrl]
    );

    return (
        <FilterBar
            tags={tags}
            selectedTags={selectedTag ? [selectedTag] : []}
            onTagChange={handleTagChange}
            sortOptions={sortOptions}
            selectedSort={selectedSort}
            onSortChange={handleSortChange}
        />
    );
}
