import { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { runStatusPaletteEntry } from '../../theme/runStatusPalette.js';
import { useProjectAgentRuns } from '../../hooks/useAgents.js';
import { useAgents } from '../../hooks/useAgents.js';
import { AgentChip } from '../../components/AgentChip.js';
import { KindIcon } from '../../components/KindIcon.js';
import { relativeTime } from '../../utils/time.js';
import { formatCostUsd } from '../../utils/formatCost.js';
import type { IAgentRun, IssueType, RunStatus } from '@atlas/shared';

const MONO = '"JetBrains Mono", monospace';

// Mirrors the route used by RelatedItemsCard so a clicked item lands on
// the same detail page no matter which entry point the Owner came from.
function issueRoute(type: IssueType, id: string): string {
    if (type === 'epic') return `/epics/${id}`;
    if (type === 'story') return `/issues/stories/${id}`;
    if (type === 'sub_task') return `/issues/sub-tasks/${id}`;
    if (type === 'sub_bug') return `/issues/sub-bugs/${id}`;
    return `/issues/bugs/${id}`;
}

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
    queued: 'Queued',
    in_progress: 'In progress',
    completed: 'Completed',
    error: 'Error',
    cancelled: 'Cancelled',
    setup_failed: 'Setup failed',
};

function RunRow({
    run,
    agent,
}: {
    run: IAgentRun;
    agent: { name: string; accent_color: string } | undefined;
}) {
    const palette = runStatusPaletteEntry(run.status);
    return (
        <Box
            sx={{
                display: 'grid',
                // The 5-column table needs ~700px of fixed width (columns +
                // gaps). On an iPad that doesn't fit once the sidebar + page
                // padding are subtracted, so the `1fr` issue cell collapses to
                // 0 — the MON-N id (flexShrink: 0) survives but the title
                // (minWidth: 0) shrinks to nothing. Hold the table back to
                // `lg`; below that, stack one-per-row so the full code + title
                // always render. `minmax` also floors the title track so it can
                // never collapse to 0 even in the table.
                gridTemplateColumns: {
                    xs: '1fr',
                    lg: '200px minmax(160px, 1fr) 220px 80px 110px',
                },
                gap: 3,
                alignItems: 'center',
                py: 2.5,
                px: 3,
                borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                '&:last-of-type': { borderBottom: 'none' },
                '&:hover': { background: ATLAS_PALETTE.cloud },
                transition: 'background 120ms ease',
            }}
        >
            {/* Agent */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                {agent ? (
                    <AgentChip agent={agent} size="sm" layout="stacked" />
                ) : (
                    <Typography
                        sx={{
                            fontSize: 12,
                            color: ATLAS_PALETTE.slate40,
                            fontStyle: 'italic',
                        }}
                    >
                        unknown agent
                    </Typography>
                )}
            </Box>

            {/* Issue link: MON-N · title */}
            <Box
                component={RouterLink}
                to={issueRoute(run.issue_type, run.issue_id)}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    minWidth: 0,
                    color: ATLAS_PALETTE.slate,
                    textDecoration: 'none',
                    '&:hover': { color: ATLAS_PALETTE.brandBlue },
                }}
            >
                <KindIcon kind={run.issue_type} size={14} />
                <Typography
                    sx={{
                        fontFamily: MONO,
                        fontSize: 12.5,
                        fontWeight: 500,
                        flexShrink: 0,
                    }}
                >
                    {run.issue_id}
                </Typography>
                <Typography
                    sx={{
                        fontSize: 12.5,
                        color: ATLAS_PALETTE.slate70,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                    }}
                    title={run.item_title ?? ''}
                >
                    {run.item_title ?? ''}
                </Typography>
            </Box>

            {/* Run-status pill + arrow icon → run detail */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                    component="span"
                    aria-label={RUN_STATUS_LABEL[run.status]}
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        height: 22,
                        px: '9px',
                        borderRadius: '9999px',
                        background: palette.bg,
                        color: palette.fg,
                        fontSize: 11,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                    }}
                >
                    {RUN_STATUS_LABEL[run.status]}
                </Box>
                <Tooltip title="View run" arrow placement="top">
                    <IconButton
                        component={RouterLink}
                        to={`/agents/${run.agent_id}/runs/${run.id}`}
                        size="small"
                        aria-label="View run"
                        sx={{
                            color: ATLAS_PALETTE.slate60,
                            '&:hover': {
                                color: ATLAS_PALETTE.brandBlue,
                                background: ATLAS_PALETTE.slate08,
                            },
                        }}
                    >
                        <ArrowForwardRounded sx={{ fontSize: 16 }} />
                    </IconButton>
                </Tooltip>
            </Box>

            {/* Cost */}
            <Typography
                sx={{
                    fontFamily: MONO,
                    fontSize: 11.5,
                    color: run.total_cost_usd != null ? ATLAS_PALETTE.slate : ATLAS_PALETTE.slate30,
                    display: { xs: 'none', lg: 'block' },
                }}
            >
                {formatCostUsd(run.total_cost_usd)}
            </Typography>

            {/* Timestamp */}
            <Typography
                sx={{
                    fontFamily: MONO,
                    fontSize: 11.5,
                    color: ATLAS_PALETTE.slate40,
                    textAlign: { xs: 'left', lg: 'right' },
                }}
            >
                {relativeTime(run.completed_at ?? run.started_at ?? run.created_at)}
            </Typography>
        </Box>
    );
}

