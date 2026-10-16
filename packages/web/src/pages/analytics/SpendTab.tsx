import { lazy, Suspense, useMemo } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AnalyticsWindow } from '@atlas/shared';
import { useAnalyticsSpend } from '../../hooks/useAnalytics.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { formatCostUsd, formatTokenCount } from '../../utils/formatCost.js';
import {
    AXIS_TICK,
    BarList,
    bucketLabel,
    Card,
    CardGrid,
    CHART_COLORS,
    ChartEmpty,
    ChartTitle,
    Delta,
    mondayOf,
    previousLabel,
    StatTile,
    TabSkeleton,
    TileGrid,
    TOOLTIP_STYLE,
    LEGEND_PROPS,
    WINDOW_LABEL,
    tokenTick,
    tokenTooltip,
    usdTick,
    usdTooltip,
} from './_chrome.js';
import { totalSpend } from './_insight.js';

const MonthlyLadder = lazy(() => import('./_MonthlyLadder.js'));
const SpendByAgentCard = lazy(() => import('./_SpendByAgentCard.js'));
const ProjectCostBars = lazy(() => import('./_ProjectCostBars.js'));
const TopRunsTable = lazy(() => import('./_TopRunsTable.js'));
const TerminalSessionsCard = lazy(() => import('./_TerminalSessionsCard.js'));

const EMPTY_TERMINAL = {
    total_cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    session_count: 0,
};

