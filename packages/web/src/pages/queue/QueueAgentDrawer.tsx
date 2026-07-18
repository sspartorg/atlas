import { Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Drawer from '@mui/material/Drawer';
import type { IAgent, IAgentRun, IssueType } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { StatusChip, SimulatedBadge } from '../../components/index.js';
import { LiveDot } from '../../components/LiveDot.js';
import { KindIcon } from '../../components/KindIcon.js';
import { useAiEnabled } from '../../hooks/useAiEnabled.js';
import { isSimulatedRun } from '../../utils/isSimulatedRun.js';
import type { AgentQueueSummary, AgentStatusLabel, QueueItem } from './queueViewModel.js';
import { relativeTimeShort } from './queueViewModel.js';
import { getAgentView, CATEGORY_LABEL } from '../agents/agentViewModel.js';
import { useRunOutputTail } from '../../hooks/useRunOutputTail.js';
import { QueueLiveLog } from './QueueLiveLog.js';
import { lazyNamed } from '../../utils/lazyNamed.js';
const RunNowDialog = lazyNamed(
    () => import('../agents/RunNowDialog.js'),
    'RunNowDialog',
);

const MONO = '"JetBrains Mono", monospace';

function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.replace('#', ''));
    if (!m || !m[1] || !m[2] || !m[3]) return hex;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

const STATUS_COLOR: Record<AgentStatusLabel, string> = {
    Running: ATLAS_PALETTE.success,
    Idle: ATLAS_PALETTE.slate60,
    Paused: ATLAS_PALETTE.warning,
    Failed: ATLAS_PALETTE.orange,
};

function issuePath(type: IssueType, id: string): string {
    if (type === 'epic') return `/epics/${id}`;
    if (type === 'story') return `/issues/stories/${id}`;
    if (type === 'bug') return `/issues/bugs/${id}`;
    if (type === 'sub_task') return `/issues/sub-tasks/${id}`;
    return `/issues/sub-bugs/${id}`;
}

interface Props {
    open: boolean;
    agent: IAgent | null;
    summary: AgentQueueSummary | null;
    statusLabel: AgentStatusLabel;
    runs: IAgentRun[];
    itemsById: Map<string, QueueItem>;
    projectNameById: Map<string, string>;
    onClose: () => void;
    onPause: (agent: IAgent) => void;
}


