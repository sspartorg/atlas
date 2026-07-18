import { memo, useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import AddRounded from '@mui/icons-material/AddRounded';
import { useNavigate } from 'react-router-dom';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { IEpicListItem, IProject, IAgent } from '@atlas/shared';
import { StatusChip } from './StatusChip.js';
import { ProjectTag } from './ProjectTag.js';
import { AgentChip } from './AgentChip.js';
import { LiveDot } from './LiveDot.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { MobileEpicList } from './MobileEpicList.js';
import { relativeTime } from '../utils/time.js';

export type EpicTablePageSize = 20 | 50 | 100 | 'all';

interface Props {
    rows: IEpicListItem[];
    projects: IProject[];
    agents: IAgent[];
    ownerName: string;
    ownerAccent: string;
    /** Optional callback wired to the empty-state "New Epic" button. When
     *  omitted the empty state shows just the message. */
    onCreate?: (() => void) | undefined;
    /** Controlled pagination. When omitted, the table uses its own internal
     *  state (default pageSize=20, page=1). Pass all four to control externally. */
    pageSize?: EpicTablePageSize;
    onPageSizeChange?: (size: EpicTablePageSize) => void;
    page?: number;
    onPageChange?: (page: number) => void;
}

type SortKey = 'id' | 'title' | 'updated' | null;
type SortDir = 'asc' | 'desc';

const HEADER_SX = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: ATLAS_PALETTE.slate60,
};

// Fixed column widths so virtualised rows (which fall outside the parent
// grid context) align with the header. Replaces the previous subgrid layout.
const GRID_TEMPLATE = '24px 80px 1fr 80px 110px 110px 100px 100px';
const ROW_HEIGHT_PX = 64;
const VIRTUALIZE_THRESHOLD = 60;

function SortableHeader({
    label,
    sortKey,
    current,
    dir,
    onChange,
    align,
}: {
    label: string;
    sortKey: SortKey;
    current: SortKey;
    dir: SortDir;
    onChange: (k: SortKey) => void;
    align?: 'left' | 'right';
}) {
    const active = current === sortKey;
    // v8 ignore reason (lines below): SortableHeader is a local, non-exported
    // helper called only 3 times in this file (id/title/updated headers),
    // always with a concrete literal key. The `SortKey | null` signature
    // exists to match the exported `SortKey` type; the null-safety branches
    // it enables are unreachable with the current call sites.
    return (
        <Box
            /* v8 ignore next */
            onClick={() => sortKey && onChange(sortKey)}
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                /* v8 ignore next */
                cursor: sortKey ? 'pointer' : 'default',
                userSelect: 'none',
                justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
            }}
        >
            <Typography sx={HEADER_SX}>{label}</Typography>
            {/* v8 ignore next -- sortKey is always truthy at this component's 3 call sites, see reason above SortableHeader's return */}
            {sortKey && (
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{
                        fontSize: 14,
                        color: active ? ATLAS_PALETTE.slate60 : ATLAS_PALETTE.slate30,
                    }}
                >
                    {active && dir === 'asc' ? 'arrow_drop_up' : 'arrow_drop_down'}
                </Box>
            )}
        </Box>
    );
}

interface EpicRowProps {
    row: IEpicListItem;
    project: IProject | undefined;
    reporter: IAgent | null;
    assignee: IAgent | null;
    ownerName: string;
    ownerAccent: string;
    isLast: boolean;
    onOpen: (id: string) => void;
    style?: React.CSSProperties;
}

