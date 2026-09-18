import React, { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import type { ProjectCounts } from '../../api/types.js';
import { KpiTile } from '../../components/index.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { runStatusPaletteEntry } from '../../theme/runStatusPalette.js';
import { formatCostUsd, formatTokenCount } from '../../utils/formatCost.js';
import { useProjectAgentRuns, useAgents } from '../../hooks/useAgents.js';
import { useLabelColor } from '../../hooks/useLabelColor.js';
import { AgentChip } from '../../components/AgentChip.js';
import { KindIcon } from '../../components/KindIcon.js';
import { relativeTime } from '../../utils/time.js';
import type { IAgentRun, RunStatus } from '@atlas/shared';
import { itemPath } from '../../utils/itemPath.js';

interface Props {
    counts: ProjectCounts;
    projectId: string;
    onJumpToHistory: () => void;
}

const RECENT_LIMIT = 5;

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
    queued: 'Queued',
    in_progress: 'In progress',
    completed: 'Completed',
    error: 'Error',
    cancelled: 'Cancelled',
    setup_failed: 'Setup failed',
};


function RecentRunRow({
    run,
    agent,
}: {
    run: IAgentRun;
    agent: { name: string; accent_color: string } | undefined;
}) {
    // Run-status palette (queued/in_progress/...) is separate from the
    // item-status palette (draft/ready/...) — different value sets, same
    // pastel-bg + tonal-fg visual family. Local pill rendering rather than
    // StatusChip (which is hard-coded to item statuses).
    const palette = runStatusPaletteEntry(run.status);
    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: {
                    xs: '1fr',
                    md: '200px 1fr 200px 90px',
                },
                gap: 2.5,
                alignItems: 'center',
                py: 1.75,
                px: 2,
                borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                '&:last-of-type': { borderBottom: 'none' },
                '&:hover': { background: ATLAS_PALETTE.cloud },
                transition: 'background 120ms ease',
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                {agent ? (
                    <AgentChip agent={agent} size="sm" layout="stacked" />
                ) : (
                    <Typography
                        sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate40, fontStyle: 'italic' }}
                    >
                        unknown
                    </Typography>
                )}
            </Box>
            <Box
                component={RouterLink}
                to={itemPath(run.issue_type, run.issue_id)}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    minWidth: 0,
                    color: ATLAS_PALETTE.slate,
                    textDecoration: 'none',
                    '&:hover': { color: ATLAS_PALETTE.brandBlue },
                }}
            >
                <KindIcon kind={run.issue_type} size={13} />
                <Typography
                    sx={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 12,
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
                        fontWeight: 500,
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
            <Typography
                sx={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 11,
                    color: ATLAS_PALETTE.slate40,
                    textAlign: { xs: 'left', md: 'right' },
                }}
            >
                {relativeTime(run.completed_at ?? run.started_at ?? run.created_at)}
            </Typography>
        </Box>
    );
}

const MONO = '"JetBrains Mono", monospace';

function BoldKpi({ children }: { children: React.ReactNode }) {
    return (
        <Box component="span" sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate }}>
            {children}
        </Box>
    );
}

interface Kpi {
    label: string;
    value: number | string;
    caption: React.ReactNode;
    captionTitle?: string;
    dotColor: string;
}

