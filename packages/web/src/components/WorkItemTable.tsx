import { memo, useCallback, useRef, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { IssueStatus, IssueType, IAgent, SubTaskStatus } from '@atlas/shared';
import { StatusChip } from './StatusChip.js';
import { AgentChip } from './AgentChip.js';
import { KindIcon } from './KindIcon.js';
import { LiveDot } from './LiveDot.js';
import { SortableHeader, type SortDir } from './filterPrimitives.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { MobileWorkItemList } from './MobileWorkItemList.js';

const MONO = '"JetBrains Mono", monospace';

// Fixed column widths so virtualised rows (which fall outside the parent
// grid context) align with the header. The previous design used
// `gridTemplateColumns: subgrid` to share `auto` tracks across the header
// and body, but virtualisation requires absolutely-positioned rows that
// cannot participate in the parent grid.
function buildGridTemplate(showLiveDot: boolean, hasAction: boolean): string {
    const cols: string[] = [];
    if (showLiveDot) cols.push('24px');
    cols.push('88px');   // ID
    cols.push('1fr');    // Title
    cols.push('140px');  // Reporter — bumped from 110px; longer agent
    cols.push('140px');  // Assignee — labels (e.g. "Architect Reviewer ·
    cols.push('100px');  // Status   — Software Architect") were overflowing
    cols.push('80px');   // Updated  — into the Status column.
    if (hasAction) cols.push('32px');
    return cols.join(' ');
}

const ROW_HEIGHT_PX = 56;
const VIRTUALIZE_THRESHOLD = 60;

const HEADER_SX = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: ATLAS_PALETTE.slate60,
};

export type WorkItemSortKey = 'id' | 'title' | 'updated' | 'status';

export interface WorkItemTableRow {
    id: string;
    kind: IssueType;
    shortId: string;
    title: string;
    status: IssueStatus | SubTaskStatus;
    assignee_agent_id: string | null;
    reporter_agent_id: string | null;
    updated_at: string;
    // When true, this row is rendered as a child of the previous top-level row
    // (sub-task/sub-bug under a story): indented with a horizontal connector
    // line and a slightly tinted background.
    isChild?: boolean;
}

interface SortSpec {
    current: WorkItemSortKey;
    dir: SortDir;
    onChange: (k: WorkItemSortKey) => void;
    sortable: ReadonlySet<WorkItemSortKey>;
}

interface Props {
    title?: string;
    rows: WorkItemTableRow[];
    agentsById: Map<string, IAgent>;
    ownerName: string;
    ownerAccent: string;
    onRowClick: (row: WorkItemTableRow) => void;
    formatRelative: (iso: string) => string;
    emptyMessage?: string | undefined;
    headerRight?: ReactNode;
    rowAction?: (row: WorkItemTableRow) => ReactNode;
    showLiveDot?: boolean;
    sort?: SortSpec;
    /** Render nothing when `rows.length === 0`. Used on detail pages where
     *  the parent's `+` menu provides the add path, so an empty
     *  sub-items / blocked-by / relates-to section just adds noise. */
    hideWhenEmpty?: boolean;
}

// Memo'd row — only re-renders when its own props change. Parent re-renders
// (sort change, sibling state, SSE invalidation of an unrelated query) no
// longer reconcile every row's children.
interface WorkItemRowProps {
    row: WorkItemTableRow;
    reporter: IAgent | null;
    assignee: IAgent | null;
    ownerName: string;
    ownerAccent: string;
    showLiveDot: boolean;
    rowAction: ((row: WorkItemTableRow) => ReactNode) | undefined;
    onClick: (row: WorkItemTableRow) => void;
    formatRelative: (iso: string) => string;
    gridTemplate: string;
    // When set, absolutely positions the row at the given `translateY` for
    // the window-virtualiser. Omitted for non-virtualised render paths.
    style?: React.CSSProperties;
}