interface Props {
    projectId: string;
}

export function HistoryTabContent({ projectId }: Props) {
    const { data: runs, isPending } = useProjectAgentRuns(projectId);
    // Agents are session-stable (staleTime: Infinity in useAgents) so this
    // is a cache read in the common case — no extra network for the rail.
    const { data: agents = [] } = useAgents();

    const agentsById = useMemo(() => {
        const m = new Map(agents.map((a) => [a.id, a] as const));
        return m;
    }, [agents]);

    const totalCostUsd = useMemo(() => {
        if (!runs || runs.length === 0) return null;
        let sum = 0;
        let hasAny = false;
        for (const r of runs) {
            if (r.total_cost_usd != null) {
                sum += r.total_cost_usd;
                hasAny = true;
            }
        }
        return hasAny ? sum : null;
    }, [runs]);

    if (isPending) {
        return (
            <Box
                sx={{
                    background: ATLAS_PALETTE.white,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    borderRadius: '12px',
                    p: 5,
                }}
            >
                <Skeleton variant="rectangular" height={200} sx={{ borderRadius: '10px' }} />
            </Box>
        );
    }

    const rows = runs ?? [];

    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                overflow: 'hidden',
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 1.5,
                    px: 5,
                    py: 4,
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
                    Agent activity
                </Typography>
                <Typography
                    sx={{
                        fontSize: 11.5,
                        color: ATLAS_PALETTE.slate40,
                        fontFamily: MONO,
                    }}
                >
                    · {rows.length}
                </Typography>
                {totalCostUsd != null && (
                    <Typography
                        sx={{
                            fontSize: 11.5,
                            color: ATLAS_PALETTE.slate40,
                            fontFamily: MONO,
                        }}
                    >
                        · {formatCostUsd(totalCostUsd)} total
                    </Typography>
                )}
            </Box>

            {rows.length === 0 ? (
                <Box
                    sx={{
                        py: 12,
                        textAlign: 'center',
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{
                            fontSize: 40,
                            color: ATLAS_PALETTE.slate40,
                            display: 'block',
                            mb: 2,
                        }}
                    >
                        history
                    </Box>
                    <Typography
                        sx={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: ATLAS_PALETTE.slate60,
                            mb: 1,
                        }}
                    >
                        No agent activity yet for this project.
                    </Typography>
                    <Typography
                        sx={{
                            fontSize: 12.5,
                            color: ATLAS_PALETTE.slate40,
                            maxWidth: 480,
                            mx: 'auto',
                        }}
                    >
                        Every time an agent runs against an item in this project — epic, story,
                        bug, sub-task or sub-bug — the run lands here with a link straight to the
                        issue and the full run log.
                    </Typography>
                </Box>
            ) : (
                <Box>
                    {rows.map((run) => (
                        <RunRow
                            key={run.id}
                            run={run}
                            agent={agentsById.get(run.agent_id)}
                        />
                    ))}
                </Box>
            )}
        </Box>
    );
}