export function QueueAgentDrawer({
    open,
    agent,
    summary,
    statusLabel,
    runs,
    itemsById,
    projectNameById,
    onClose,
    onPause,
}: Props) {
    const navigate = useNavigate();
    const [runNowOpen, setRunNowOpen] = useState(false);
    if (!agent || !summary) return null;
    const view = getAgentView(agent);
    const statusColor = STATUS_COLOR[statusLabel];
    const isRunning = statusLabel === 'Running';
    const isFailed = statusLabel === 'Failed';

    const liveRun =
        runs.find((r) => r.status === 'in_progress') ??
        runs.find((r) => r.status === 'queued') ??
        null;
    const liveItem = liveRun ? (itemsById.get(liveRun.issue_id) ?? null) : null;
    const tail = useRunOutputTail(liveRun?.id ?? null);
    const { aiEnabled } = useAiEnabled();

    const nextScheduled = summary.queued.slice(0, 3);
    // First queued item drives the "Run now" preselect — the owner asked for
    // the picker to open with the obvious next target pre-filled so they
    // don't have to re-pick the same row they were just looking at.
    const nextForPreselect = summary.queued[0] ?? null;
    const lastCompletedRuns = runs
        .filter((r) => r.status === 'completed' || r.status === 'error')
        .sort((a, b) =>
            (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at)
        )
        .slice(0, 1);

    return (
        <Drawer
            anchor="right"
            open={open}
            onClose={onClose}
            slotProps={{
                paper: {
                    sx: {
                        width: { xs: 'min(88%, 440px)', sm: 520 },
                        bgcolor: 'background.paper',
                        backgroundImage: 'none',
                    },
                },
            }}
        >
            {/* Header */}
            <Box
                sx={{
                    px: 5,
                    py: 4,
                    borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 2,
                }}
            >
                <Box
                    sx={{
                        width: 40,
                        height: 40,
                        borderRadius: '8px',
                        background: hexToRgba(agent.accent_color, 0.12),
                        border: `1px solid ${hexToRgba(agent.accent_color, 0.24)}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 22, color: agent.accent_color }}
                    >
                        {view.glyph}
                    </Box>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        sx={{
                            fontSize: 18,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                            lineHeight: 1.2,
                        }}
                    >
                        {agent.name}
                    </Typography>
                    <Typography
                        sx={{
                            fontFamily: MONO,
                            fontSize: 11.5,
                            color: ATLAS_PALETTE.slate60,
                            mt: 0.5,
                        }}
                    >
                        {agent.cli} · {agent.model} · {CATEGORY_LABEL[agent.category]} · queue{' '}
                        {summary.queued.length}
                    </Typography>
                </Box>
                <IconButton size="small" onClick={onClose} sx={{ color: ATLAS_PALETTE.slate60 }}>
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 20 }}
                    >
                        close
                    </Box>
                </IconButton>
            </Box>

            {/* Status + Actions */}
            <Box
                sx={{
                    px: 5,
                    py: 3,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                }}
            >
                <Box
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.75,
                        px: 1.5,
                        py: 0.75,
                        borderRadius: '9999px',
                        bgcolor: 'background.paper',
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    }}
                >
                    {isRunning ? (
                        <LiveDot size={7} hex={statusColor} label="Running" />
                    ) : (
                        <Box
                            sx={{
                                width: 6,
                                height: 6,
                                borderRadius: '9999px',
                                background: statusColor,
                            }}
                        />
                    )}
                    <Typography
                        component="span"
                        sx={{ fontSize: 11.5, fontWeight: 600, color: ATLAS_PALETTE.slate }}
                    >
                        {statusLabel}
                    </Typography>
                </Box>
                <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={() => setRunNowOpen(true)}
                        sx={{ height: 30, fontSize: 12, textTransform: 'none' }}
                        startIcon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 14 }}
                            >
                                play_arrow
                            </Box>
                        }
                    >
                        Run now
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={() => onPause(agent)}
                        sx={{ height: 30, fontSize: 12, textTransform: 'none' }}
                        startIcon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 14 }}
                            >
                                {agent.status === 'inactive' ? 'play_arrow' : 'pause'}
                            </Box>
                        }
                    >
                        {agent.status === 'inactive' ? 'Resume' : 'Pause'}
                    </Button>
                </Box>
            </Box>

            {/* Currently executing */}
            <Box sx={{ px: 5, py: 3, borderBottom: `1px solid ${ATLAS_PALETTE.slate06}` }}>
                <Typography
                    sx={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        mb: 1.5,
                    }}
                >
                    Currently Executing
                </Typography>

                {liveRun && liveItem ? (
                    <Box>
                        <Box
                            onClick={() => navigate(issuePath(liveItem.type as IssueType, liveItem.id))}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 2,
                                px: 2,
                                py: 1.5,
                                borderRadius: '8px',
                                background: hexToRgba(agent.accent_color, 0.06),
                                border: `1px solid ${hexToRgba(agent.accent_color, 0.2)}`,
                                cursor: 'pointer',
                                mb: 2,
                                '&:hover': { background: hexToRgba(agent.accent_color, 0.1) },
                            }}
                        >
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 11.5,
                                    color: ATLAS_PALETTE.brandBlue,
                                    flexShrink: 0,
                                }}
                            >
                                {liveItem.displayId}
                            </Typography>
                            <Typography
                                sx={{
                                    flex: 1,
                                    fontSize: 13,
                                    color: ATLAS_PALETTE.slate,
                                    fontWeight: 500,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {liveItem.title}
                            </Typography>
                            <StatusChip status={liveItem.status as string} size="sm" />
                        </Box>
                        {isSimulatedRun(liveRun, aiEnabled) && (
                            <Box sx={{ mb: 1 }}>
                                <SimulatedBadge size="sm" />
                            </Box>
                        )}
                        <QueueLiveLog lines={tail.lines} isLive={tail.isLive} accent={agent.accent_color} />
                    </Box>
                ) : (
                    <Box
                        sx={{
                            px: 2,
                            py: 2.5,
                            borderRadius: '8px',
                            border: `1px dashed ${ATLAS_PALETTE.slate12}`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                        }}
                    >
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 18, color: ATLAS_PALETTE.slate40 }}
                        >
                            schedule
                        </Box>
                        <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60 }}>
                            {isFailed
                                ? 'Paused after a failure — review the last completed run.'
                                : `Idle until ${view.nextPassLabel}.`}
                        </Typography>
                    </Box>
                )}
            </Box>

            {/* Next scheduled */}
            <Box sx={{ px: 5, py: 3, borderBottom: `1px solid ${ATLAS_PALETTE.slate06}` }}>
                <Typography
                    sx={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        mb: 1.5,
                    }}
                >
                    Next Scheduled
                    <Box
                        component="span"
                        sx={{ ml: 1, color: ATLAS_PALETTE.slate30, fontWeight: 500 }}
                    >
                        {summary.queued.length}
                    </Box>
                </Typography>
                {nextScheduled.length === 0 ? (
                    <Typography
                        sx={{ fontSize: 12, color: ATLAS_PALETTE.slate40, fontStyle: 'italic' }}
                    >
                        nothing in the queue
                    </Typography>
                ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        {nextScheduled.map((it) => {
                            const projectName = it.project_id
                                ? projectNameById.get(it.project_id)
                                : null;
                            return (
                                <Box
                                    key={it.id}
                                    onClick={() => navigate(issuePath(it.type as IssueType, it.id))}
                                    sx={{
                                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                        borderRadius: '8px',
                                        px: 2,
                                        py: 1.5,
                                        cursor: 'pointer',
                                        transition:
                                            'background 150ms ease, border-color 150ms ease',
                                        '&:hover': {
                                            background: ATLAS_PALETTE.cloud,
                                            borderColor: ATLAS_PALETTE.brandBlue,
                                        },
                                    }}
                                >
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1.5,
                                            mb: 0.5,
                                        }}
                                    >
                                        <Typography
                                            sx={{
                                                fontFamily: MONO,
                                                fontSize: 11,
                                                color: ATLAS_PALETTE.brandBlue,
                                            }}
                                        >
                                            {it.displayId}
                                        </Typography>
                                        <Typography
                                            sx={{
                                                flex: 1,
                                                fontSize: 12.5,
                                                color: ATLAS_PALETTE.slate,
                                                fontWeight: 500,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {it.title}
                                        </Typography>
                                        <Typography
                                            sx={{
                                                fontFamily: MONO,
                                                fontSize: 10.5,
                                                color: ATLAS_PALETTE.slate60,
                                            }}
                                        >
                                            {projectName ?? '—'}
                                        </Typography>
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </Box>

            {/* Last completed */}
            <Box sx={{ px: 5, py: 3 }}>
                <Typography
                    sx={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        mb: 1.5,
                    }}
                >
                    Last Completed
                </Typography>
                {lastCompletedRuns.length === 0 ? (
                    <Typography
                        sx={{ fontSize: 12, color: ATLAS_PALETTE.slate40, fontStyle: 'italic' }}
                    >
                        no runs yet
                    </Typography>
                ) : (
                    lastCompletedRuns.map((r) => {
                        const item = itemsById.get(r.issue_id);
                        const isError = r.status === 'error';
                        return (
                            <Box
                                key={r.id}
                                sx={{
                                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                    borderRadius: '8px',
                                    px: 2,
                                    py: 1.5,
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 1.5,
                                }}
                            >
                                {/* Render the item-kind icon (epic / story / bug / sub-task /
                                    sub-bug) rather than a generic check/error glyph — telling
                                    "what was finished" is more useful at this position than the
                                    success/failure flag (which already shows via the row's
                                    border tint and the `[error]` chip elsewhere). */}
                                {item ? (
                                    <Box sx={{ mt: 0.25 }}>
                                        <KindIcon kind={item.type} size={14} />
                                    </Box>
                                ) : (
                                    <Box
                                        sx={{
                                            width: 22,
                                            height: 22,
                                            borderRadius: '9999px',
                                            // Mercury paired soft+fg tokens — flip
                                            // together per theme so the check stays
                                            // legible. Previously used
                                            // `hexToRgba(ATLAS_PALETTE.success, 0.12)`
                                            // for bg, but `ATLAS_PALETTE.success` is
                                            // `var(--atlas-success)` (a CSS var, not
                                            // a hex), so the regex fell through and
                                            // returned the raw var string — CSS painted
                                            // a solid green background AND a solid
                                            // green icon, making the check invisible.
                                            bgcolor: isError
                                                ? ATLAS_PALETTE.dangerSoft
                                                : ATLAS_PALETTE.successSoft,
                                            color: isError
                                                ? ATLAS_PALETTE.dangerFg
                                                : ATLAS_PALETTE.successFg,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0,
                                            mt: 0.25,
                                        }}
                                    >
                                        <Box
                                            component="span"
                                            className="material-symbols-rounded"
                                            sx={{ fontSize: 14 }}
                                        >
                                            {isError ? 'error' : 'check'}
                                        </Box>
                                    </Box>
                                )}
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        {item ? (
                                            <Typography
                                                sx={{
                                                    fontFamily: MONO,
                                                    fontSize: 11.5,
                                                    color: ATLAS_PALETTE.brandBlue,
                                                }}
                                            >
                                                {item.displayId}
                                            </Typography>
                                        ) : null}
                                        <Typography
                                            sx={{
                                                fontSize: 12.5,
                                                color: ATLAS_PALETTE.slate,
                                                fontWeight: 500,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {item?.title ?? r.issue_id}
                                        </Typography>
                                        {isSimulatedRun(r, aiEnabled) && <SimulatedBadge size="sm" />}
                                    </Box>
                                    <Typography
                                        sx={{
                                            fontSize: 11,
                                            color: ATLAS_PALETTE.slate60,
                                            mt: 0.5,
                                        }}
                                    >
                                        <Box component="span" sx={{ fontWeight: 600 }}>
                                            Output:
                                        </Box>{' '}
                                        {((r.output_text ?? '').trim().slice(-160) || '(no output)') +
                                            ' · ' +
                                            relativeTimeShort(r.completed_at ?? r.created_at)}
                                    </Typography>
                                </Box>
                            </Box>
                        );
                    })
                )}
            </Box>
            {runNowOpen && (
                <Suspense fallback={null}>
                    <RunNowDialog
                        open
                        agent={agent}
                        preselect={
                            nextForPreselect
                                ? {
                                      projectId: nextForPreselect.project_id,
                                      kind: nextForPreselect.type as IssueType,
                                      issueId: nextForPreselect.id,
                                  }
                                : null
                        }
                        onClose={() => setRunNowOpen(false)}
                    />
                </Suspense>
            )}
        </Drawer>
    );
}
