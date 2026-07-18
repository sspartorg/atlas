import { useMemo, useState, type DragEvent } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
    ISSUE_STATUSES,
    STATUS_LABELS,
    getValidNextStatuses,
    type IssueStatus,
    type IssueType,
    type IAgent,
} from '@atlas/shared';
import { KindIcon } from './KindIcon.js';
import { LiveDot } from './LiveDot.js';
import { AgentChip } from './AgentChip.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { ATLAS_PALETTE, STATUS_PALETTE } from '../theme/tokens.js';

export interface KanbanItem {
    id: string;
    kind: IssueType;
    shortId: string;
    title: string;
    status: IssueStatus;
    assignee_agent_id: string | null;
}

interface Props {
    items: KanbanItem[];
    agents: IAgent[];
    ownerName: string;
    ownerAccent: string;
    /** Called when a card is dropped on a column. `override` is true when the
     *  drop target is not a valid forward transition — the API call bypasses
     *  the state machine (matches the detail-page "Override" picker, which
     *  also lets the Owner move an item to any status). */
    onTransition: (item: KanbanItem, nextStatus: IssueStatus, override: boolean) => void;
    onOpen: (item: KanbanItem) => void;
}

const COLUMN_ORDER: IssueStatus[] = [...ISSUE_STATUSES];

function ColumnHeader({ status, count }: { status: IssueStatus; count: number }) {
    const cfg = STATUS_PALETTE[status];
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                py: 1,
                px: 1.5,
                borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
            }}
        >
            {/* Single mid-tone `.dot` colour — the previous pastel-bg +
                tonal-fg border combo read as washy at 8px. The dot now
                reads as a recognisable colour on both light and dark
                column headers. */}
            <Box
                sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '9999px',
                    /* v8 ignore next -- every IssueStatus in COLUMN_ORDER has a STATUS_PALETTE entry with a dot; defensive fallback only */
                    background: cfg?.dot ?? ATLAS_PALETTE.slate40,
                    flexShrink: 0,
                }}
            />
            <Typography
                sx={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: ATLAS_PALETTE.slate60,
                    flex: 1,
                }}
            >
                {STATUS_LABELS[status]}
            </Typography>
            <Typography
                sx={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 11,
                    color: ATLAS_PALETTE.slate40,
                }}
            >
                {count}
            </Typography>
        </Box>
    );
}

function Card({
    item,
    agentsById,
    ownerName,
    ownerAccent,
    onDragStart,
    onClick,
    draggable,
}: {
    item: KanbanItem;
    agentsById: Map<string, IAgent>;
    ownerName: string;
    ownerAccent: string;
    onDragStart: (e: DragEvent<HTMLDivElement>, item: KanbanItem) => void;
    onClick: () => void;
    draggable: boolean;
}) {
    const assignee = item.assignee_agent_id ? agentsById.get(item.assignee_agent_id) : null;
    return (
        <Box
            draggable={draggable}
            onDragStart={draggable ? (e) => onDragStart(e, item) : undefined}
            onClick={onClick}
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '10px',
                p: 2,
                mb: 1.5,
                cursor: draggable ? 'grab' : 'pointer',
                transition: 'box-shadow 120ms ease, transform 120ms ease',
                '&:hover': {
                    boxShadow: '0 4px 12px rgba(0,0,14,.08)',
                    transform: 'translateY(-1px)',
                },
                '&:active': draggable ? { cursor: 'grabbing' } : undefined,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                    mb: 2,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <KindIcon kind={item.kind} size={14} />
                    <Typography
                        sx={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: 11,
                            color: ATLAS_PALETTE.slate60,
                        }}
                    >
                        {item.shortId}
                    </Typography>
                </Box>
                {item.status === 'in_progress' && <LiveDot />}
            </Box>
            <Typography
                sx={{
                    fontSize: 13,
                    color: ATLAS_PALETTE.slate,
                    lineHeight: 1.4,
                    fontWeight: 500,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    mb: 2,
                }}
            >
                {item.title}
            </Typography>
            {/* `minWidth: 0` lets AgentChip's inline-flex shrink below its
                intrinsic content size, which is what activates the ellipsis
                on long names like "PO Reviewer · Product Owner – Reviewer".
                Without this the chip would push the card wider. */}
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    minWidth: 0,
                    maxWidth: '100%',
                }}
            >
                {assignee ? (
                    <AgentChip agent={assignee} size="sm" />
                ) : (
                    <AgentChip
                        agent={{ name: ownerName, accent_color: ownerAccent }}
                        size="sm"
                    />
                )}
            </Box>
        </Box>
    );
}