const EpicRow = memo(function EpicRow({
    row,
    project,
    reporter,
    assignee,
    ownerName,
    ownerAccent,
    isLast,
    onOpen,
    style,
}: EpicRowProps) {
    return (
        <Box
            onClick={() => onOpen(row.id)}
            style={style}
            sx={{
                display: 'grid',
                gridTemplateColumns: GRID_TEMPLATE,
                columnGap: 3,
                alignItems: 'center',
                px: 5,
                height: ROW_HEIGHT_PX,
                borderBottom: isLast ? 'none' : `1px solid ${ATLAS_PALETTE.slate06}`,
                cursor: 'pointer',
                transition: 'background 120ms ease',
                '&:hover': { background: ATLAS_PALETTE.cloud },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {row.status === 'in_progress' && <LiveDot />}
            </Box>
            <Typography
                sx={{
                    fontSize: 12,
                    fontFamily: '"JetBrains Mono", monospace',
                    color: ATLAS_PALETTE.slate60,
                }}
            >
                {row.id}
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 18, color: ATLAS_PALETTE.cerulean, flexShrink: 0 }}
                >
                    flag
                </Box>
                <Typography
                    sx={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: ATLAS_PALETTE.slate,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flexShrink: 1,
                        minWidth: 0,
                    }}
                >
                    {row.title}
                </Typography>
                {project && <ProjectTag projectId={project.id} name={project.name} clickable />}
            </Box>

            <Typography
                sx={{
                    fontSize: 13,
                    fontFamily: '"JetBrains Mono", monospace',
                    color: ATLAS_PALETTE.slate,
                    textAlign: 'center',
                }}
            >
                {row.story_count}
            </Typography>

            {reporter ? (
                <AgentChip agent={reporter} size="sm" layout="stacked" />
            ) : (
                <AgentChip
                    agent={{ name: ownerName, accent_color: ownerAccent }}
                    size="sm"
                    layout="stacked"
                />
            )}

            {assignee ? (
                <AgentChip agent={assignee} size="sm" layout="stacked" />
            ) : (
                <AgentChip
                    agent={{ name: ownerName, accent_color: ownerAccent }}
                    size="sm"
                    layout="stacked"
                />
            )}

            <Box>
                <StatusChip status={row.status} size="sm" />
            </Box>

            <Typography
                sx={{
                    fontSize: 12,
                    color: ATLAS_PALETTE.slate60,
                    textAlign: 'right',
                    fontFamily: '"JetBrains Mono", monospace',
                }}
            >
                {relativeTime(row.updated_at)}
            </Typography>
        </Box>
    );
});

// Virtualised body — used only when rows.length >= VIRTUALIZE_THRESHOLD.
// Window-scroll mode keeps the rest of the page chrome unaffected.
interface VirtualBodyProps {
    rows: IEpicListItem[];
    projectsById: Map<string, IProject>;
    agentsById: Map<string, IAgent>;
    ownerName: string;
    ownerAccent: string;
    onOpen: (id: string) => void;
}

function VirtualBody({
    rows,
    projectsById,
    agentsById,
    ownerName,
    ownerAccent,
    onOpen,
}: VirtualBodyProps) {
    const parentRef = useRef<HTMLDivElement | null>(null);
    const virtualizer = useWindowVirtualizer({
        count: rows.length,
        estimateSize: () => ROW_HEIGHT_PX,
        overscan: 8,
        scrollMargin: parentRef.current?.offsetTop ?? 0,
    });

    const items = virtualizer.getVirtualItems();
    const totalHeight = virtualizer.getTotalSize();
    const offsetTop = parentRef.current?.offsetTop ?? 0;

    return (
        <Box ref={parentRef} sx={{ position: 'relative', height: totalHeight, width: '100%' }}>
            {items.map((vi) => {
                const row = rows[vi.index];
                /* v8 ignore next -- useWindowVirtualizer only ever yields indices within [0, count), so rows[vi.index] is always defined; defensive guard against a future virtualizer version changing that invariant. */
                if (!row) return null;
                return (
                    <EpicRow
                        key={row.id}
                        row={row}
                        project={projectsById.get(row.project_id)}
                        reporter={
                            row.reporter_agent_id
                                ? (agentsById.get(row.reporter_agent_id) ?? null)
                                : null
                        }
                        assignee={
                            row.assignee_agent_id
                                ? (agentsById.get(row.assignee_agent_id) ?? null)
                                : null
                        }
                        ownerName={ownerName}
                        ownerAccent={ownerAccent}
                        isLast={vi.index === rows.length - 1}
                        onOpen={onOpen}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            transform: `translateY(${vi.start - offsetTop}px)`,
                        }}
                    />
                );
            })}
        </Box>
    );
}

