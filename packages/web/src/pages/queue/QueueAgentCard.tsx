import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import type { IAgent } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import type { AgentQueueSummary, AgentStatusLabel } from './queueViewModel.js';
import { relativeTimeShort } from './queueViewModel.js';
import { agentSubtitle, getAgentView } from '../agents/agentViewModel.js';
import { LiveDot } from '../../components/LiveDot.js';
import { KindIcon } from '../../components/KindIcon.js';

const MONO = '"JetBrains Mono", monospace';

// `hexToRgba` only matches literal `#rrggbb`. It's used here only for the
// agent's `accent_color`, which is stored as a literal hex string in the
// agents table — never a CSS variable — so the regex matches. Do NOT pass
// `ATLAS_PALETTE.*` (CSS-var strings) through this: the regex bails and
// the alpha tint silently disappears. Use `color-mix(in srgb, var(--x) N%,
// transparent)` for CSS-var tints (see headerBg below).
function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.replace('#', ''));
    if (!m || !m[1] || !m[2] || !m[3]) return hex;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

interface Props {
    summary: AgentQueueSummary;
    statusLabel: AgentStatusLabel;
    projectNameById: Map<string, string>;
    selected?: boolean;
    onOpen: (agent: IAgent) => void;
}

// Mercury collapses `green` and `orange` to the brand-accent slot (black in
// light / white in dark). The functional `success` / `warning` slots carry
// the actual hue across both themes — see `theme-vars.css` semantic block.
const STATUS_COLOR: Record<AgentStatusLabel, string> = {
    Running: ATLAS_PALETTE.success,
    Idle: ATLAS_PALETTE.slate60,
    Paused: ATLAS_PALETTE.slate60,
    Failed: ATLAS_PALETTE.warning,
};

