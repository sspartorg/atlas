import { SearchPillTextField } from './filterPrimitives.js';

interface Props {
    value: string;
    onChange: (next: string) => void;
    /** Floating label shown in the notched outline. */
    label?: string | undefined;
    minWidth?: number | undefined;
}

/**
 * Thin wrapper over SearchPillTextField so the Search page can swap styling
 * later without touching every call site.
 */
export function SearchTextInput({ value, onChange, label, minWidth }: Props) {
    return (
        <SearchPillTextField
            value={value}
            onChange={onChange}
            label={label ?? 'Search items by title, description, or ID'}
            minWidth={minWidth ?? 320}
        />
    );
}
