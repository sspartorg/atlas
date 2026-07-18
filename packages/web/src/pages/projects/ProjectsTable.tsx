import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { InitialAvatar } from '../../components/InitialAvatar.js';
import { ProjectRowMenu } from './ProjectRowMenu.js';

const MONO_FONT = '"JetBrains Mono", monospace';

export interface ProjectRow {
    id: string;
    displayId: string;
    name: string;
    gitPath: string;
    epics: number;
    stories: number;
    lastActivity: string;
    updatedAt: string;
}

type SortKey = keyof ProjectRow;
type SortDir = 'asc' | 'desc';

interface IProjectsTableProps {
    rows: ProjectRow[];
    ownerName: string;
    scheduleMap?: Map<string, { preset: string; next_run_at: string | null }>;
    onRowClick: (id: string) => void;
    onOpen: (id: string) => void;
    onCopyUrl: (id: string) => void;
    onReclone: (id: string) => void;
    onDelete: (id: string) => void;
    onScheduleFetch: (id: string) => void;
}

type ColumnKey = SortKey | 'owner' | 'actions';

interface IColumn {
    key: ColumnKey;
    label: string;
    sortable?: boolean;
}

const COLUMNS: IColumn[] = [
    { key: 'displayId', label: 'ID' },
    { key: 'name', label: 'Project' },
    { key: 'gitPath', label: 'Repo URL' },
    { key: 'epics', label: 'Epics' },
    { key: 'stories', label: 'Stories' },
    { key: 'lastActivity', label: 'Last Activity' },
    { key: 'owner', label: 'Owner', sortable: false },
    { key: 'actions', label: '', sortable: false },
];

function compare(a: ProjectRow, b: ProjectRow, key: SortKey, dir: SortDir): number {
    let av: string | number;
    let bv: string | number;
    if (key === 'lastActivity') {
        av = new Date(a.updatedAt).getTime();
        bv = new Date(b.updatedAt).getTime();
    } else {
        const ax = a[key];
        const bx = b[key];
        av = typeof ax === 'number' ? ax : String(ax);
        bv = typeof bx === 'number' ? bx : String(bx);
    }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
}

