import Box from '@mui/material/Box';
import { FilterPill } from '../../components/filterPrimitives.js';

export type FilterKey = 'all' | 'mine' | 'software-dev' | 'marketing' | 'content' | 'design';

interface IProjectFilterChipsProps {
    value: FilterKey;
    onChange: (key: FilterKey) => void;
    counts: Record<FilterKey, number>;
}

interface IChipDef {
    key: FilterKey;
    label: string;
}

const CHIPS: IChipDef[] = [
    { key: 'all', label: 'All' },
    { key: 'mine', label: 'My queue' },
    { key: 'software-dev', label: 'Software dev queue' },
    { key: 'marketing', label: 'Marketing queue' },
    { key: 'content', label: 'Content queue' },
    { key: 'design', label: 'Design queue' },
];

// 2026-06-10 — Delegates to the canonical `FilterPill` from
// `components/filterPrimitives` so the count-chip rendering matches Queue,
// Issues, Epics, and Notifications. The inline implementation here had
// `ATLAS_PALETTE.white` / `.cloud` (mode-flipping) hardcoded into the
// selected state, which turned the active pill text invisible in dark
// mode.
export function ProjectFilterChips({ value, onChange, counts }: IProjectFilterChipsProps) {
    return (
        <Box
            sx={{
                display: 'flex',
                gap: 2,
                flexWrap: { xs: 'nowrap', md: 'wrap' },
                overflowX: { xs: 'auto', md: 'visible' },
                pb: { xs: 1, md: 0 },
                mx: { xs: -3, md: 0 },
                px: { xs: 3, md: 0 },
                '&::-webkit-scrollbar': { display: 'none' },
                msOverflowStyle: 'none',
                scrollbarWidth: 'none',
                '& > *': { flexShrink: 0 },
            }}
        >
            {CHIPS.map(({ key, label }) => (
                <FilterPill
                    key={key}
                    label={label}
                    count={counts[key]}
                    selected={value === key}
                    onClick={() => onChange(key)}
                />
            ))}
        </Box>
    );
}