export function QueueAgentCard({
    summary,
    statusLabel,
    projectNameById,
    selected,
    onOpen,
}: Props) {
    const { agent, queued, running, nextRunItem, lastCompletedItem, lastCompletedAt } = summary;
    const view = getAgentView(agent);
    const statusColor = STATUS_COLOR[statusLabel];
    const isRunning = statusLabel === 'Running';
    const isFailed = statusLabel === 'Failed';

    // `ATLAS_PALETTE.warning` is a CSS-var string — hexToRgba can't tint
    // it (it'd paint solid orange). color-mix is the right primitive for
    // CSS-var tints. `agent.accent_color` is a literal hex from the DB so
    // hexToRgba works for the running tint.
    const headerBg = isFailed
        ? 'color-mix(in srgb, var(--atlas-warning) 6%, transparent)'
        : isRunning
          ? hexToRgba(agent.accent_color, 0.06)
          : ATLAS_PALETTE.white;

    const visibleQueue = queued.slice(0, 3);
    const moreCount = queued.length - visibleQueue.length;

    return (
        <Box
            onClick={() => onOpen(agent)}
            tabIndex={0}
            role="button"
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(agent);
                }
            }}
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${selected ? agent.accent_color : ATLAS_PALETTE.slate10}`,
                outline: selected ? `2px solid ${hexToRgba(agent.accent_color, 0.4)}` : 'none',
                outlineOffset: '-2px',
                borderRadius: '12px',
                overflow: 'hidden',
                cursor: 'pointer',
                transition: 'box-shadow 150ms ease, transform 150ms ease, border-color 150ms ease',
                display: 'flex',
                flexDirection: 'column',
                '&:hover': {
                    boxShadow: '0 4px 12px rgba(0,0,14,.08)',
                    transform: 'translateY(-1px)',
                },
                '&:focus-visible': {
                    outline: `2px solid ${ATLAS_PALETTE.brandBlue}`,
                    outlineOffset: '-2px',
                },
            }}
        >
            {/* Header */}
            <Box
                sx={{
                    px: 4,
                    py: 3,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    background: headerBg,
                    borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                }}
            >
                <Box
                    sx={{
                        width: 36,
                        height: 36,
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
                        sx={{ fontSize: 20, color: agent.accent_color }}
                    >
                        {view.glyph}
                    </Box>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        sx={{
                            fontSize: 15,
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
                            fontSize: 11,
                            color: ATLAS_PALETTE.slate60,
                            mt: 0.25,
                        }}
                    >
                        {agent.cli} · {agentSubtitle(agent)} ·{' '}
                        {view.cadenceLabel.toLowerCase()}
                    </Typography>
                </Box>
                <Box
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        // gap=1.5 clears the LiveDot ripple's ~5.5px overshoot
                        // at peak scale (2.6x of the 7px dot) — matches the
                        // fix in AgentCard.tsx. The 9999-radius pill's own
                        // padding (px=1.5) gives the ripple room on the left.
                        gap: 1.5,
                        px: 1.5,
                        py: 0.5,
                        borderRadius: '9999px',
                        background: isRunning || isFailed ? `${statusColor}14` : 'transparent',
                        border: `1px solid ${isRunning || isFailed ? statusColor : ATLAS_PALETTE.slate12}`,
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
                        sx={{
                            fontSize: 11,
                            fontWeight: 500,
                            color: isRunning || isFailed ? statusColor : ATLAS_PALETTE.slate60,
                        }}
                    >
                        {statusLabel}
                    </Typography>
                </Box>
            </Box>

            {/* NEXT RUN / LAST COMPLETED. On xs the two cells stack into
                one column so the timestamps don't get squeezed; the inner
                divider becomes a bottom-border instead of a right-border.
                `minmax(0, 1fr)` forces a true 50/50 split — the bare `1fr`
                default is `minmax(auto, 1fr)`, which lets nowrap children
                push their column past 50% when the title is long. */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(0, 1fr)' },
                    borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                }}
            >
                <Box
                    sx={{
                        px: 4,
                        py: 3,
                        minWidth: 0,
                        borderRight: { xs: 'none', sm: `1px solid ${ATLAS_PALETTE.slate06}` },
                        borderBottom: { xs: `1px solid ${ATLAS_PALETTE.slate06}`, sm: 'none' },
                    }}
                >
                    <Typography
                        sx={{
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: '.06em',
                            textTransform: 'uppercase',
                            color: ATLAS_PALETTE.slate60,
                            mb: 0.5,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        Next Run
                    </Typography>
                    {nextRunItem ? (
                        <>
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 12,
                                    color: isRunning
                                        ? ATLAS_PALETTE.success
                                        : ATLAS_PALETTE.slate,
                                    fontWeight: 500,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}
                            >
                                {isRunning ? 'running now' : view.nextPassDelta}
                            </Typography>
                            <Typography
                                sx={{
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                    mt: 0.25,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {nextRunItem.displayId} · {nextRunItem.title}
                            </Typography>
                        </>
                    ) : (
                        <>
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 12,
                                    color: ATLAS_PALETTE.slate60,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}
                            >
                                {view.nextPassDelta}
                            </Typography>
                            <Typography
                                sx={{ fontSize: 11, color: ATLAS_PALETTE.slate40, mt: 0.25 }}
                            >
                                nothing queued
                            </Typography>
                        </>
                    )}
                </Box>
                <Box sx={{ px: 4, py: 3, minWidth: 0 }}>
                    <Typography
                        sx={{
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: '.06em',
                            textTransform: 'uppercase',
                            color: ATLAS_PALETTE.slate60,
                            mb: 0.5,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        Last Completed
                    </Typography>
                    {lastCompletedItem ? (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <KindIcon kind={lastCompletedItem.type} size={12} />
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 12,
                                        color: ATLAS_PALETTE.slate,
                                        fontWeight: 500,
                                    }}
                                >
                                    {lastCompletedItem.displayId}
                                </Typography>
                            </Box>
                            <Typography
                                sx={{
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                    mt: 0.25,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {lastCompletedItem.title}
                                {lastCompletedAt ? ` · ${relativeTimeShort(lastCompletedAt)}` : ''}
                            </Typography>
                        </>
                    ) : (
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate40 }}>
                            —
                        </Typography>
                    )}
                </Box>
            </Box>

            {/* Queue list */}
            <Box sx={{ px: 4, py: 3, flex: 1 }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        mb: 1.5,
                    }}
                >
                    <Typography
                        sx={{
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: '.06em',
                            textTransform: 'uppercase',
                            color: ATLAS_PALETTE.slate60,
                        }}
                    >
                        Queue
                        <Box component="span" sx={{ ml: 1, color: ATLAS_PALETTE.slate30 }}>
                            {queued.length}
                        </Box>
                    </Typography>
                    {moreCount > 0 ? (
                        <Button
                            variant="text"
                            size="small"
                            onClick={(e) => {
                                e.stopPropagation();
                                onOpen(agent);
                            }}
                            sx={{
                                fontSize: 11,
                                textTransform: 'none',
                                color: ATLAS_PALETTE.brandBlue,
                                p: 0,
                                minWidth: 0,
                            }}
                        >
                            view all ({queued.length})
                        </Button>
                    ) : null}
                </Box>

                {visibleQueue.length === 0 ? (
                    <Typography
                        sx={{
                            fontSize: 12,
                            color: ATLAS_PALETTE.slate40,
                            fontStyle: 'italic',
                            py: 1,
                        }}
                    >
                        nothing waiting
                    </Typography>
                ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {visibleQueue.map((item, idx) => {
                            const isRunningItem = running.some((r) => r.id === item.id);
                            const projectName = item.project_id
                                ? projectNameById.get(item.project_id)
                                : null;
                            return (
                                <Box
                                    key={item.id}
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: '72px 1fr auto',
                                        gap: 2,
                                        alignItems: 'center',
                                        px: 1.5,
                                        py: 1,
                                        borderRadius: '6px',
                                        background: isRunningItem
                                            ? hexToRgba(agent.accent_color, 0.08)
                                            : 'transparent',
                                        border: isRunningItem
                                            ? `1px solid ${hexToRgba(agent.accent_color, 0.3)}`
                                            : '1px solid transparent',
                                        '&:hover': {
                                            background: isRunningItem
                                                ? hexToRgba(agent.accent_color, 0.1)
                                                : ATLAS_PALETTE.cloud,
                                        },
                                    }}
                                >
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 11,
                                            color: ATLAS_PALETTE.brandBlue,
                                        }}
                                    >
                                        {item.displayId}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            fontSize: 12,
                                            color: ATLAS_PALETTE.slate,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {item.title}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 11,
                                            color: ATLAS_PALETTE.slate60,
                                        }}
                                    >
                                        {projectName ?? '—'}
                                        {idx === 0 && isRunningItem ? (
                                            <Box
                                                component="span"
                                                sx={{
                                                    ml: 1,
                                                    color: ATLAS_PALETTE.success,
                                                    fontWeight: 600,
                                                }}
                                            >
                                                · running
                                            </Box>
                                        ) : null}
                                    </Typography>
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
