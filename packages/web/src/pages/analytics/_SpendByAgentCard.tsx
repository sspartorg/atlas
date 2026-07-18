import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { LABEL_COLORS, ATLAS_PALETTE, type LabelColorKey } from '../../theme/tokens.js';
import { formatCostUsd } from '../../utils/formatCost.js';
import { useThemeModeContext } from '../../hooks/useThemeModeContext.js';
import { Card, ChartEmpty, ChartTitle, CHART_COLORS, MONO } from './_chrome.js';

interface AgentRow {
    agent_id: string;
    agent_name: string;
    total_cost_usd: number;
    run_count: number;
}

interface Props {
    byAgent: AgentRow[];
    totalAgentCost: number;
}

// Chart series ramp keys — resolved per-mode below. Mirrors the ladder
// used in Analytics.tsx so the donut keeps its mode-aware palette after
// being lifted out of the page file.
const CHART_RAMP_KEYS = [
    'emerald',
    'sky',
    'rose',
    'amber',
    'indigo',
    'violet',
    'teal',
    'yellow',
] as const;

export function SpendByAgentCard({ byAgent, totalAgentCost }: Props) {
    const { mode } = useThemeModeContext();
    const AGENT_RING = useMemo(
        () =>
            (CHART_RAMP_KEYS as readonly LabelColorKey[]).map(
                (key) => LABEL_COLORS[key][mode].border,
            ),
        [mode],
    );

    if (byAgent.length === 0) {
        return (
            <Card>
                <ChartTitle
                    eyebrow="Spend by agent"
                    title="Cost share of the active fleet"
                    sub="Distribution of agent spend across the fleet for the current month."
                />
                <ChartEmpty
                    label="No agent spend this month"
                    sub="Each completed run is attributed back to its agent — the donut fills in as soon as one lands."
                />
            </Card>
        );
    }

    return (
        <Card>
            <ChartTitle
                eyebrow="Spend by agent"
                title="Cost share of the active fleet"
                sub={`${byAgent.length} agent${byAgent.length === 1 ? '' : 's'} ran this month · ${formatCostUsd(totalAgentCost)} attributed.`}
            />
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: { xs: 'column', sm: 'row' },
                    alignItems: { xs: 'stretch', sm: 'center' },
                    gap: 3,
                }}
            >
                <Box
                    sx={{
                        position: 'relative',
                        width: 200,
                        height: 200,
                        flexShrink: 0,
                        alignSelf: { xs: 'center', sm: 'auto' },
                    }}
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={byAgent.slice(0, 8).map((a) => ({
                                    name: a.agent_name,
                                    value: a.total_cost_usd,
                                }))}
                                dataKey="value"
                                innerRadius={62}
                                outerRadius={92}
                                paddingAngle={2}
                                strokeWidth={0}
                                isAnimationActive
                                animationDuration={900}
                            >
                                {byAgent.slice(0, 8).map((_, i) => (
                                    <Cell
                                        key={i}
                                        fill={AGENT_RING[i % AGENT_RING.length] ?? ATLAS_PALETTE.brandBlue}
                                    />
                                ))}
                            </Pie>
                            <Tooltip
                                formatter={(v: unknown) => `$${Number(v).toFixed(4)}`}
                                contentStyle={{
                                    fontSize: 12,
                                    borderRadius: '10px',
                                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                    fontFamily: MONO,
                                }}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                    <Box
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            pointerEvents: 'none',
                        }}
                    >
                        <Typography
                            sx={{
                                fontFamily: MONO,
                                fontSize: 9.5,
                                letterSpacing: '0.18em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.slate40,
                                fontWeight: 600,
                            }}
                        >
                            Total
                        </Typography>
                        <Typography
                            sx={{
                                fontSize: 22,
                                fontWeight: 700,
                                color: ATLAS_PALETTE.slate,
                                fontVariantNumeric: 'tabular-nums',
                                lineHeight: 1.1,
                                mt: 0.25,
                            }}
                        >
                            {formatCostUsd(totalAgentCost)}
                        </Typography>
                        <Typography
                            sx={{
                                fontFamily: MONO,
                                fontSize: 10.5,
                                color: ATLAS_PALETTE.slate60,
                                mt: 0.25,
                            }}
                        >
                            {byAgent.length} agent{byAgent.length === 1 ? '' : 's'}
                        </Typography>
                    </Box>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    {byAgent.slice(0, 6).map((a, i) => {
                        const pct = totalAgentCost > 0 ? (a.total_cost_usd / totalAgentCost) * 100 : 0;
                        return (
                            <Box
                                key={a.agent_id}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1.5,
                                    py: 0.75,
                                    borderBottom:
                                        i < Math.min(5, byAgent.length - 1)
                                            ? `1px solid ${CHART_COLORS.grid}`
                                            : 'none',
                                }}
                            >
                                <Box
                                    sx={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: '3px',
                                        background: AGENT_RING[i % AGENT_RING.length],
                                        flexShrink: 0,
                                    }}
                                />
                                <Typography
                                    sx={{
                                        flex: 1,
                                        fontSize: 12.5,
                                        color: ATLAS_PALETTE.slate,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        minWidth: 0,
                                    }}
                                    title={a.agent_name}
                                >
                                    {a.agent_name}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate60,
                                        minWidth: 36,
                                        textAlign: 'right',
                                    }}
                                >
                                    {pct.toFixed(1)}%
                                </Typography>
                            </Box>
                        );
                    })}
                </Box>
            </Box>
        </Card>
    );
}

export default SpendByAgentCard;
