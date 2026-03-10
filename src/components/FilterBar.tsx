'use client';

import ChipFilter from './ChipFilter';
import SortDropdown from './SortDropdown';

interface FilterBarProps {
    tags?: Array<{ label: string; value: string; count?: number }>;
    selectedTags?: string[];
    onTagChange?: (tags: string[]) => void;
    sortOptions?: Array<{ label: string; value: string }>;
    selectedSort?: string;
    onSortChange?: (sort: string) => void;
}

export default function FilterBar({
    tags,
    selectedTags = [],
    onTagChange,
    sortOptions,
    selectedSort,
    onSortChange,
}: FilterBarProps) {
    return (
        <div className="flex items-center gap-3">
            {/* Chip filters — takes available space */}
            {tags && tags.length > 0 && onTagChange && (
                <div className="flex-1 min-w-0">
                    <ChipFilter
                        items={tags}
                        selected={selectedTags}
                        onChange={onTagChange}
                    />
                </div>
            )}

            {/* Sort dropdown — fixed right */}
            {sortOptions && sortOptions.length > 0 && selectedSort && onSortChange && (
                <div className="flex-shrink-0">
                    <SortDropdown
                        options={sortOptions}
                        selected={selectedSort}
                        onChange={onSortChange}
                    />
                </div>
            )}
        </div>
    );
}