function monthLabelOf(ym: string): string {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

export function SpendTab({ window }: { window: AnalyticsWindow }) {
    const { data: s, error } = useAnalyticsSpend(window);
    const weekly = window === '90d';

    const series = useMemo(() => {
        const by = new Map<string, { agentic: number; terminal: number; input: number; output: number; cached: number }>();
        for (const d of s?.daily ?? []) {
            const key = weekly ? mondayOf(d.date) : d.date;
            const e = by.get(key) ?? { agentic: 0, terminal: 0, input: 0, output: 0, cached: 0 };
            e.agentic += d.total_cost_usd;
            e.terminal += d.terminal_total_cost_usd ?? 0;
            e.input += d.input_tokens + (d.terminal_input_tokens ?? 0);
            e.output += d.output_tokens + (d.terminal_output_tokens ?? 0);
            e.cached += d.cache_read_tokens + (d.terminal_cache_read_tokens ?? 0);
            by.set(key, e);
        }
        return [...by.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, e]) => ({ label: bucketLabel(k), ...e, agentic: Number(e.agentic.toFixed(4)), terminal: Number(e.terminal.toFixed(4)) }));
    }, [s, weekly]);

    const momData = useMemo(
        () =>
            (s?.monthly ?? []).map((m) => ({
                month: monthLabelOf(m.month),
                key: m.month,
                cost: Number(m.total_cost_usd.toFixed(4)),
                terminalCost: Number((m.terminal_total_cost_usd ?? 0).toFixed(4)),
                runs: m.run_count,
                terminalSessions: m.terminal_session_count ?? 0,
                input: m.input_tokens,
                output: m.output_tokens,
                cached: m.cache_read_tokens,
            })),
        [s?.monthly],
    );

    if (error) return <Alert severity="error">Could not load spend: {(error as Error).message}</Alert>;
    if (!s) return <TabSkeleton />;

    const terminal = s.terminalSummary ?? EMPTY_TERMINAL;
    const cur = totalSpend(s);
    const prev = (s.previous?.total_cost_usd ?? 0) + (s.previous?.terminal_total_cost_usd ?? 0);
    const shipped = s.shipped_tasks ?? 0;
    const unit = weekly ? 'week' : 'day';
    const windowName = WINDOW_LABEL[window].toLowerCase();
    const models = s.byModel ?? [];
    const totalAgentCost = s.byAgent.reduce((n, a) => n + a.total_cost_usd, 0);
    const unpriced = s.cache_savings_unpriced_tokens ?? 0;
    const fallback = <Skeleton variant="rounded" height={360} />;

    return (
        <Box sx={{ display: 'grid', gap: { xs: 2, md: 3 } }}>
            <TileGrid cols={4}>
                <StatTile
                    label="Spend"
                    value={formatCostUsd(cur)}
                    definition="Completed agent runs plus closed terminal sessions in this window."
                    caption={<><Delta cur={cur} prev={prev} goodWhen="down" /> {previousLabel(window)}</>}
                />
                <StatTile
                    label="Cost per shipped Task"
                    value={shipped > 0 ? formatCostUsd(cur / shipped) : '—'}
                    definition="All spend in the window ÷ Tasks whose first move into Done falls in the window. It includes work still in flight, so it is an all-in unit cost rather than one Task's bill."
                    caption={`${shipped} Task${shipped === 1 ? '' : 's'} shipped`}
                />
                <StatTile
                    label="Cache savings"
                    value={formatCostUsd(s.cache_savings_usd ?? 0)}
                    definition="Tokens read from cache × (the model's fresh-input price − its cache-read price), per model, agent runs and terminal sessions. Models with no known price are left out, not guessed."
                    caption={unpriced > 0 ? `${formatTokenCount(unpriced)} cached tokens unpriced` : `${formatTokenCount(s.summary.cache_read_tokens + terminal.cache_read_tokens)} cached tokens`}
                />
                <StatTile
                    label="Cache hit rate"
                    value={`${(s.cacheEfficiency * 100).toFixed(1)}%`}
                    definition="Agent runs' cached input ÷ (cached + fresh input) in this window."
                    caption="agent runs"
                />
            </TileGrid>

            <CardGrid>
                <Card>
                    <ChartTitle title="Agent runs vs terminal sessions" sub="Where the window's spend went: autonomous workflow and agent runs, or sessions you drove in Terminal." />
                    {cur === 0 ? (
                        <ChartEmpty label="No spend in this window" sub="Spend appears once an agent run completes or a terminal session closes." />
                    ) : (
                        <BarList
                            label="Spend by source"
                            rows={[
                                { key: 'agentic', label: 'Agent runs', value: s.summary.total_cost_usd, display: formatCostUsd(s.summary.total_cost_usd), note: `${s.summary.run_count} runs · ${Math.round((s.summary.total_cost_usd / cur) * 100)}%`, color: CHART_COLORS.cost },
                                { key: 'terminal', label: 'Terminal sessions', value: terminal.total_cost_usd, display: formatCostUsd(terminal.total_cost_usd), note: `${terminal.session_count} sessions · ${Math.round((terminal.total_cost_usd / cur) * 100)}%`, color: CHART_COLORS.terminal },
                            ]}
                        />
                    )}
                </Card>
                <Card>
                    <ChartTitle title="Cost by model" sub="Spend per model and CLI in this window, agent runs and terminal sessions listed separately." />
                    {models.length === 0 ? (
                        <ChartEmpty label="No spend in this window" sub="Each model's share appears once a run or session is priced." />
                    ) : (
                        <BarList
                            label="Cost by model"
                            rows={models.slice(0, 8).map((m) => ({
                                key: `${m.source}:${m.cli}:${m.model ?? ''}`,
                                label: m.model ?? 'Unknown model',
                                value: m.total_cost_usd,
                                display: formatCostUsd(m.total_cost_usd),
                                note: `${m.cli} · ${m.source === 'agentic' ? `${m.count} runs` : `${m.count} sessions`}`,
                                color: m.source === 'agentic' ? CHART_COLORS.cost : CHART_COLORS.terminal,
                            }))}
                        />
                    )}
                </Card>
            </CardGrid>

            <CardGrid>
                <Card>
                    <ChartTitle title={`Spend per ${unit}`} sub={`Agent-run cost stacked with terminal-session cost, per ${unit} in your time zone.`} />
                    {series.length === 0 ? (
                        <ChartEmpty label="No spend in this window" sub="Spend appears once an agent run completes or a terminal session closes." />
                    ) : (
                        <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={series} margin={{ top: 4, right: 16, left: -12, bottom: 0 }}>
                                <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_COLORS.rail }} tickLine={false} minTickGap={16} />
                                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={usdTick} />
                                <Tooltip {...TOOLTIP_STYLE} formatter={usdTooltip} />
                                <Legend {...LEGEND_PROPS} />
                                <Bar dataKey="agentic" name="Agent runs" stackId="s" fill={CHART_COLORS.cost} stroke={ATLAS_PALETTE.white} strokeWidth={1} maxBarSize={22} />
                                <Bar dataKey="terminal" name="Terminal sessions" stackId="s" fill={CHART_COLORS.terminal} stroke={ATLAS_PALETTE.white} strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={22} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </Card>
                <Card>
                    <ChartTitle title={`Tokens per ${unit}`} sub="Fresh input, output and cache reads, agent runs and terminal sessions together." />
                    {series.length === 0 ? (
                        <ChartEmpty label="No tokens in this window" sub="Token counts appear once an agent run completes or a terminal session closes." />
                    ) : (
                        <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={series} margin={{ top: 4, right: 16, left: -12, bottom: 0 }}>
                                <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_COLORS.rail }} tickLine={false} minTickGap={16} />
                                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} tickFormatter={tokenTick} />
                                <Tooltip {...TOOLTIP_STYLE} formatter={tokenTooltip} />
                                <Legend {...LEGEND_PROPS} />
                                <Bar dataKey="input" name="Input" stackId="t" fill={CHART_COLORS.input} stroke={ATLAS_PALETTE.white} strokeWidth={1} maxBarSize={22} />
                                <Bar dataKey="output" name="Output" stackId="t" fill={CHART_COLORS.output} stroke={ATLAS_PALETTE.white} strokeWidth={1} maxBarSize={22} />
                                <Bar dataKey="cached" name="Cache reads" stackId="t" fill={CHART_COLORS.cached} stroke={ATLAS_PALETTE.white} strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={22} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </Card>
            </CardGrid>

            <CardGrid>
                <Suspense fallback={fallback}>
                    <SpendByAgentCard byAgent={s.byAgent} totalAgentCost={totalAgentCost} />
                </Suspense>
                <Suspense fallback={fallback}>
                    <ProjectCostBars
                        byProject={s.byProject}
                        terminalByProject={s.terminalByProject ?? []}
                        topProjectMax={Math.max(0, ...s.byProject.map((p) => p.total_cost_usd))}
                    />
                </Suspense>
                <Suspense fallback={fallback}>
                    <TerminalSessionsCard
                        summary={terminal}
                        byCli={s.terminalByCli ?? []}
                        topSessions={s.topTerminalSessions ?? []}
                        monthLabel={window === 'month' ? 'this month' : `the last ${windowName}`}
                    />
                </Suspense>
                <Suspense fallback={fallback}>
                    <MonthlyLadder momData={momData} />
                </Suspense>
            </CardGrid>
            <Suspense fallback={fallback}>
                <TopRunsTable topRuns={s.topRuns} topRunsMaxCost={Math.max(0, ...s.topRuns.map((r) => r.total_cost_usd))} />
            </Suspense>
        </Box>
    );
}
