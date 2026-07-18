import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import { useState } from 'react';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { FilterPill } from './filterPrimitives.js';
import type { IProject } from '@atlas/shared';

export type EpicFilterKey = 'all' | 'mine' | 'ai';

interface Props {
    filterKey: EpicFilterKey;
    onFilterChange: (key: EpicFilterKey) => void;
    counts: Record<EpicFilterKey, number>;
    projects: IProject[];
    projectFilter: string | null;
    onProjectChange: (projectId: string | null) => void;
    statusFilter: string | null;
    onStatusChange: (status: string | null) => void;
    search: string;
    onSearchChange: (value: string) => void;
}

const STATUS_OPTIONS: Array<{ value: string | null; label: string }> = [
    { value: null, label: 'any' },
    { value: 'draft', label: 'Draft' },
    { value: 'ready', label: 'Ready' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'waiting_for_info', label: 'Waiting for Info' },
    { value: 'in_review', label: 'In Review' },
    { value: 'done', label: 'Done' },
];

interface ChipDef {
    key: EpicFilterKey;
    label: string;
}

const PRIMARY_CHIPS: ChipDef[] = [
    { key: 'all', label: 'All' },
    { key: 'mine', label: 'Assigned to me' },
    { key: 'ai', label: 'Assigned to AI' },
];

function DropdownChip({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string | null;
    options: Array<{ value: string | null; label: string }>;
    onChange: (v: string | null) => void;
}) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const current = options.find((o) => o.value === value) ?? options[0];
    return (
        <>
            <Box
                role="button"
                tabIndex={0}
                onClick={(e) => setAnchor(e.currentTarget)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') setAnchor(e.currentTarget as HTMLElement);
                }}
                sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 1,
                    padding: '4px 10px 4px 12px',
                    borderRadius: '9999px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'all 150ms ease',
                    fontSize: 13,
                    fontWeight: 500,
                    bgcolor: ATLAS_PALETTE.white,
                    color: ATLAS_PALETTE.slate,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    '&:hover': { bgcolor: ATLAS_PALETTE.cloud },
                }}
            >
                <Typography component="span" sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    {label}:
                </Typography>
                <Typography
                    component="span"
                    sx={{ fontSize: 13, color: ATLAS_PALETTE.slate, fontWeight: 500 }}
                >
                    {current?.label ?? 'any'}
                </Typography>
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 16, color: ATLAS_PALETTE.slate40 }}
                >
                    arrow_drop_down
                </Box>
            </Box>
            <Menu
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={() => setAnchor(null)}
                slotProps={{
                    paper: {
                        sx: {
                            borderRadius: '10px',
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            minWidth: 180,
                        },
                    },
                }}
            >
                {options.map((o) => (
                    <MenuItem
                        key={String(o.value)}
                        onClick={() => {
                            onChange(o.value);
                            setAnchor(null);
                        }}
                        sx={{ fontSize: 13, py: 1.25 }}
                    >
                        {o.label}
                        {o.value === value && (
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 16, color: ATLAS_PALETTE.brandBlue, ml: 'auto' }}
                            >
                                check
                            </Box>
                        )}
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
}

export function EpicFiltersBar(props: Props) {
    const {
        filterKey,
        onFilterChange,
        counts,
        projects,
        projectFilter,
        onProjectChange,
        statusFilter,
        onStatusChange,
        search,
        onSearchChange,
    } = props;

    const searchRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const target = e.target as HTMLElement;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
                e.preventDefault();
                searchRef.current?.focus();
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const projectOptions: Array<{ value: string | null; label: string }> = [
        { value: null, label: 'any' },
        ...projects.map((p) => ({ value: p.id, label: p.name })),
    ];

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                alignItems: { xs: 'stretch', md: 'center' },
                gap: { xs: 4, md: 2 },
                mb: 5,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    rowGap: { md: 2 },
                    flexWrap: { xs: 'nowrap', md: 'wrap' },
                    flex: { md: 1 },
                    minWidth: 0,
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
            {PRIMARY_CHIPS.map(({ key, label }) => (
                <FilterPill
                    key={key}
                    label={label}
                    count={counts[key]}
                    selected={filterKey === key}
                    onClick={() => onFilterChange(key)}
                />
            ))}

            <DropdownChip
                label="By project"
                value={projectFilter}
                options={projectOptions}
                onChange={onProjectChange}
            />

            <DropdownChip
                label="Status"
                value={statusFilter}
                options={STATUS_OPTIONS}
                onChange={onStatusChange}
            />
            </Box>

            <TextField
                label="Search epics"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                inputRef={searchRef}
                sx={{
                    width: { xs: '100%', md: 'auto' },
                    minWidth: { xs: 0, md: 240 },
                }}
                slotProps={{
                    input: {
                        startAdornment: (
                            <InputAdornment position="start">
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 18, color: ATLAS_PALETTE.slate40 }}
                                >
                                    search
                                </Box>
                            </InputAdornment>
                        ),
                        endAdornment: (
                            <InputAdornment position="end">
                                <Box
                                    component="span"
                                    sx={{
                                        fontFamily: '"JetBrains Mono", monospace',
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate40,
                                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                        borderRadius: '4px',
                                        px: 0.75,
                                        py: 0.25,
                                        lineHeight: 1.2,
                                    }}
                                >
                                    /
                                </Box>
                            </InputAdornment>
                        ),
                    },
                }}
            />
        </Box>
    );
}
