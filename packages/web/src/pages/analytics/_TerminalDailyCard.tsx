import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { formatCostUsd, formatTokenCount } from '../../utils/formatCost.js';
import { Card, ChartEmpty, ChartTitle, CHART_COLORS, MONO } from './_chrome.js';

export interface TerminalDailyDatum {
    date: string;
    cost: number;
    input: number;
    output: number;
    cached: number;
    sessions: number;
}

interface Props {
    data: TerminalDailyDatum[];
    monthLabel: string;
    activeDays: number;
    sessionCount: number;
    totalTerminalTokens: number;
    totalTerminalCost: number;
}

export function TerminalDailyCard({
    data,
    monthLabel,
    activeDays,
    sessionCount,
    totalTerminalTokens,
    totalTerminalCost,
}: Props) {
    const hasData = data.some(
        (d) => d.cost > 0 || d.input > 0 || d.output > 0 || d.cached > 0,
    );

    return (
        <Card>
            <ChartTitle
                eyebrow="Daily trend · terminal"
                title={`Manual terminal sessions — ${monthLabel}`}
                sub={
                    hasData
                        ? `${activeDays} active day${activeDays === 1 ? '' : 's'} · ${sessionCount.toLocaleString()} session${sessionCount === 1 ? '' : 's'} closed · ${formatTokenCount(totalTerminalTokens)} tokens · ${formatCostUsd(totalTerminalCost)} spend.`
                        : `Cost + token throughput from owner-driven terminal sessions this month.`
                }
            />
            {hasData ? (
                <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart
                        data={data}
                        margin={{ top: 4, right: 12, left: -8, bottom: 0 }}
                    >
                        <defs>
                            <linearGradient id="terminalInputGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={CHART_COLORS.input} stopOpacity={0.7} />
                                <stop offset="100%" stopColor={CHART_COLORS.input} stopOpacity={0.45} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="2 5" stroke={CHART_COLORS.grid} vertical={false} />
                        <XAxis
                            dataKey="date"
                            tick={{ fontSize: 11, fill: ATLAS_PALETTE.slate40, fontFamily: MONO }}
                            axisLine={{ stroke: CHART_COLORS.rail }}
                            tickLine={false}
                        />
                        <YAxis
                            yAxisId="cost"
                            tick={{ fontSize: 11, fill: ATLAS_PALETTE.slate40, fontFamily: MONO }}
                            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                            width={60}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            yAxisId="tok"
                            orientation="right"
                            tick={{ fontSize: 11, fill: ATLAS_PALETTE.slate40, fontFamily: MONO }}
                            tickFormatter={(v: number) => formatTokenCount(v)}
                            width={50}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip
                            cursor={{ fill: 'rgba(127,127,127,.10)' }}
                            formatter={(v, name) =>
                                name === 'Terminal cost'
                                    ? `$${Number(v).toFixed(4)}`
                                    : formatTokenCount(Number(v))
                            }
                            contentStyle={{
                                fontSize: 12,
                                background: ATLAS_PALETTE.surfaceRaised,
                                borderRadius: '10px',
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                boxShadow: 'var(--atlas-elevation-mid)',
                                fontFamily: MONO,
                                color: ATLAS_PALETTE.slate,
                            }}
                            labelStyle={{
                                fontFamily: TYPOGRAPHY.fontFamily,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate,
                            }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="circle" iconSize={8} />
                        <Bar
                            yAxisId="tok"
                            dataKey="input"
                            name="Input tokens"
                            stackId="t"
                            fill="url(#terminalInputGrad)"
                        />
                        <Bar
                            yAxisId="tok"
                            dataKey="output"
                            name="Output tokens"
                            stackId="t"
                            fill={CHART_COLORS.output}
                            fillOpacity={0.75}
                        />
                        <Bar
                            yAxisId="tok"
                            dataKey="cached"
                            name="Cached tokens"
                            stackId="t"
                            fill={CHART_COLORS.cached}
                            fillOpacity={0.55}
                            radius={[3, 3, 0, 0]}
                        />
                        <Bar
                            yAxisId="cost"
                            dataKey="cost"
                            name="Terminal cost"
                            fill={CHART_COLORS.terminal}
                            fillOpacity={0.85}
                            radius={[3, 3, 0, 0]}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            ) : (
                <ChartEmpty
                    label={`No terminal sessions for ${monthLabel}`}
                    sub="Cost and token throughput will appear here once a manual session is closed this month."
                />
            )}
        </Card>
    );
}

export default TerminalDailyCard;