export function EpicTable({
    rows,
    projects,
    agents,
    ownerName,
    ownerAccent,
    onCreate,
    pageSize: pageSizeProp,
    onPageSizeChange,
    page: pageProp,
    onPageChange,
}: Props) {
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const [sortKey, setSortKey] = useState<SortKey>('updated');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [internalPageSize, setInternalPageSize] = useState<EpicTablePageSize>(20);
    const [internalPage, setInternalPage] = useState(1);
    const pageSize: EpicTablePageSize = pageSizeProp ?? internalPageSize;
    const page = pageProp ?? internalPage;
    const setPageSize = useCallback(
        (next: EpicTablePageSize) => {
            if (onPageSizeChange) onPageSizeChange(next);
            else setInternalPageSize(next);
        },
        [onPageSizeChange],
    );
    const setPage = useCallback(
        (next: number) => {
            if (onPageChange) onPageChange(next);
            else setInternalPage(next);
        },
        [onPageChange],
    );

    // All hooks must run on every render — keep the isMobile branch BELOW them,
    // otherwise crossing the breakpoint changes the hook count and React aborts
    // with "Rendered fewer hooks than expected".
    const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
    const agentsById = useMemo(() => new Map(agents.map((w) => [w.id, w])), [agents]);

    const sorted = useMemo(() => {
        const arr = [...rows];
        /* v8 ignore next -- sortKey state is seeded 'updated' and setSortKey is only ever called with a concrete key from toggleSort's guarded branch, so it never becomes null in this component. */
        if (!sortKey) return arr;
        arr.sort((a, b) => {
            let cmp = 0;
            /* v8 ignore start -- sortKey is 'id' | 'title' | 'updated' here (null already returned above), so this if/else-if/else-if chain is exhaustive; the implicit "none matched" fall-through on the final else-if is unreachable. */
            if (sortKey === 'id') {
                cmp = a.id.localeCompare(b.id, undefined, { numeric: true });
            } else if (sortKey === 'title') {
                cmp = a.title.localeCompare(b.title);
            } else if (sortKey === 'updated') {
                cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
            }
            /* v8 ignore stop */
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return arr;
    }, [rows, sortKey, sortDir]);

    // Stable per-row click handler so EpicRow memo bails across parent renders.
    const handleOpen = useCallback((id: string) => navigate(`/epics/${id}`), [navigate]);

    if (isMobile) {
        return (
            <MobileEpicList
                rows={rows}
                projects={projects}
                agents={agents}
                ownerName={ownerName}
                ownerAccent={ownerAccent}
            />
        );
    }

    function toggleSort(k: SortKey) {
        /* v8 ignore next -- toggleSort is only invoked as SortableHeader's onChange, which itself only fires with a truthy key (see SortableHeader's onClick guard). */
        if (!k) return;
        if (sortKey === k) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(k);
            setSortDir(k === 'updated' ? 'desc' : 'asc');
        }
    }

    const numericPageSize = pageSize === 'all' ? sorted.length : pageSize;
    const pageCount =
        pageSize === 'all' ? 1 : Math.max(1, Math.ceil(sorted.length / numericPageSize));
    const clampedPage = Math.min(Math.max(1, page), pageCount);
    const pageRows =
        pageSize === 'all'
            ? sorted
            : sorted.slice((clampedPage - 1) * numericPageSize, clampedPage * numericPageSize);
    const shouldVirtualize = pageSize === 'all' && sorted.length >= VIRTUALIZE_THRESHOLD;

    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                overflow: 'hidden',
            }}
        >
            <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 920 }}>
                    {/* Header — same fixed template as the body rows. */}
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: GRID_TEMPLATE,
                            columnGap: 3,
                            alignItems: 'center',
                            px: 5,
                            py: 2.5,
                            background: ATLAS_PALETTE.slate08,
                            borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                        }}
                    >
                        <Box />
                        <SortableHeader
                            label="ID"
                            sortKey="id"
                            current={sortKey}
                            dir={sortDir}
                            onChange={toggleSort}
                        />
                        <SortableHeader
                            label="Epic"
                            sortKey="title"
                            current={sortKey}
                            dir={sortDir}
                            onChange={toggleSort}
                        />
                        <Typography sx={{ ...HEADER_SX, textAlign: 'center' }}>Stories</Typography>
                        <Typography sx={HEADER_SX}>Reporter</Typography>
                        <Typography sx={HEADER_SX}>Assignee</Typography>
                        <Typography sx={HEADER_SX}>Status</Typography>
                        <SortableHeader
                            label="Updated"
                            sortKey="updated"
                            current={sortKey}
                            dir={sortDir}
                            onChange={toggleSort}
                            align="right"
                        />
                    </Box>

                    {sorted.length === 0 ? (
                        <Box sx={{ py: 16, textAlign: 'center' }}>
                            <Typography
                                sx={{ fontSize: 13, color: ATLAS_PALETTE.slate40, mb: 3 }}
                            >
                                No epics match this view.
                            </Typography>
                            {onCreate && (
                                <Button
                                    variant="contained"
                                    color="success"
                                    startIcon={<AddRounded />}
                                    onClick={onCreate}
                                    sx={{ textTransform: 'none', fontWeight: 600 }}
                                >
                                    New Epic
                                </Button>
                            )}
                        </Box>
                    ) : shouldVirtualize ? (
                        <VirtualBody
                            rows={pageRows}
                            projectsById={projectsById}
                            agentsById={agentsById}
                            ownerName={ownerName}
                            ownerAccent={ownerAccent}
                            onOpen={handleOpen}
                        />
                    ) : (
                        pageRows.map((row, i) => (
                            <EpicRow
                                key={row.id}
                                row={row}
                                project={projectsById.get(row.project_id)}
                                reporter={
                                    row.reporter_agent_id
                                        ? (agentsById.get(row.reporter_agent_id) ?? null)
                                        : null
                                }
                                assignee={
                                    row.assignee_agent_id
                                        ? (agentsById.get(row.assignee_agent_id) ?? null)
                                        : null
                                }
                                ownerName={ownerName}
                                ownerAccent={ownerAccent}
                                isLast={i === pageRows.length - 1}
                                onOpen={handleOpen}
                            />
                        ))
                    )}
                </Box>
            </Box>
            {sorted.length > 0 && (
                <PaginationFooter
                    page={clampedPage}
                    pageCount={pageCount}
                    pageSize={pageSize}
                    totalRows={sorted.length}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                />
            )}
        </Box>
    );
}

