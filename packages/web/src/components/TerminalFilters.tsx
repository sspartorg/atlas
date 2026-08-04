import Box from '@mui/material/Box';
import { FilterPill, DropdownChip, SearchPillTextField } from './filterPrimitives.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import type { AgentCli, CliSessionStatus, IProject } from '@atlas/shared';
import { CLI_OPTIONS } from '../utils/cliPresentation.js';

export type StatusFilterKey = 'all' | CliSessionStatus;
export type CliFilterKey = 'all' | AgentCli;

const CLI_FILTER_OPTIONS: ReadonlyArray<{ value: CliFilterKey; label: string }> = [
    { value: 'all', label: 'Any' },
    ...CLI_OPTIONS,
];

interface StatusChip {
    key: StatusFilterKey;
    label: string;
    icon: string;
    accent?: { bg: string; fg: string };
}

const STATUS_CHIPS: StatusChip[] = [
    { key: 'all', label: 'All', icon: 'list' },
    {
        key: 'active',
        label: 'Active',
        icon: 'play_arrow',
        accent: { bg: ATLAS_PALETTE.success, fg: ATLAS_PALETTE.white },
    },
    {
        key: 'paused',
        label: 'Paused',
        icon: 'pause',
        accent: { bg: ATLAS_PALETTE.warning, fg: ATLAS_PALETTE.white },
    },
    {
        key: 'closed',
        label: 'Closed',
        icon: 'check_circle',
        accent: { bg: ATLAS_PALETTE.slate12, fg: ATLAS_PALETTE.slate },
    },
    {
        key: 'errored',
        label: 'Errored',
        icon: 'error',
        accent: { bg: ATLAS_PALETTE.error, fg: ATLAS_PALETTE.white },
    },
];

interface TerminalFiltersProps {
    status: StatusFilterKey;
    cli: CliFilterKey;
    projectId: string | 'all';
    search: string;
    counts: Record<StatusFilterKey, number>;
    projects: IProject[];
    onStatusChange: (next: StatusFilterKey) => void;
    onCliChange: (next: CliFilterKey) => void;
    onProjectChange: (next: string | 'all') => void;
    onSearchChange: (next: string) => void;
}

export function TerminalFilters({
    status,
    cli,
    projectId,
    search,
    counts,
    projects,
    onStatusChange,
    onCliChange,
    onProjectChange,
    onSearchChange,
}: TerminalFiltersProps) {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Status chip row */}
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
                {STATUS_CHIPS.map((c) => (
                    <FilterPill
                        key={c.key}
                        label={c.label}
                        count={counts[c.key]}
                        selected={status === c.key}
                        onClick={() => onStatusChange(c.key)}
                        accentColor={c.accent}
                        icon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{
                                    fontSize: 16,
                                    color:
                                        status === c.key
                                            ? (c.accent?.fg ?? ATLAS_PALETTE.onAccent)
                                            : (c.accent?.bg ?? ATLAS_PALETTE.slate60),
                                }}
                            >
                                {c.icon}
                            </Box>
                        }
                    />
                ))}
            </Box>

            {/* Dropdown + search row */}
            <Box
                sx={{
                    display: 'flex',
                    gap: 2,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                }}
            >
                <DropdownChip<CliFilterKey>
                    label="CLI"
                    value={cli}
                    options={[...CLI_FILTER_OPTIONS]}
                    onChange={onCliChange}
                />
                <DropdownChip<string | 'all'>
                    label="Project"
                    value={projectId}
                    options={[
                        { value: 'all', label: 'Any' },
                        ...projects.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                    onChange={onProjectChange}
                />
                <Box sx={{ flex: 1, minWidth: 200, display: 'flex', justifyContent: 'flex-end' }}>
                    <SearchPillTextField
                        label="Search title, branch, id"
                        value={search}
                        onChange={onSearchChange}
                    />
                </Box>
            </Box>
        </Box>
    );
}
