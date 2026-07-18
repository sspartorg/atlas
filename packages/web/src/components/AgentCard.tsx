import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import type { IAgent, IAgentRun } from '@atlas/shared';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../theme/tokens.js';
import { AgentCardMenu, type AgentCardMenuActions } from '../pages/agents/AgentCardMenu.js';
import {
    agentSubtitle,
    getAgentView,
    getRuntimeStats,
    relativeTime,
} from '../pages/agents/agentViewModel.js';
import { formatCostUsd } from '../utils/formatCost.js';
import { LiveDot } from './LiveDot.js';

interface Props {
    agent: IAgent;
    runs?: IAgentRun[];
    isFavorite?: boolean;
    onToggleFavorite?: () => void;
    onClick?: () => void;
    menuActions?: AgentCardMenuActions;
    focused?: boolean;
    runtimeError?: boolean;
    /** When true, a small "Upgrade" pill is shown next to the agent name.
     *  Driven by the parent which compares marketplace_pulled_version against
     *  the catalog's current version. */
    upgradeAvailable?: boolean;
}

function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.replace('#', ''));
    if (!m || !m[1] || !m[2] || !m[3]) return hex;
    const r = parseInt(m[1], 16);
    const g = parseInt(m[2], 16);
    const b = parseInt(m[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function AgentCard({
    agent,
    runs,
    isFavorite = false,
    onToggleFavorite,
    onClick,
    menuActions,
    focused = false,
    runtimeError = false,
    upgradeAvailable = false,
}: Props) {
    const view = useMemo(() => getAgentView(agent), [agent]);
    const stats = useMemo(() => getRuntimeStats(runs), [runs]);

    const isPaused = agent.status === 'inactive';
    const statusLabel = isPaused ? 'Idle' : stats.queueDepth > 0 ? 'Queued' : 'Running';
    // Mercury collapses brand-hue slots (`green`, `gold`) to neutral accent —
    // black in light / white in dark — so they can't carry semantic meaning.
    // The live-state indicator needs the functional success/warning slots,
    // which keep their actual green / amber values across both themes.
    const statusColor = isPaused
        ? ATLAS_PALETTE.slate60
        : statusLabel === 'Queued'
          ? ATLAS_PALETTE.warning
          : ATLAS_PALETTE.success;

    const lastRunLabel = runtimeError
        ? 'last run —'
        : `last run ${stats.lastRunAt ? relativeTime(stats.lastRunAt) : '—'}`;

    function handleCardClick(e: React.MouseEvent<HTMLDivElement>) {
        // Guard against clicks that originated inside an open MUI Menu /
        // Popover overlay. The backdrop closes the menu, but the underlying
        // click event still reaches the card unless we filter it here.
        const target = e.target as HTMLElement | null;
        if (
            target?.closest(
                '.MuiMenu-root, .MuiPopover-root, .MuiModal-root, .MuiBackdrop-root'
            )
        ) {
            return;
        }
        onClick?.();
    }

    return (
        <Box
            onClick={handleCardClick}
            tabIndex={0}
            role="button"
            sx={{
                position: 'relative',
                background: ATLAS_PALETTE.white,
                border: `1px solid ${focused ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate10}`,
                outline: focused ? `2px solid ${ATLAS_PALETTE.brandBlue}` : 'none',
                outlineOffset: focused ? '-2px' : 0,
                borderRadius: '12px',
                p: 3,
                cursor: 'pointer',
                transition: 'box-shadow 150ms ease, transform 150ms ease, border-color 150ms ease',
                display: 'flex',
                flexDirection: 'column',
                // Belt-and-suspenders: the card is a grid item with a
                // minmax(0, 1fr) column on every breakpoint, so it
                // shouldn't grow past its track. Keep minWidth: 0 here
                // anyway in case a future caller drops the minmax.
                minWidth: 0,
                maxWidth: '100%',
                overflow: 'hidden',
                '&:hover': {
                    boxShadow: '0 4px 12px rgba(0,0,14,.08)',
                    transform: 'translateY(-1px)',
                    borderColor: focused ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate12,
                },
                '&:focus-visible': {
                    outline: `2px solid ${ATLAS_PALETTE.brandBlue}`,
                    outlineOffset: '-2px',
                },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
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
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Typography
                            title={agent.name}
                            sx={{
                                fontSize: 15,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate,
                                lineHeight: 1.25,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {agent.name}
                        </Typography>
                        {upgradeAvailable && (
                            <Tooltip title="Marketplace upgrade available" arrow>
                                <Box
                                    sx={{
                                        flexShrink: 0,
                                        px: 1,
                                        height: 18,
                                        borderRadius: '9px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        bgcolor: ATLAS_PALETTE.warnSoft,
                                        color: ATLAS_PALETTE.warnFg,
                                        fontSize: 10,
                                        fontWeight: 600,
                                        letterSpacing: '0.04em',
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    Upgrade
                                </Box>
                            </Tooltip>
                        )}
                    </Box>
                    <Typography sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60, mt: '2px' }}>
                        {agentSubtitle(agent)}
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {onToggleFavorite ? (
                        <Tooltip
                            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                            arrow
                        >
                            <Box
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleFavorite();
                                }}
                                sx={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: '6px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    color: isFavorite
                                        ? ATLAS_PALETTE.gold
                                        : ATLAS_PALETTE.slate40,
                                    transition: 'color 150ms ease, background 150ms ease',
                                    '&:hover': {
                                        background: ATLAS_PALETTE.slate08,
                                        color: isFavorite
                                            ? ATLAS_PALETTE.gold
                                            : ATLAS_PALETTE.slate60,
                                    },
                                }}
                            >
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{
                                        fontSize: 18,
                                        fontVariationSettings: isFavorite ? '"FILL" 1' : '"FILL" 0',
                                    }}
                                >
                                    star
                                </Box>
                            </Box>
                        </Tooltip>
                    ) : null}
                    {menuActions ? (
                        <AgentCardMenu actions={{ ...menuActions, paused: isPaused }} />
                    ) : null}
                </Box>
            </Box>

            <Typography
                sx={{
                    fontSize: 12.5,
                    color: ATLAS_PALETTE.slate70,
                    lineHeight: 1.55,
                    mb: 2.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                }}
            >
                {view.description}
            </Typography>

            <Box
                sx={{
                    display: 'grid',
                    // minmax(0, 1fr) is what lets the value column actually
                    // shrink — a plain `1fr` falls back to `min-width: auto`
                    // (content-based) for grid items, so a long Model name
                    // would push the whole card wider than its column.
                    gridTemplateColumns: 'auto minmax(0, 1fr)',
                    columnGap: 1.5,
                    rowGap: '4px',
                    p: '10px 12px',
                    minWidth: 0,
                    background: ATLAS_PALETTE.slate08,
                    borderRadius: '8px',
                    mb: 2.5,
                }}
            >
                {[
                    ['CLI', agent.cli],
                    ['Model', agent.model],
                    ['Schedule', `${view.cadenceLabel.toLowerCase()} · next ${view.nextPassDelta}`],
                ].map(([k, v]) => (
                    <Box key={k} sx={{ display: 'contents' }}>
                        <Typography
                            sx={{
                                fontSize: 11,
                                fontWeight: 500,
                                color: ATLAS_PALETTE.slate60,
                                lineHeight: '18px',
                            }}
                        >
                            {k}
                        </Typography>
                        <Typography
                            sx={{
                                fontSize: 11.5,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                color: ATLAS_PALETTE.slate,
                                lineHeight: '18px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {v}
                        </Typography>
                    </Box>
                ))}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 'auto' }}>
                {/* gap=1.5 (12px) clears the LiveDot ripple's ~7px overshoot
                    at peak scale (2.6x of the 9px dot) so the expanding ring
                    never visually collides with the "Running" label. */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    {statusLabel === 'Running' ? (
                        <LiveDot size={9} hex={statusColor} label={statusLabel} />
                    ) : (
                        <Box
                            sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '9999px',
                                background: statusColor,
                            }}
                        />
                    )}
                    <Typography sx={{ fontSize: 12, fontWeight: 500, color: statusColor }}>
                        {statusLabel}
                    </Typography>
                </Box>
                <Typography sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60 }}>
                    queue {stats.queueDepth}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate40 }}>·</Typography>
                <Typography sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60 }}>
                    {lastRunLabel}
                </Typography>
                {stats.totalCostThisMonthUsd != null && (
                    <>
                        <Typography sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate40 }}>·</Typography>
                        <Typography sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60 }}>
                            {formatCostUsd(stats.totalCostThisMonthUsd)} ({new Date().toLocaleString('default', { month: 'short' })})
                        </Typography>
                    </>
                )}
            </Box>
        </Box>
    );
}
