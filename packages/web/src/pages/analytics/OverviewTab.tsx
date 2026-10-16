import { useMemo } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AnalyticsWindow } from '@atlas/shared';
import { useAnalyticsDelivery, useAnalyticsSpend, useAnalyticsWorkflows } from '../../hooks/useAnalytics.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { formatCostUsd } from '../../utils/formatCost.js';
import { formatSpan } from '../../utils/time.js';
import {
    AXIS_TICK,
    bucketLabel,
    Card,
    CHART_COLORS,
    ChartTitle,
    Delta,
    formatRate,
    Hero,
    mondayOf,
    previousLabel,
    StatTile,
    TabSkeleton,
    TileGrid,
    TOOLTIP_STYLE,
    LEGEND_PROPS,
    usdTick,
    usdTooltip,
} from './_chrome.js';
import { pickInsight, totalSpend } from './_insight.js';

export function OverviewTab({ window }: { window: AnalyticsWindow }) {
    const spend = useAnalyticsSpend(window);
    const delivery = useAnalyticsDelivery(window);
    const workflows = useAnalyticsWorkflows(window);

    const s = spend.data;
    const d = delivery.data;
    const w = workflows.data;

    // Spend comes back per day; on a weekly window it is rolled into the same
    // Monday buckets the delivery series uses, so the two charts line up.
    const series = useMemo(() => {
        if (!s || !d) return [];
        const spendBy = new Map<string, { agentic: number; terminal: number }>();
        for (const row of s.daily) {
            const key = d.period.bucket === 'week' ? mondayOf(row.date) : row.date;
            const e = spendBy.get(key) ?? { agentic: 0, terminal: 0 };
            e.agentic += row.total_cost_usd;
            e.terminal += row.terminal_total_cost_usd ?? 0;
            spendBy.set(key, e);
        }
        return d.throughput.map((b) => ({
            label: bucketLabel(b.bucket),
            tasks: b.tasks,
            agentic: Number((spendBy.get(b.bucket)?.agentic ?? 0).toFixed(4)),
            terminal: Number((spendBy.get(b.bucket)?.terminal ?? 0).toFixed(4)),
        }));
    }, [s, d]);

    const error = spend.error ?? delivery.error ?? workflows.error;
    if (error) return <Alert severity="error">Could not load analytics: {(error as Error).message}</Alert>;
    if (!s || !d || !w) return <TabSkeleton />;

    const insight = pickInsight(s, d, w);
    const vs = previousLabel(window);
    const cur = totalSpend(s);
    const prevSpend = (s.previous?.total_cost_usd ?? 0) + (s.previous?.terminal_total_cost_usd ?? 0);
    const perTask = d.shipped.tasks > 0 ? cur / d.shipped.tasks : null;
    const prevPerTask = d.previous.tasks_shipped > 0 ? prevSpend / d.previous.tasks_shipped : null;
    const finished = w.runs.completed + w.runs.cancelled + w.runs.error;
    const unit = d.period.bucket === 'week' ? 'week' : 'day';

    return (
        <Box sx={{ display: 'grid', gap: { xs: 2, md: 3 } }}>
            <Hero
                titleComponent="h2"
                breadcrumb={
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: ATLAS_PALETTE.accentFg }}>
                        {insight.label}
                    </Typography>
                }
                title={insight.sentence}
            />

            <TileGrid cols={3}>
                <StatTile
                    label="Tasks shipped"
                    value={d.shipped.tasks.toLocaleString()}
                    definition="Tasks whose first move into Done falls in this window. Sub-tasks are counted on the Delivery tab; agent-test Tasks are left out."
                    caption={<><Delta cur={d.shipped.tasks} prev={d.previous.tasks_shipped} goodWhen="up" /> {vs}</>}
                />
                <StatTile
                    label="Median cycle time"
                    value={formatSpan(d.cycle_time.p50_s)}
                    definition="Cycle time = a Task's first move into In progress → its first move into Done. The median over the Tasks shipped in this window."
                    caption={<><Delta cur={d.cycle_time.p50_s} prev={d.previous.cycle_p50_s} goodWhen="down" /> {vs}</>}
                />
                <StatTile
                    label="PRs merged"
                    value={d.prs.merged.toLocaleString()}
                    definition="PRs opened by workflow runs that started in this window, merged as last checked on GitHub. Agent tests are left out."
                    caption={<>of {d.prs.opened.toLocaleString()} opened · <Delta cur={d.prs.merged} prev={d.previous.prs_merged} goodWhen="up" /></>}
                />
                <StatTile
                    label="Workflow success rate"
                    value={formatRate(w.runs.success_rate)}
                    definition="Completed ÷ finished workflow runs (completed, cancelled or error) started in this window. Runs still going or waiting for you are left out."
                    caption={<>{w.runs.completed} of {finished} finished · <Delta cur={w.runs.success_rate} prev={w.previous.success_rate} goodWhen="up" points /></>}
                />
                <StatTile
                    label="Spend"
                    value={formatCostUsd(cur)}
                    definition="Completed agent runs plus closed terminal sessions in this window."
                    caption={<><Delta cur={cur} prev={prevSpend} goodWhen="down" /> {vs}</>}
                />
                <StatTile
                    label="Cost per shipped Task"
                    value={perTask === null ? '—' : formatCostUsd(perTask)}
                    definition="All spend in the window ÷ Tasks shipped in the window. It includes work still in flight, so it is an all-in unit cost rather than one Task's bill."
                    caption={<><Delta cur={perTask} prev={prevPerTask} goodWhen="down" /> {vs}</>}
                />
            </TileGrid>

            <Card>
                <ChartTitle
                    title={`Shipped and spent, per ${unit}`}
                    sub={`Two charts on one time axis, each on its own scale: Tasks first moved into Done, then what agent runs and terminal sessions cost in the same ${unit}.`}
                />
                <Box>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: ATLAS_PALETTE.slate60, mb: 0.5 }}>Tasks shipped</Typography>
                    <ResponsiveContainer width="100%" height={150}>
                        <BarChart data={series} syncId="overview" margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
                            <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                            <XAxis dataKey="label" hide />
                            <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={48} />
                            <Tooltip {...TOOLTIP_STYLE} />
                            <Bar dataKey="tasks" name="Tasks shipped" fill={CHART_COLORS.task} radius={[4, 4, 0, 0]} maxBarSize={22} />
                        </BarChart>
                    </ResponsiveContainer>
                </Box>
                <Box sx={{ mt: 2 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: ATLAS_PALETTE.slate60, mb: 0.5 }}>Spend</Typography>
                    <ResponsiveContainer width="100%" height={190}>
                        <BarChart data={series} syncId="overview" margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
                            <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_COLORS.rail }} tickLine={false} minTickGap={16} />
                            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={usdTick} />
                            <Tooltip {...TOOLTIP_STYLE} formatter={usdTooltip} />
                            <Legend {...LEGEND_PROPS} />
                            <Bar dataKey="agentic" name="Agent runs" stackId="s" fill={CHART_COLORS.cost} stroke={ATLAS_PALETTE.white} strokeWidth={1} maxBarSize={22} />
                            <Bar dataKey="terminal" name="Terminal sessions" stackId="s" fill={CHART_COLORS.terminal} stroke={ATLAS_PALETTE.white} strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={22} />
                        </BarChart>
                    </ResponsiveContainer>
                </Box>
            </Card>
        </Box>
    );
}