export function ProjectsTable({
    rows,
    ownerName,
    scheduleMap,
    onRowClick,
    onOpen,
    onCopyUrl,
    onReclone,
    onDelete,
    onScheduleFetch,
}: IProjectsTableProps) {
    const [sortKey, setSortKey] = useState<SortKey>('lastActivity');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    const sorted = useMemo(() => {
        const copy = [...rows];
        copy.sort((a, b) => compare(a, b, sortKey, sortDir));
        return copy;
    }, [rows, sortKey, sortDir]);

    function handleSort(key: SortKey) {
        if (key === sortKey) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir('asc');
        }
    }

    return (
        <Paper
            elevation={0}
            sx={{
                borderRadius: '12px',
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                overflow: 'hidden',
                bgcolor: 'background.paper',
            }}
        >
            <Box sx={{ overflowX: 'auto' }}>
            <Table sx={{ minWidth: 980 }}>
                <TableHead>
                    <TableRow sx={{ bgcolor: ATLAS_PALETTE.white }}>
                        {COLUMNS.map((col) => {
                            const isSortable = col.sortable !== false;
                            const isActive = isSortable && sortKey === col.key;
                            return (
                                <TableCell
                                    key={col.key}
                                    align="left"
                                    sx={{
                                        textTransform: 'uppercase',
                                        fontSize: '0.6875rem',
                                        fontWeight: 600,
                                        letterSpacing: '0.08em',
                                        color: ATLAS_PALETTE.slate60,
                                        p: 4,
                                        borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                                    }}
                                >
                                    {isSortable ? (
                                        <TableSortLabel
                                            active={isActive}
                                            direction={isActive ? sortDir : 'asc'}
                                            onClick={() => handleSort(col.key as SortKey)}
                                            sx={{
                                                color: 'inherit !important',
                                                '& .MuiTableSortLabel-icon': {
                                                    opacity: 1,
                                                    color: ATLAS_PALETTE.slate40,
                                                },
                                                '&.Mui-active .MuiTableSortLabel-icon': {
                                                    color: ATLAS_PALETTE.slate,
                                                },
                                            }}
                                        >
                                            {col.label}
                                        </TableSortLabel>
                                    ) : (
                                        col.label
                                    )}
                                </TableCell>
                            );
                        })}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {sorted.map((row) => (
                        <TableRow
                            key={row.id}
                            hover={false}
                            onClick={() => onRowClick(row.id)}
                            sx={{
                                cursor: 'pointer',
                                transition: 'background 150ms ease',
                                '&:hover': { bgcolor: ATLAS_PALETTE.cloud },
                                '&:not(:last-of-type) td': {
                                    borderBottom: `1px solid ${ATLAS_PALETTE.slate08}`,
                                },
                                '&:last-of-type td': { borderBottom: 'none' },
                            }}
                        >
                            <TableCell
                                sx={{
                                    p: 4,
                                    fontFamily: MONO_FONT,
                                    fontSize: 13,
                                    color: ATLAS_PALETTE.slate60,
                                }}
                            >
                                {row.displayId}
                            </TableCell>
                            <TableCell
                                sx={{
                                    p: 4,
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate,
                                }}
                            >
                                <Stack direction="row" alignItems="center" spacing={1}>
                                    <span>{row.name}</span>
                                    {(() => {
                                        const sched = scheduleMap?.get(row.id);
                                        if (!sched) return null;
                                        const nextRun = sched.next_run_at
                                            ? ` · next ${new Date(sched.next_run_at).toLocaleString()}`
                                            : '';
                                        return (
                                            <Tooltip
                                                title={`Auto-fetch: ${sched.preset}${nextRun}`}
                                            >
                                                <ScheduleRounded
                                                    aria-label="Auto-fetch enabled"
                                                    sx={{
                                                        fontSize: 14,
                                                        color: ATLAS_PALETTE.success,
                                                    }}
                                                />
                                            </Tooltip>
                                        );
                                    })()}
                                </Stack>
                            </TableCell>
                            <TableCell
                                sx={{
                                    p: 4,
                                    fontFamily: MONO_FONT,
                                    fontSize: 13,
                                    color: ATLAS_PALETTE.slate60,
                                    maxWidth: 280,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {row.gitPath || '—'}
                            </TableCell>
                            <TableCell sx={{ p: 4, fontSize: 14, color: ATLAS_PALETTE.slate }}>
                                {row.epics}
                            </TableCell>
                            <TableCell sx={{ p: 4, fontSize: 14, color: ATLAS_PALETTE.slate }}>
                                {row.stories}
                            </TableCell>
                            <TableCell sx={{ p: 4, fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                                {row.lastActivity}
                            </TableCell>
                            <TableCell sx={{ p: 4 }}>
                                <Stack direction="row" alignItems="center" spacing={1.5}>
                                    <InitialAvatar
                                        name={ownerName}
                                        color={ATLAS_PALETTE.slate}
                                        size={20}
                                        fontSize={11}
                                        fontWeight={600}
                                    />
                                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate }}>
                                        {ownerName}
                                    </Typography>
                                </Stack>
                            </TableCell>
                            <TableCell
                                sx={{ p: 4, width: 56 }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <ProjectRowMenu
                                    onOpen={() => onOpen(row.id)}
                                    onCopyUrl={() => onCopyUrl(row.id)}
                                    onReclone={() => onReclone(row.id)}
                                    onDelete={() => onDelete(row.id)}
                                    onScheduleFetch={() => onScheduleFetch(row.id)}
                                />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            </Box>
            {sorted.length === 0 && (
                <Box sx={{ p: 8, textAlign: 'center', color: ATLAS_PALETTE.slate40 }}>
                    No projects match this filter.
                </Box>
            )}
        </Paper>
    );
}
