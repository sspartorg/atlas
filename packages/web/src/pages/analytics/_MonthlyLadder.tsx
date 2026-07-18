import {
    Bar,
    Cell,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { Card, ChartEmpty, ChartTitle, CHART_COLORS, MONO } from './_chrome.js';

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
    const hasData = momData.some(
        (m) => m.cost > 0 || m.terminalCost > 0 || m.runs > 0,
    );
    if (!hasData) {
        return (
            <Card>
                <ChartTitle
                    eyebrow="Month over month"
                    title="Trailing 12 months"
                    sub="Agentic + terminal spend per calendar month, with completed agent-run volume overlaid."
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
                eyebrow="Month over month"
                title="Trailing 12 months"
                sub="Bars stack agentic cost (blue) under manual terminal cost (orange) per calendar month. The gold line is completed agent-run volume on the right axis. The current month renders solid; prior months are faded."
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
                            <stop offset="0%" stopColor={CHART_COLORS.terminal} stopOpacity={0.55} />
                            <stop offset="100%" stopColor={CHART_COLORS.terminal} stopOpacity={0.32} />
                        </linearGradient>
                        <linearGradient id="momTermBarCurrent" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_COLORS.terminal} stopOpacity={1} />
                            <stop offset="100%" stopColor={CHART_COLORS.terminal} stopOpacity={0.78} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 5" stroke={CHART_COLORS.grid} vertical={false} />
                    <XAxis
                        dataKey="month"
                        tick={{ fontSize: 11, fill: ATLAS_PALETTE.slate60, fontFamily: MONO, fontWeight: 600 }}
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
                    <YAxis
                        yAxisId="runs"
                        orientation="right"
                        tick={{ fontSize: 11, fill: ATLAS_PALETTE.slate40, fontFamily: MONO }}
                        width={44}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip
                        cursor={{ fill: 'rgba(0,122,201,.04)' }}
                        formatter={(v: unknown, name: unknown) =>
                            name === 'Agentic cost' || name === 'Terminal cost'
                                ? `$${Number(v).toFixed(4)}`
                                : String(v)
                        }
                        contentStyle={{
                            fontSize: 12,
                            borderRadius: '10px',
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            boxShadow: '0 10px 30px rgba(11,31,68,.12)',
                            fontFamily: MONO,
                        }}
                        labelStyle={{ fontFamily: TYPOGRAPHY.fontFamily, fontWeight: 600 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="circle" iconSize={8} />
                    <Bar
                        yAxisId="cost"
                        dataKey="cost"
                        name="Agentic cost"
                        stackId="cost"
                        isAnimationActive
                        animationDuration={900}
                    >
                        {momData.map((m, idx) => (
                            <Cell
                                key={`a:${m.key}`}
                                fill={idx === momData.length - 1 ? 'url(#momCostBarCurrent)' : 'url(#momCostBar)'}
                            />
                        ))}
                    </Bar>
                    <Bar
                        yAxisId="cost"
                        dataKey="terminalCost"
                        name="Terminal cost"
                        stackId="cost"
                        radius={[6, 6, 0, 0]}
                        isAnimationActive
                        animationDuration={900}
                    >
                        {momData.map((m, idx) => (
                            <Cell
                                key={`t:${m.key}`}
                                fill={idx === momData.length - 1 ? 'url(#momTermBarCurrent)' : 'url(#momTermBar)'}
                            />
                        ))}
                    </Bar>
                    <Line
                        yAxisId="runs"
                        type="monotone"
                        dataKey="runs"
                        name="Runs"
                        stroke={CHART_COLORS.runs}
                        strokeWidth={2.5}
                        dot={{ r: 3.5, fill: ATLAS_PALETTE.surfaceRaised, stroke: CHART_COLORS.runs, strokeWidth: 2 }}
                        activeDot={{ r: 6, fill: CHART_COLORS.runs, stroke: ATLAS_PALETTE.surfaceRaised, strokeWidth: 2 }}
                    />
                </ComposedChart>
            </ResponsiveContainer>
        </Card>
    );
}

export default MonthlyLadder;