export function OverviewTabContent({ counts, projectId, onJumpToHistory }: Props) {
    const { data: runs, isPending: runsPending } = useProjectAgentRuns(projectId);
    const { data: agents = [] } = useAgents();
    const agentsById = useMemo(
        () => new Map(agents.map((a) => [a.id, a] as const)),
        [agents],
    );
    const recentRuns = useMemo(() => (runs ?? []).slice(0, RECENT_LIMIT), [runs]);
    const openTasks = counts.open_tasks;
    const tasksReady = counts.tasks_ready;
    const tasksInFlight = counts.tasks_in_flight;
    const tasksWaitingInfo = counts.tasks_waiting_info;

    // Combined (agent + terminal) cost + token totals so the AI Cost
    // KPI tile reflects the same blended spend the Analytics page
    // reports — projects funded only via manual terminal sessions
    // would otherwise read $0 here.
    const agentTokens = counts.costSummary
        ? (counts.costSummary.input_tokens ?? 0) +
          (counts.costSummary.output_tokens ?? 0) +
          (counts.costSummary.cache_read_tokens ?? 0)
        : 0;
    const terminalTokens = counts.terminalCostSummary
        ? (counts.terminalCostSummary.input_tokens ?? 0) +
          (counts.terminalCostSummary.output_tokens ?? 0) +
          (counts.terminalCostSummary.cache_read_tokens ?? 0)
        : 0;
    const costTotalTokens = agentTokens + terminalTokens;
    const combinedCost =
        (counts.costSummary?.total_cost_usd ?? 0) +
        (counts.terminalCostSummary?.total_cost_usd ?? 0);
    const runCount = counts.costSummary?.run_count ?? 0;
    const sessionCount = counts.terminalCostSummary?.session_count ?? 0;
    const hasAnyCost = Boolean(counts.costSummary) || Boolean(counts.terminalCostSummary);
    const hasAnyActivity = runCount > 0 || sessionCount > 0;

    const taskCaption = tasksReady > 0 ? `${tasksReady} awaiting pickup` : 'all picked up';
    // In flight = in_progress + in_review; waiting-for-info is counted apart.
    const inFlightCaption =
        tasksWaitingInfo > 0
            ? `${tasksWaitingInfo} waiting info`
            : tasksInFlight === 0
              ? 'queue is empty'
              : 'none waiting on you';

    // Per-category accents matching the dashboard so the same kind of slot
    // reads as the same colour across views.
    const taskColor = useLabelColor('indigo');
    const inFlightColor = useLabelColor('emerald');
    const costColor = useLabelColor('sky');

    const kpis: Kpi[] = [
        {
            label: 'Open tasks',
            value: openTasks,
            caption: taskCaption,
            captionTitle: taskCaption,
            dotColor: taskColor.border,
        },
        {
            label: 'Tasks in flight',
            value: tasksInFlight,
            caption: inFlightCaption,
            captionTitle: inFlightCaption,
            dotColor: inFlightColor.border,
        },
        {
            label: `AI Cost (${new Date().toLocaleString('default', { month: 'long' })})`,
            value: hasAnyCost ? formatCostUsd(combinedCost) : '—',
            caption: hasAnyActivity ? (
                <>
                    <BoldKpi>{runCount}</BoldKpi> run{runCount === 1 ? '' : 's'}
                    {' · '}
                    <BoldKpi>{sessionCount}</BoldKpi> session{sessionCount === 1 ? '' : 's'}
                    {' · '}
                    <BoldKpi>{formatTokenCount(costTotalTokens)}</BoldKpi> tokens
                </>
            ) : (
                'No activity this month'
            ),
            dotColor: costColor.border,
        },
    ];

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                        xs: 'minmax(0, 1fr) minmax(0, 1fr)',
                        sm: 'minmax(0, 1fr) minmax(0, 1fr)',
                        lg: 'repeat(3, minmax(0, 1fr))',
                    },
                    gap: 3,
                }}
            >
                {kpis.map((k) => (
                    <KpiTile
                        key={k.label}
                        label={k.label}
                        dotColor={k.dotColor}
                        value={k.value}
                        caption={k.caption}
                        {...(k.captionTitle !== undefined ? { captionTitle: k.captionTitle } : {})}
                    />
                ))}
            </Box>

            <Box
                sx={{
                    background: ATLAS_PALETTE.white,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    borderRadius: '12px',
                    p: 5,
                }}
            >
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        mb: 4,
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                        <Typography
                            sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate }}
                        >
                            Recent activity
                        </Typography>
                        <Typography
                            sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate40, fontFamily: MONO }}
                        >
                            last {RECENT_LIMIT}
                        </Typography>
                    </Box>
                    <Box
                        onClick={onJumpToHistory}
                        sx={{
                            fontSize: 12.5,
                            color: ATLAS_PALETTE.brandBlue,
                            cursor: 'pointer',
                            fontWeight: 600,
                            '&:hover': { textDecoration: 'underline' },
                        }}
                    >
                        Full history →
                    </Box>
                </Box>

                {runsPending ? (
                    <Skeleton variant="rectangular" height={180} sx={{ borderRadius: '10px' }} />
                ) : recentRuns.length === 0 ? (
                    <Box
                        sx={{
                            border: `1px dashed ${ATLAS_PALETTE.slate10}`,
                            borderRadius: '10px',
                            background: ATLAS_PALETTE.cloud,
                            py: 10,
                            textAlign: 'center',
                        }}
                    >
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{
                                fontSize: 32,
                                color: ATLAS_PALETTE.slate40,
                                display: 'block',
                                mb: 1.5,
                            }}
                        >
                            timeline
                        </Box>
                        <Typography
                            sx={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: ATLAS_PALETTE.slate60,
                                mb: 0.5,
                            }}
                        >
                            No recent activity yet
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate40 }}>
                            Agent actions and status changes will appear here.
                        </Typography>
                    </Box>
                ) : (
                    <Box
                        sx={{
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            borderRadius: '10px',
                            overflow: 'hidden',
                        }}
                    >
                        {recentRuns.map((run) => (
                            <RecentRunRow
                                key={run.id}
                                run={run}
                                agent={agentsById.get(run.agent_id)}
                            />
                        ))}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
