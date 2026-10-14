import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ATLAS_PALETTE, ELEVATION } from '../../theme/tokens.js';
import { LiveDot } from '../../components/LiveDot.js';
import { useActiveRuns } from '../../hooks/useActiveRuns.js';
import { formatCostUsd, formatTokenCount } from '../../utils/formatCost.js';
import type { ICostTotals } from './costTotals.js';
import type { AgentSummary } from '../../api/types.js';

interface IFleetStripProps {
    /** Active agents only. */
    agents: AgentSummary[];
    liveCount: number;
    spend: ICostTotals | null;
}

// Past this many the dot row stops growing and says "+N".
const MAX_DOTS = 40;

function Cell({
    value,
    unit,
    valueColor = ATLAS_PALETTE.slate,
    adornment,
    children,
    sx,
}: {
    value: string;
    unit: string;
    valueColor?: string;
    adornment?: ReactNode;
    children: ReactNode;
    sx?: object;
}) {
    return (
        <Box sx={{ minWidth: 0, px: { xs: 4, sm: 5 }, py: 4, ...sx }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 2 }}>
                {adornment}
                <Typography
                    component="span"
                    sx={{
                        fontSize: { xs: '1.5rem', sm: '1.75rem' },
                        fontWeight: 700,
                        lineHeight: 1.1,
                        letterSpacing: '-0.02em',
                        fontVariantNumeric: 'tabular-nums',
                        color: valueColor,
                    }}
                >
                    {value}
                </Typography>
                <Typography
                    component="span"
                    sx={{ fontSize: 13, fontWeight: 500, color: ATLAS_PALETTE.slate60 }}
                >
                    {unit}
                </Typography>
            </Box>
            <Box sx={{ mt: 2, minHeight: 18, display: 'flex', alignItems: 'center' }}>
                {children}
            </Box>
        </Box>
    );
}

// The dashboard's at-a-glance read of the fleet: who's there (one dot per
// agent, green while working), what's live, and what this month cost.
export function FleetStrip({ agents, liveCount, spend }: IFleetStripProps) {
    const { agentIds: busy } = useActiveRuns();
    const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true });
    // Working agents first so they're visible even when the row is capped.
    const ordered = [...agents].sort((a, b) => Number(busy.has(b.id)) - Number(busy.has(a.id)));
    const dots = ordered.slice(0, MAX_DOTS);
    const working = agents.filter((a) => busy.has(a.id)).length;
    const live = liveCount > 0;

    const divider = `1px solid ${ATLAS_PALETTE.slate08}`;

    return (
        <Paper
            elevation={0}
            component="section"
            aria-label="Fleet at a glance"
            sx={{
                bgcolor: 'background.paper',
                borderRadius: '8px',
                boxShadow: ELEVATION.low,
                display: 'grid',
                gridTemplateColumns: {
                    xs: 'minmax(0, 1fr) minmax(0, 1fr)',
                    md: 'minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1.2fr)',
                },
            }}
        >
            <Cell
                value={String(agents.length)}
                unit={agents.length === 1 ? 'agent' : 'agents'}
                sx={{
                    gridColumn: { xs: '1 / -1', md: 'auto' },
                    borderBottom: { xs: divider, md: 'none' },
                    borderRight: { md: divider },
                }}
            >
                <Box
                    role="img"
                    aria-label={`${working} of ${agents.length} agents working`}
                    sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}
                >
                    {dots.map((a) => (
                        <Box
                            key={a.id}
                            // Plain title, not a Tooltip: 40 Tooltips is a lot
                            // to mount for a hover hint the summary label covers.
                            title={`${a.name}, ${busy.has(a.id) ? 'working' : 'idle'}`}
                            sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '2px',
                                bgcolor: busy.has(a.id)
                                    ? ATLAS_PALETTE.success
                                    : ATLAS_PALETTE.slate12,
                            }}
                        />
                    ))}
                    {agents.length > MAX_DOTS && (
                        <Typography sx={{ ml: 1, fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                            +{agents.length - MAX_DOTS}
                        </Typography>
                    )}
                    <Typography sx={{ ml: 2, fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                        {working > 0 ? `${working} working` : 'all idle'}
                    </Typography>
                </Box>
            </Cell>

            <Cell
                value={String(liveCount)}
                unit={liveCount === 1 ? 'run live' : 'runs live'}
                valueColor={live ? ATLAS_PALETTE.success : ATLAS_PALETTE.slate40}
                adornment={
                    live ? (
                        <Box sx={{ alignSelf: 'center', display: 'flex' }}>
                            <LiveDot
                                size={10}
                                animate={!reduceMotion}
                                label={`${liveCount} live`}
                            />
                        </Box>
                    ) : undefined
                }
                sx={{ borderRight: divider }}
            >
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                    {live ? 'Agents at work right now' : 'All quiet right now'}
                </Typography>
            </Cell>

            <Cell value={spend ? formatCostUsd(spend.usd) : '—'} unit="this month">
                <Typography noWrap sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                    {spend
                        ? `${spend.runs} ${spend.runs === 1 ? 'run' : 'runs'}, ${formatTokenCount(spend.tokens)} tokens`
                        : 'No spend yet this month'}
                </Typography>
            </Cell>
        </Paper>
    );
}