interface PaginationFooterProps {
    page: number;
    pageCount: number;
    pageSize: EpicTablePageSize;
    totalRows: number;
    onPageChange: (next: number) => void;
    onPageSizeChange: (next: EpicTablePageSize) => void;
}

function PaginationFooter({
    page,
    pageCount,
    pageSize,
    totalRows,
    onPageChange,
    onPageSizeChange,
}: PaginationFooterProps) {
    const navBtnSx = {
        minWidth: 28,
        height: 28,
        px: 1,
        fontSize: 14,
        color: ATLAS_PALETTE.slate60,
        borderColor: ATLAS_PALETTE.slate10,
        '&:hover': {
            borderColor: ATLAS_PALETTE.slate30,
            background: ATLAS_PALETTE.slate06,
        },
        '&.Mui-disabled': { color: ATLAS_PALETTE.slate30 },
    } as const;
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                px: 5,
                py: 2,
                borderTop: `1px solid ${ATLAS_PALETTE.slate10}`,
                background: ATLAS_PALETTE.slate06,
                fontSize: 12,
                color: ATLAS_PALETTE.slate60,
            }}
        >
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                {totalRows} epic{totalRows === 1 ? '' : 's'} · page {page} of {pageCount}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Box
                component="label"
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: 12 }}
            >
                <span>Rows</span>
                <Box
                    component="select"
                    value={pageSize === 'all' ? 'all' : String(pageSize)}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                        const v = e.target.value;
                        const next: EpicTablePageSize =
                            v === 'all' ? 'all' : (Number(v) as 20 | 50 | 100);
                        onPageSizeChange(next);
                    }}
                    sx={{
                        height: 28,
                        px: 1.5,
                        borderRadius: '8px',
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        background: ATLAS_PALETTE.white,
                        color: ATLAS_PALETTE.slate,
                        fontSize: 12,
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                    }}
                >
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="all">all</option>
                </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button
                    variant="outlined"
                    size="small"
                    sx={navBtnSx}
                    disabled={page <= 1}
                    onClick={() => onPageChange(1)}
                >
                    «
                </Button>
                <Button
                    variant="outlined"
                    size="small"
                    sx={navBtnSx}
                    disabled={page <= 1}
                    onClick={() => onPageChange(page - 1)}
                >
                    ‹
                </Button>
                <Button
                    variant="outlined"
                    size="small"
                    sx={navBtnSx}
                    disabled={page >= pageCount}
                    onClick={() => onPageChange(page + 1)}
                >
                    ›
                </Button>
                <Button
                    variant="outlined"
                    size="small"
                    sx={navBtnSx}
                    disabled={page >= pageCount}
                    onClick={() => onPageChange(pageCount)}
                >
                    »
                </Button>
            </Box>
        </Box>
    );
}