const WorkItemRow = memo(function WorkItemRow({
    row,
    reporter,
    assignee,
    ownerName,
    ownerAccent,
    showLiveDot,
    rowAction,
    onClick,
    formatRelative,
    gridTemplate,
    style,
}: WorkItemRowProps) {
    const isLive = row.status === 'in_progress';
    const isChild = row.isChild === true;
    return (
        <Box
            role="button"
            onClick={() => onClick(row)}
            style={style}
            sx={{
                display: 'grid',
                gridTemplateColumns: gridTemplate,
                columnGap: 3,
                alignItems: 'center',
                px: 5,
                height: ROW_HEIGHT_PX,
                borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                cursor: 'pointer',
                background: isChild ? 'rgba(46,46,46,.015)' : ATLAS_PALETTE.white,
                transition: 'background 120ms ease',
                '&:hover': { background: ATLAS_PALETTE.cloud },
            }}
        >
            {showLiveDot ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isLive && <LiveDot />}
                </Box>
            ) : null}

            <Typography sx={{ fontFamily: MONO, fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                {row.shortId}
            </Typography>

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    minWidth: 0,
                    pl: isChild ? 4 : 0,
                }}
            >
                {isChild && (
                    <Box
                        component="span"
                        sx={{
                            width: 12,
                            height: 1,
                            background: ATLAS_PALETTE.slate12,
                            flexShrink: 0,
                        }}
                    />
                )}
                <KindIcon kind={row.kind} size={14} />
                <Typography
                    sx={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: ATLAS_PALETTE.slate,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {row.title}
                </Typography>
            </Box>

            <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
                {reporter ? (
                    <AgentChip agent={reporter} size="sm" layout="stacked" />
                ) : (
                    <AgentChip
                        agent={{ name: ownerName, accent_color: ownerAccent }}
                        size="sm"
                        layout="stacked"
                    />
                )}
            </Box>

            <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
                {assignee ? (
                    <AgentChip agent={assignee} size="sm" layout="stacked" />
                ) : (
                    <AgentChip
                        agent={{ name: ownerName, accent_color: ownerAccent }}
                        size="sm"
                        layout="stacked"
                    />
                )}
            </Box>

            <Box>
                <StatusChip status={row.status} size="sm" />
            </Box>

            <Typography
                sx={{
                    fontFamily: MONO,
                    fontSize: 12,
                    color: ATLAS_PALETTE.slate60,
                    textAlign: 'right',
                }}
            >
                {formatRelative(row.updated_at)}
            </Typography>

            {rowAction ? (
                <Box
                    sx={{ display: 'flex', justifyContent: 'flex-end' }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {rowAction(row)}
                </Box>
            ) : null}
        </Box>
    );
});

// Virtualised body — used only when rows.length >= VIRTUALIZE_THRESHOLD.
// Renders only the rows currently in view (+ overscan), positioned absolutely
// inside a tall placeholder element. Keeps the page as the scroll container
// so the rest of the page chrome is unaffected.
interface VirtualBodyProps {
    rows: WorkItemTableRow[];
    agentsById: Map<string, IAgent>;
    ownerName: string;
    ownerAccent: string;
    showLiveDot: boolean;
    rowAction: ((row: WorkItemTableRow) => ReactNode) | undefined;
    onRowClick: (row: WorkItemTableRow) => void;
    formatRelative: (iso: string) => string;
    gridTemplate: string;
}

