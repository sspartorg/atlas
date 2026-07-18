import { useState, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import type { IProject } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import {
    type FilterState,
    type SearchType,
    type UpdatedRange,
    type StatusFilter,
    TYPE_LABEL,
} from './searchViewModel.js';

const MONO = '"JetBrains Mono", monospace';

const UPDATED_OPTIONS: Array<{ value: UpdatedRange; label: string }> = [
    { value: 'today', label: 'today' },
    { value: 'last_7_days', label: 'last 7 days' },
    { value: 'last_30_days', label: 'last 30 days' },
    { value: 'older', label: 'older than 30 days' },
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
    { value: 'draft', label: 'draft' },
    { value: 'ready', label: 'ready' },
    { value: 'in_progress', label: 'in progress' },
    { value: 'waiting_for_info', label: 'waiting for info' },
    { value: 'in_review', label: 'in review' },
    { value: 'done', label: 'done' },
];

const TYPE_VALUES: SearchType[] = ['epic', 'story', 'bug', 'sub_task', 'sub_bug', 'prompt'];

interface AddOption {
    key: 'type' | 'project' | 'updated' | 'status' | 'labels';
    label: string;
}

const ADD_OPTIONS: AddOption[] = [
    { key: 'type', label: 'Type' },
    { key: 'project', label: 'Project' },
    { key: 'updated', label: 'Updated' },
    { key: 'status', label: 'Status' },
    { key: 'labels', label: 'Labels' },
];

interface Props {
    filters: FilterState;
    setFilters: (next: FilterState) => void;
    projects: IProject[];
    resultCount: number;
    resultTypeCount: number;
    /** Labels suggested in the future label-picker UI (P14 follow-up). Currently
     * passed but unused — Search.tsx threads project labels in so the prop is
     * forward-compatible when the picker lands. */
    availableLabels?: string[];
}

function PillContainer({
    children,
    color,
    onRemove,
}: {
    children: React.ReactNode;
    color: string;
    onRemove?: () => void;
}) {
    return (
        <Box
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                pl: 1.5,
                pr: onRemove ? 0.75 : 1.5,
                py: 0.75,
                borderRadius: '9999px',
                background: `${color}10`,
                border: `1px solid ${color}40`,
                fontFamily: MONO,
                fontSize: 11.5,
            }}
        >
            {children}
            {onRemove ? (
                <Box
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRemove();
                        }
                    }}
                    sx={{
                        ml: 0.5,
                        width: 18,
                        height: 18,
                        borderRadius: '9999px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: `${color}b0`,
                        '&:hover': { background: `${color}20`, color },
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 14 }}
                    >
                        close
                    </Box>
                </Box>
            ) : null}
        </Box>
    );
}

