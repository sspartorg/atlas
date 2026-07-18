import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { IAgent } from '@atlas/shared';
import { StatusChip } from './StatusChip.js';
import { AgentChip } from './AgentChip.js';
import { KindIcon } from './KindIcon.js';
import { LiveDot } from './LiveDot.js';
import { ATLAS_PALETTE, TOUCH } from '../theme/tokens.js';
import type { WorkItemTableRow } from './WorkItemTable.js';

const MONO = '"JetBrains Mono", monospace';

interface Props {
    title?: string;
    rows: WorkItemTableRow[];
    agentsById: Map<string, IAgent>;
    ownerName: string;
    ownerAccent: string;
    onRowClick: (row: WorkItemTableRow) => void;
    emptyMessage?: string | undefined;
    headerRight?: ReactNode;
}

function kindBg(kind: string): string {
    switch (kind) {
        case 'story':
            return 'rgba(0,185,255,.12)';
        case 'bug':
            return 'rgba(197,38,126,.12)';
        case 'sub_task':
            return 'rgba(49,171,70,.12)';
        case 'sub_bug':
            return 'rgba(199,83,47,.12)';
        default:
            return ATLAS_PALETTE.slate08;
    }
}

export function MobileWorkItemList({
    title,
    rows,
    agentsById,
    ownerName,
    ownerAccent,
    onRowClick,
    emptyMessage,
    headerRight,
}: Props) {
    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                overflow: 'hidden',
            }}
        >
            {title && (
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        px: 4,
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
                    <Typography
                        sx={{ fontSize: 12, fontFamily: MONO, color: ATLAS_PALETTE.slate40 }}
                    >
                        · {rows.length}
                    </Typography>
                    {headerRight ? <Box sx={{ ml: 'auto' }}>{headerRight}</Box> : null}
                </Box>
            )}

            {rows.length === 0 ? (
                <Box sx={{ py: 10, textAlign: 'center' }}>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                        {emptyMessage ?? `No items yet.`}
                    </Typography>
                </Box>
            ) : (
                rows.map((row, i) => {
                    const assignee = row.assignee_agent_id
                        ? (agentsById.get(row.assignee_agent_id) ?? null)
                        : null;
                    const isLive = row.status === 'in_progress';
                    return (
                        <Box
                            key={row.id}
                            role="button"
                            onClick={() => onRowClick(row)}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 3,
                                px: 4,
                                py: 3,
                                minHeight: TOUCH.rowMin,
                                borderBottom:
                                    i === rows.length - 1
                                        ? 'none'
                                        : `1px solid ${ATLAS_PALETTE.slate06}`,
                                cursor: 'pointer',
                                transition: 'background 120ms ease',
                                '&:active': { background: ATLAS_PALETTE.cloud },
                            }}
                        >
                            <Box
                                sx={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: '10px',
                                    background: kindBg(row.kind),
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <KindIcon kind={row.kind} size={18} />
                            </Box>
                            <Box
                                sx={{
                                    flex: 1,
                                    minWidth: 0,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 1.5,
                                }}
                            >
                                {/* Row 1: title (≤2 lines) + live-dot anchored top-right */}
                                <Box
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: 1,
                                    }}
                                >
                                    <Typography
                                        sx={{
                                            flex: 1,
                                            minWidth: 0,
                                            fontSize: 14,
                                            fontWeight: 600,
                                            color: ATLAS_PALETTE.slate,
                                            lineHeight: 1.35,
                                            display: '-webkit-box',
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: 'vertical',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        {row.title}
                                    </Typography>
                                    {isLive && (
                                        <Box sx={{ pt: '6px', flexShrink: 0 }}>
                                            <LiveDot size={8} />
                                        </Box>
                                    )}
                                </Box>
                                {/* Row 2: shortId · assignee icon · status (single line) */}
                                <Box
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1.25,
                                        flexWrap: 'nowrap',
                                        minWidth: 0,
                                        overflow: 'hidden',
                                    }}
                                >
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 11,
                                            lineHeight: 1,
                                            color: ATLAS_PALETTE.brandBlue,
                                            fontWeight: 500,
                                            flexShrink: 0,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            height: 16,
                                        }}
                                    >
                                        {row.shortId}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            fontSize: 11,
                                            lineHeight: 1,
                                            color: ATLAS_PALETTE.slate40,
                                            flexShrink: 0,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            height: 16,
                                        }}
                                    >
                                        ·
                                    </Typography>
                                    {assignee ? (
                                        <AgentChip agent={assignee} size="xs" showName={false} />
                                    ) : (
                                        <AgentChip
                                            agent={{ name: ownerName, accent_color: ownerAccent }}
                                            size="xs"
                                            showName={false}
                                        />
                                    )}
                                    <Typography
                                        sx={{
                                            fontSize: 11,
                                            lineHeight: 1,
                                            color: ATLAS_PALETTE.slate40,
                                            flexShrink: 0,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            height: 16,
                                        }}
                                    >
                                        ·
                                    </Typography>
                                    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
                                        <StatusChip status={row.status} size="xs" />
                                    </Box>
                                </Box>
                            </Box>
                        </Box>
                    );
                })
            )}
        </Box>
    );
}