function VirtualBody({
    rows,
    agentsById,
    ownerName,
    ownerAccent,
    showLiveDot,
    rowAction,
    onRowClick,
    formatRelative,
    gridTemplate,
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
        <Box
            ref={parentRef}
            sx={{
                position: 'relative',
                height: totalHeight,
                width: '100%',
            }}
        >
            {items.map((vi) => {
                const row = rows[vi.index];
                /* v8 ignore next -- useWindowVirtualizer only ever yields indices within [0, count), so rows[vi.index] is always defined; defensive guard against a future virtualizer version changing that invariant. */
                if (!row) return null;
                const reporter = row.reporter_agent_id
                    ? (agentsById.get(row.reporter_agent_id) ?? null)
                    : null;
                const assignee = row.assignee_agent_id
                    ? (agentsById.get(row.assignee_agent_id) ?? null)
                    : null;
                return (
                    <WorkItemRow
                        key={`${row.kind}-${row.id}`}
                        row={row}
                        reporter={reporter}
                        assignee={assignee}
                        ownerName={ownerName}
                        ownerAccent={ownerAccent}
                        showLiveDot={showLiveDot}
                        rowAction={rowAction}
                        onClick={onRowClick}
                        formatRelative={formatRelative}
                        gridTemplate={gridTemplate}
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

export function WorkItemTable({
    title,
    rows,
    agentsById,
    ownerName,
    ownerAccent,
    onRowClick,
    formatRelative,
    emptyMessage,
    headerRight,
    rowAction,
    showLiveDot,
    sort,
    hideWhenEmpty,
}: Props) {
    const isMobile = useIsMobile();
    const gridTemplate = buildGridTemplate(showLiveDot === true, rowAction !== undefined);

    // Stable click handler so memo'd rows bail across parent re-renders.
    // Hooks must run before any early return, otherwise the hook count
    // changes when `hideWhenEmpty` flips from "empty → null" to "non-empty →
    // table" (e.g. after a link is added) and React aborts the page.
    const handleRowClick = useCallback(
        (row: WorkItemTableRow) => onRowClick(row),
        [onRowClick],
    );

    if (hideWhenEmpty === true && rows.length === 0) return null;

    if (isMobile) {
        return (
            <MobileWorkItemList
                {...(title !== undefined ? { title } : {})}
                rows={rows}
                agentsById={agentsById}
                ownerName={ownerName}
                ownerAccent={ownerAccent}
                onRowClick={onRowClick}
                emptyMessage={emptyMessage}
                headerRight={headerRight}
            />
        );
    }

    function renderHeader(key: WorkItemSortKey, label: string, align?: 'left' | 'right') {
        if (sort && sort.sortable.has(key)) {
            return (
                <SortableHeader<WorkItemSortKey>
                    label={label}
                    sortKey={key}
                    current={sort.current}
                    dir={sort.dir}
                    onChange={sort.onChange}
                    align={align}
                />
            );
        }
        return <Typography sx={{ ...HEADER_SX, textAlign: align ?? 'left' }}>{label}</Typography>;
    }

    const shouldVirtualize = rows.length >= VIRTUALIZE_THRESHOLD;

    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                overflow: 'hidden',
            }}
        >
            {title !== undefined && (
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        px: 5,
                        py: 3,
                        borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                    }}
                >
                    <Typography
                        sx={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate60,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                        }}
                    >
                        {title}
                    </Typography>
                    <Typography sx={{ fontSize: 12, fontFamily: MONO, color: ATLAS_PALETTE.slate40 }}>
                        · {rows.length}
                    </Typography>
                    {headerRight ? <Box sx={{ ml: 'auto' }}>{headerRight}</Box> : null}
                </Box>
            )}

            <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: showLiveDot ? 880 : 800 }}>
                    {/* Header row — fixed widths matching the body rows. */}
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: gridTemplate,
                            columnGap: 3,
                            alignItems: 'center',
                            px: 5,
                            py: 2.5,
                            background: ATLAS_PALETTE.slate08,
                            borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                        }}
                    >
                        {showLiveDot ? <Box /> : null}
                        {renderHeader('id', 'ID')}
                        {renderHeader('title', 'Issue')}
                        <Typography sx={HEADER_SX}>Reporter</Typography>
                        <Typography sx={HEADER_SX}>Assignee</Typography>
                        {renderHeader('status', 'Status')}
                        {renderHeader('updated', 'Updated', 'right')}
                        {rowAction ? <Box /> : null}
                    </Box>

                    {rows.length === 0 ? (
                        <Box sx={{ py: 14, textAlign: 'center' }}>
                            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                                {emptyMessage ?? (title ? `No ${title.toLowerCase()} yet.` : 'No items.')}
                            </Typography>
                        </Box>
                    ) : shouldVirtualize ? (
                        <VirtualBody
                            rows={rows}
                            agentsById={agentsById}
                            ownerName={ownerName}
                            ownerAccent={ownerAccent}
                            showLiveDot={showLiveDot === true}
                            rowAction={rowAction}
                            onRowClick={handleRowClick}
                            formatRelative={formatRelative}
                            gridTemplate={gridTemplate}
                        />
                    ) : (
                        rows.map((row) => {
                            const reporter = row.reporter_agent_id
                                ? (agentsById.get(row.reporter_agent_id) ?? null)
                                : null;
                            const assignee = row.assignee_agent_id
                                ? (agentsById.get(row.assignee_agent_id) ?? null)
                                : null;
                            return (
                                <WorkItemRow
                                    key={`${row.kind}-${row.id}`}
                                    row={row}
                                    reporter={reporter}
                                    assignee={assignee}
                                    ownerName={ownerName}
                                    ownerAccent={ownerAccent}
                                    showLiveDot={showLiveDot === true}
                                    rowAction={rowAction}
                                    onClick={handleRowClick}
                                    formatRelative={formatRelative}
                                    gridTemplate={gridTemplate}
                                />
                            );
                        })
                    )}
                </Box>
            </Box>
        </Box>
    );
}