export function WorkItemKanban({ items, agents, ownerName, ownerAccent, onTransition, onOpen }: Props) {
    const isMobile = useIsMobile();
    const agentsById = useMemo(() => new Map(agents.map((w) => [w.id, w])), [agents]);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState<IssueStatus | null>(null);

    const byStatus = useMemo(() => {
        const map = new Map<IssueStatus, KanbanItem[]>();
        for (const s of COLUMN_ORDER) map.set(s, []);
        for (const it of items) {
            const list = map.get(it.status) ?? [];
            list.push(it);
            map.set(it.status, list);
        }
        return map;
    }, [items]);

    function handleDragStart(e: DragEvent<HTMLDivElement>, item: KanbanItem) {
        setDraggingId(item.id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);
    }

    function handleDragOver(e: DragEvent<HTMLDivElement>, status: IssueStatus) {
        e.preventDefault();
        setDragOver(status);
        e.dataTransfer.dropEffect = 'move';
    }

    function handleDrop(e: DragEvent<HTMLDivElement>, status: IssueStatus) {
        e.preventDefault();
        setDragOver(null);
        const id = e.dataTransfer.getData('text/plain');
        const item = items.find((i) => i.id === id);
        setDraggingId(null);
        if (!item || item.status === status) return;
        const validNext =
            item.kind === 'sub_task'
                ? getValidNextStatuses('sub_task', item.status)
                : getValidNextStatuses(item.kind, item.status);
        const override = !validNext.includes(status);
        onTransition(item, status, override);
    }

    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: {
                    xs: `repeat(${COLUMN_ORDER.length}, minmax(200px, 1fr))`,
                    md: `repeat(${COLUMN_ORDER.length}, minmax(220px, 1fr))`,
                },
                gap: 2,
                overflowX: 'auto',
                pb: 2,
            }}
        >
            {COLUMN_ORDER.map((status) => {
                const list = byStatus.get(status) ?? [];
                const isOver = dragOver === status;
                return (
                    <Box
                        key={status}
                        onDragOver={(e) => handleDragOver(e, status)}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={(e) => handleDrop(e, status)}
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            background: isOver ? ATLAS_PALETTE.cloud : ATLAS_PALETTE.slate06,
                            border: isOver
                                ? `1px dashed ${ATLAS_PALETTE.brandBlue}`
                                : `1px solid transparent`,
                            borderRadius: '12px',
                            minHeight: 200,
                            transition: 'background 120ms ease, border-color 120ms ease',
                        }}
                    >
                        <ColumnHeader status={status} count={list.length} />
                        <Box sx={{ p: 1.5, flex: 1 }}>
                            {list.map((item) => (
                                <Box
                                    key={item.id}
                                    sx={{
                                        opacity: draggingId === item.id ? 0.5 : 1,
                                        transition: 'opacity 120ms ease',
                                    }}
                                >
                                    <Card
                                        item={item}
                                        agentsById={agentsById}
                                        ownerName={ownerName}
                                        ownerAccent={ownerAccent}
                                        onDragStart={handleDragStart}
                                        onClick={() => onOpen(item)}
                                        draggable={!isMobile}
                                    />
                                </Box>
                            ))}
                            {list.length === 0 && (
                                <Typography
                                    sx={{
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate40,
                                        fontStyle: 'italic',
                                        textAlign: 'center',
                                        mt: 2,
                                    }}
                                >
                                    {isMobile ? 'No items' : 'Drop here'}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
}
