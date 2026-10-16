import {
    Bar,
    Cell,
    CartesianGrid,
    ComposedChart,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { Card, ChartEmpty, ChartTitle, CHART_COLORS, LEGEND_PROPS, MONO, usdTooltip } from './_chrome.js';

interface MomRow {
    month: string;
    key: string;
    cost: number;
    terminalCost: number;
    runs: number;
    terminalSessions: number;
    input: number;
    output: number;
    cached: number;
}

export function MonthlyLadder({ momData }: { momData: MomRow[] }) {
    const hasData = momData.some((m) => m.cost > 0 || m.terminalCost > 0 || m.runs > 0);
    if (!hasData) {
        return (
            <Card>
                <ChartTitle
                    title="Trailing 12 months"
                    sub="Agent-run plus terminal-session spend per calendar month."
                />
                <ChartEmpty
                    label="No spend in the trailing 12 months"
                    sub="Once agent runs complete or terminal sessions close, the monthly ladder fills in here."
                />
            </Card>
        );
    }
    return (
        <Card>
            <ChartTitle
                title="Trailing 12 months"
                sub="Agent-run cost stacked under terminal-session cost per calendar month, whatever window is picked above. The current month is solid; earlier months are faded."
            />
            <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={momData} margin={{ top: 4, right: 16, left: -8, bottom: 0 }}>
                    <defs>
                        <linearGradient id="momCostBar" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_COLORS.cost} stopOpacity={0.55} />
                            <stop offset="100%" stopColor={CHART_COLORS.cost} stopOpacity={0.32} />
                        </linearGradient>
                        <linearGradient id="momCostBarCurrent" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_COLORS.cost} stopOpacity={1} />
                            <stop offset="100%" stopColor={CHART_COLORS.cost} stopOpacity={0.78} />
                        </linearGradient>
                        <linearGradient id="momTermBar" x1="0" y1="0" x2="0" y2="1">
                            <stop
                                offset="0%"
                                stopColor={CHART_COLORS.terminal}
                                stopOpacity={0.55}
                            />
                            <stop
                                offset="100%"
                                stopColor={CHART_COLORS.terminal}
                                stopOpacity={0.32}
                            />
                        </linearGradient>
                        <linearGradient id="momTermBarCurrent" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_COLORS.terminal} stopOpacity={1} />
                            <stop
                                offset="100%"
                                stopColor={CHART_COLORS.terminal}
                                stopOpacity={0.78}
                            />
                        </linearGradient>
                    </defs>
                    <CartesianGrid
                        strokeDasharray="2 5"
                        stroke={CHART_COLORS.grid}
                        vertical={false}
                    />
                    <XAxis
                        dataKey="month"
                        tick={{
                            fontSize: 11,
                            fill: ATLAS_PALETTE.slate60,
                            fontFamily: MONO,
                            fontWeight: 600,
                        }}
                        axisLine={{ stroke: CHART_COLORS.rail }}
                        tickLine={false}
                    />
                    <YAxis
                        yAxisId="cost"
                        tick={{ fontSize: 11, fill: ATLAS_PALETTE.slate40, fontFamily: MONO }}
                        tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                        width={64}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip
                        cursor={{ fill: 'rgba(127,127,127,.10)' }}
                        formatter={usdTooltip}
                        contentStyle={{
                            fontSize: 12,
                            borderRadius: '10px',
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            boxShadow: 'var(--atlas-elevation-mid)',
                            background: ATLAS_PALETTE.surfaceRaised,
                            color: ATLAS_PALETTE.slate,
                            fontFamily: MONO,
                        }}
                        labelStyle={{ fontFamily: TYPOGRAPHY.fontFamily, fontWeight: 600 }}
                    />
                    <Legend {...LEGEND_PROPS} />
                    <Bar
                        yAxisId="cost"
                        dataKey="cost"
                        name="Agentic cost"
                        stackId="cost"
                        fill={CHART_COLORS.cost}
                        isAnimationActive
                        animationDuration={900}
                    >
                        {momData.map((m, idx) => (
                            <Cell
                                key={`a:${m.key}`}
                                fill={
                                    idx === momData.length - 1
                                        ? 'url(#momCostBarCurrent)'
                                        : 'url(#momCostBar)'
                                }
                            />
                        ))}
                    </Bar>
                    <Bar
                        yAxisId="cost"
                        dataKey="terminalCost"
                        name="Terminal cost"
                        stackId="cost"
                        fill={CHART_COLORS.terminal}
                        radius={[6, 6, 0, 0]}
                        isAnimationActive
                        animationDuration={900}
                    >
                        {momData.map((m, idx) => (
                            <Cell
                                key={`t:${m.key}`}
                                fill={
                                    idx === momData.length - 1
                                        ? 'url(#momTermBarCurrent)'
                                        : 'url(#momTermBar)'
                                }
                            />
                        ))}
                    </Bar>
                </ComposedChart>
            </ResponsiveContainer>
        </Card>
    );
}

export default MonthlyLadder;