export function SearchFilterBuilder({
    filters,
    setFilters,
    projects,
    resultCount,
    resultTypeCount,
    availableLabels = [],
}: Props) {
    const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
    const [editingPill, setEditingPill] = useState<{
        key: AddOption['key'];
        anchor: HTMLElement;
    } | null>(null);
    const builderRef = useRef<HTMLDivElement>(null);

    function openAdd(anchor: HTMLElement, key?: AddOption['key']) {
        if (key) setEditingPill({ key, anchor });
        else setAddAnchor(anchor);
    }

    function closeAdd() {
        setAddAnchor(null);
        setEditingPill(null);
    }

    function toggleType(t: SearchType) {
        const next = filters.types.includes(t)
            ? filters.types.filter((x) => x !== t)
            : [...filters.types, t];
        setFilters({ ...filters, types: next });
    }

    function setProject(id: string | null) {
        setFilters({ ...filters, projectIds: id ? [id] : [] });
        closeAdd();
    }

    function setUpdated(u: UpdatedRange) {
        setFilters({ ...filters, updated: u });
        closeAdd();
    }

    function setStatus(s: StatusFilter) {
        setFilters({ ...filters, status: s });
        closeAdd();
    }

    function toggleLabel(label: string) {
        const next = filters.labels.includes(label)
            ? filters.labels.filter((l) => l !== label)
            : [...filters.labels, label];
        setFilters({ ...filters, labels: next });
    }

    const activePills: Array<{
        key: AddOption['key'];
        label: string;
        value: string;
        color: string;
        onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
        onRemove: () => void;
    }> = [];

    if (filters.types.length > 0) {
        activePills.push({
            key: 'type',
            label: 'Type',
            value: filters.types.map((t) => t.replace('_', '-')).join(', '),
            color: ATLAS_PALETTE.brandBlue,
            onClick: (e) => openAdd(e.currentTarget, 'type'),
            onRemove: () => setFilters({ ...filters, types: [] }),
        });
    }
    if (filters.projectIds.length > 0) {
        const name =
            projects.find((p) => p.id === filters.projectIds[0])?.name ??
            filters.projectIds[0] ??
            '';
        activePills.push({
            key: 'project',
            label: 'Project',
            value: name,
            color: ATLAS_PALETTE.emerald,
            onClick: (e) => openAdd(e.currentTarget, 'project'),
            onRemove: () => setFilters({ ...filters, projectIds: [] }),
        });
    }
    if (filters.updated !== 'any') {
        const label =
            UPDATED_OPTIONS.find((o) => o.value === filters.updated)?.label ?? filters.updated;
        activePills.push({
            key: 'updated',
            label: 'Updated',
            value: label,
            color: ATLAS_PALETTE.gold,
            onClick: (e) => openAdd(e.currentTarget, 'updated'),
            onRemove: () => setFilters({ ...filters, updated: 'any' }),
        });
    }
    if (filters.status !== 'any') {
        const label =
            STATUS_OPTIONS.find((o) => o.value === filters.status)?.label ?? filters.status;
        activePills.push({
            key: 'status',
            label: 'Status',
            value: label,
            color: ATLAS_PALETTE.orange,
            onClick: (e) => openAdd(e.currentTarget, 'status'),
            onRemove: () => setFilters({ ...filters, status: 'any' }),
        });
    }
    if (filters.labels.length > 0) {
        activePills.push({
            key: 'labels',
            label: 'Labels',
            value: filters.labels.join(', '),
            color: ATLAS_PALETTE.purple,
            onClick: (e) => openAdd(e.currentTarget, 'labels'),
            onRemove: () => setFilters({ ...filters, labels: [] }),
        });
    }

    return (
        <Box
            ref={builderRef}
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 4,
                mb: 4,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    mb: 3,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                    <Box
                        sx={{
                            width: 28,
                            height: 28,
                            borderRadius: '6px',
                            background: `${ATLAS_PALETTE.brandBlue}14`,
                            border: `1px solid ${ATLAS_PALETTE.brandBlue}30`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 16, color: ATLAS_PALETTE.brandBlue }}
                        >
                            tune
                        </Box>
                    </Box>
                    <Box>
                        <Typography
                            sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate }}
                        >
                            Pill builder
                        </Typography>
                        <Typography
                            sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60, mt: 0.25 }}
                        >
                            Click any pill to edit · drag to reorder · X to remove
                        </Typography>
                    </Box>
                </Box>

            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
                {activePills.map((p) => (
                    <Box
                        key={p.key}
                        role="button"
                        tabIndex={0}
                        onClick={p.onClick}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                p.onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
                            }
                        }}
                        sx={{ cursor: 'pointer' }}
                    >
                        <PillContainer color={p.color} onRemove={p.onRemove}>
                            <Typography
                                component="span"
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 11.5,
                                    color: p.color,
                                    fontWeight: 600,
                                }}
                            >
                                {p.label}:
                            </Typography>
                            <Typography
                                component="span"
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 11.5,
                                    color: ATLAS_PALETTE.slate,
                                    ml: 0.5,
                                }}
                            >
                                {p.value}
                            </Typography>
                        </PillContainer>
                    </Box>
                ))}

                <Box
                    role="button"
                    tabIndex={0}
                    onClick={(e) => openAdd(e.currentTarget)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') openAdd(e.currentTarget as HTMLElement);
                    }}
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        px: 1.5,
                        py: 0.75,
                        borderRadius: '9999px',
                        border: `1px dashed ${ATLAS_PALETTE.slate30}`,
                        color: ATLAS_PALETTE.slate60,
                        fontFamily: MONO,
                        fontSize: 11.5,
                        cursor: 'pointer',
                        transition: 'background 150ms ease, border-color 150ms ease',
                        '&:hover': {
                            background: ATLAS_PALETTE.cloud,
                            borderColor: ATLAS_PALETTE.brandBlue,
                            color: ATLAS_PALETTE.brandBlue,
                        },
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 14 }}
                    >
                        add
                    </Box>
                    Add Filter
                </Box>
            </Box>

            {/* Add menu */}
            <Menu
                anchorEl={addAnchor}
                open={Boolean(addAnchor)}
                onClose={closeAdd}
                slotProps={{ paper: { sx: { minWidth: 200 } } }}
            >
                {ADD_OPTIONS.map((o) => (
                    <MenuItem
                        key={o.key}
                        onClick={(e) => {
                            setAddAnchor(null);
                            setEditingPill({ key: o.key, anchor: e.currentTarget });
                        }}
                        sx={{ fontSize: 13 }}
                    >
                        {o.label}
                    </MenuItem>
                ))}
            </Menu>

            {/* Edit pill menus */}
            <Menu
                anchorEl={editingPill?.anchor ?? null}
                open={editingPill?.key === 'type'}
                onClose={closeAdd}
                slotProps={{ paper: { sx: { minWidth: 200 } } }}
            >
                {TYPE_VALUES.map((t) => (
                    <MenuItem key={t} onClick={() => toggleType(t)} sx={{ fontSize: 13, gap: 1 }}>
                        <Checkbox
                            checked={filters.types.includes(t)}
                            size="small"
                            sx={{ p: 0.5 }}
                        />
                        {TYPE_LABEL[t]}
                    </MenuItem>
                ))}
            </Menu>

            <Menu
                anchorEl={editingPill?.anchor ?? null}
                open={editingPill?.key === 'project'}
                onClose={closeAdd}
                slotProps={{ paper: { sx: { minWidth: 240, maxHeight: 320 } } }}
            >
                <MenuItem
                    onClick={() => setProject(null)}
                    sx={{ fontSize: 13, fontStyle: 'italic', color: ATLAS_PALETTE.slate60 }}
                >
                    (any project)
                </MenuItem>
                {projects.map((p) => (
                    <MenuItem key={p.id} onClick={() => setProject(p.id)} sx={{ fontSize: 13 }}>
                        {p.name}
                    </MenuItem>
                ))}
            </Menu>

            <Menu
                anchorEl={editingPill?.anchor ?? null}
                open={editingPill?.key === 'updated'}
                onClose={closeAdd}
                slotProps={{ paper: { sx: { minWidth: 220 } } }}
            >
                <MenuItem
                    onClick={() => setUpdated('any')}
                    sx={{ fontSize: 13, fontStyle: 'italic', color: ATLAS_PALETTE.slate60 }}
                >
                    (any time)
                </MenuItem>
                {UPDATED_OPTIONS.map((o) => (
                    <MenuItem
                        key={o.value}
                        onClick={() => setUpdated(o.value)}
                        sx={{ fontSize: 13 }}
                    >
                        {o.label}
                    </MenuItem>
                ))}
            </Menu>

            <Menu
                anchorEl={editingPill?.anchor ?? null}
                open={editingPill?.key === 'status'}
                onClose={closeAdd}
                slotProps={{ paper: { sx: { minWidth: 220 } } }}
            >
                <MenuItem
                    onClick={() => setStatus('any')}
                    sx={{ fontSize: 13, fontStyle: 'italic', color: ATLAS_PALETTE.slate60 }}
                >
                    (any status)
                </MenuItem>
                {STATUS_OPTIONS.map((o) => (
                    <MenuItem
                        key={o.value}
                        onClick={() => setStatus(o.value)}
                        sx={{ fontSize: 13 }}
                    >
                        {o.label}
                    </MenuItem>
                ))}
            </Menu>

            <Menu
                anchorEl={editingPill?.anchor ?? null}
                open={editingPill?.key === 'labels'}
                onClose={closeAdd}
                slotProps={{ paper: { sx: { minWidth: 220, maxHeight: 320 } } }}
            >
                {availableLabels.length === 0 ? (
                    <MenuItem
                        disabled
                        sx={{ fontSize: 13, fontStyle: 'italic', color: ATLAS_PALETTE.slate60 }}
                    >
                        No labels exist yet
                    </MenuItem>
                ) : (
                    availableLabels.map((l) => (
                        <MenuItem
                            key={l}
                            onClick={() => toggleLabel(l)}
                            sx={{ fontSize: 13, gap: 1 }}
                        >
                            <Checkbox
                                checked={filters.labels.includes(l)}
                                size="small"
                                sx={{ p: 0.5 }}
                            />
                            {l}
                        </MenuItem>
                    ))
                )}
            </Menu>

            {/* Status row — count summary for the current filters */}
            <Box
                sx={{
                    mt: 3,
                    pt: 3,
                    borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    flexWrap: 'wrap',
                }}
            >
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 14, color: ATLAS_PALETTE.slate60 }}
                >
                    visibility
                </Box>
                <Typography
                    sx={{ fontFamily: MONO, fontSize: 11.5, color: ATLAS_PALETTE.slate60 }}
                >
                    Showing{' '}
                    <Box
                        component="b"
                        sx={{ color: ATLAS_PALETTE.slate, fontWeight: 600 }}
                    >
                        {resultCount} result{resultCount === 1 ? '' : 's'}
                    </Box>{' '}
                    across{' '}
                    <Box component="b" sx={{ color: ATLAS_PALETTE.slate, fontWeight: 600 }}>
                        {resultTypeCount} type{resultTypeCount === 1 ? '' : 's'}
                    </Box>
                </Typography>
            </Box>
        </Box>
    );
}
