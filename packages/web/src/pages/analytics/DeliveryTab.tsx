import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { AnalyticsWindow, IAnalyticsDelivery, IssuePriority } from '@atlas/shared';
import { getStatusLabel } from '@atlas/shared';
import { useAnalyticsDelivery } from '../../hooks/useAnalytics.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { itemPath } from '../../utils/itemPath.js';
import { formatSpan } from '../../utils/time.js';
import {
    AXIS_TICK,
    BarList,
    bucketLabel,
    Card,
    CardGrid,
    CHART_COLORS,
    ChartEmpty,
    ChartTitle,
    FORMAT,
    formatRate,
    trendFor,
    StatTile,
    TableScroll,
    TabSkeleton,
    TileGrid,
    TOOLTIP_STYLE,
    LEGEND_PROPS,
    hourTick,
    hoursTooltip,
    stopRowClick,
} from './_chrome.js';

const PRIORITY_LABEL: Record<IssuePriority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };

const HEAD_SX = {
    fontSize: 11.5,
    fontWeight: 600,
    color: ATLAS_PALETTE.slate60,
    whiteSpace: 'nowrap' as const,
};
const NUM_SX = { fontFamily: TYPOGRAPHY.fontFamilyMono, fontSize: 12.5, whiteSpace: 'nowrap' as const };

function Tiles({ d, window }: { d: IAnalyticsDelivery; window: AnalyticsWindow }) {
    const u = d.period.bucket;
    const tr = (k: keyof IAnalyticsDelivery['trends'], good: 'up' | 'down', f: (v: number) => string, points = false) =>
        trendFor(d.trends[k], good, window, u, f, points);
    const or = d.flow.owner_response;
    return (
        <>
            <TileGrid cols={4}>
                <StatTile
                    label="Tasks shipped"
                    value={d.shipped.tasks.toLocaleString()}
                    definition="Tasks whose first move into Done falls in this window. Agent-test Tasks are left out."
                    caption={`+${d.shipped.sub_tasks.toLocaleString()} sub-tasks`}
                    trend={tr('tasks_shipped', 'up', FORMAT.count)}
                />
                <StatTile
                    label="Lead time, median"
                    value={formatSpan(d.lead_time.p50_s)}
                    definition="Lead time = a Task's creation → its first move into Done, over the Tasks shipped in this window. p90 is the time nine in ten of them beat."
                    caption={`p90 ${formatSpan(d.lead_time.p90_s)} · ${d.lead_time.count} Tasks`}
                    trend={tr('lead_p50_s', 'down', FORMAT.span)}
                />
                <StatTile
                    label="Cycle time, median"
                    value={formatSpan(d.cycle_time.p50_s)}
                    definition="Cycle time = a Task's first move into In progress → its first move into Done. Tasks that went to Done without entering In progress are left out."
                    caption={`p90 ${formatSpan(d.cycle_time.p90_s)}`}
                    trend={tr('cycle_p50_s', 'down', FORMAT.span)}
                />
                <StatTile
                    label="Work in progress"
                    value={d.wip.count.toLocaleString()}
                    definition={`Tasks in progress, waiting for info or in review right now, whatever the window. Aging = open more than ${formatSpan(d.wip.aging_after_s)} since its first In progress (since it last left Done, if reopened). The trend replays the status history: the count at the end of each ${u}, and at the end of the previous window.`}
                    caption={`${d.wip.aging} aging past ${formatSpan(d.wip.aging_after_s)}`}
                    trend={tr('wip', 'down', FORMAT.count)}
                />
                <StatTile
                    label="Waiting on you"
                    value={formatSpan(d.waiting.parks === 0 ? null : d.waiting.total_s)}
                    definition="Total time items sat in Waiting for info, over the moves into it that started in this window. A wait still open is counted up to now."
                    caption={`${d.waiting.parks} parks · median ${formatSpan(d.waiting.median_s)}${d.waiting.still_waiting ? ` · ${d.waiting.still_waiting} still waiting` : ''}`}
                    trend={tr('waiting_s', 'down', FORMAT.span)}
                />
                <StatTile
                    label="Reopen rate"
                    value={formatRate(d.reopens.rate)}
                    definition="Items moved out of Done ÷ items moved into Done in this window, Tasks and sub-tasks alike."
                    caption={`${d.reopens.reopened} reopened of ${d.reopens.done} done`}
                    trend={tr('reopen_rate', 'down', FORMAT.rate, true)}
                />
                <StatTile
                    label="PRs merged"
                    value={d.prs.merged.toLocaleString()}
                    definition="PRs opened by workflow runs that started in this window, merged as last checked on GitHub. Agent tests are left out."
                    caption={`of ${d.prs.opened} opened · ${formatRate(d.prs.merge_rate)} merge rate`}
                    trend={tr('prs_merged', 'up', FORMAT.count)}
                />
                <StatTile
                    label="Time to PR, median"
                    value={formatSpan(d.prs.median_s_to_pr)}
                    definition="From a workflow run's start to its PR opening, over runs that opened one."
                    caption="from run start"
                    trend={tr('time_to_pr_s', 'down', FORMAT.span)}
                />
            </TileGrid>

            <Box component="section" aria-labelledby="delivery-flow-quality" sx={{ display: 'grid', gap: { xs: 1.5, md: 2 } }}>
                <Typography id="delivery-flow-quality" component="h3" sx={{ fontSize: 14, fontWeight: 700, color: ATLAS_PALETTE.slate }}>
                    Flow and quality
                </Typography>
                <TileGrid cols={5}>
                    <StatTile
                        label="Flow efficiency"
                        value={formatRate(d.flow.efficiency)}
                        definition="Time the shipped Tasks spent In progress or In review (worked) ÷ all their time from creation to first Done. The rest is waiting: Draft, Ready and Waiting for info."
                        caption={d.flow.efficiency === null ? 'nothing shipped' : `${formatSpan(d.flow.active_s)} worked · ${formatSpan(d.flow.waiting_s)} waiting`}
                        trend={tr('flow_efficiency', 'up', FORMAT.rate, true)}
                    />
                    <StatTile
                        label="Your response to parks"
                        value={formatSpan(or.p50_s)}
                        definition="From a workflow run parking for you to that run resuming on your answer, over parks that started in this window. Median shown, p90 below. Unanswered parks are counted, not timed; a sub-task's park counts once."
                        caption={or.answered + or.unanswered === 0 ? 'no parks' : `p90 ${formatSpan(or.p90_s)} · ${or.answered} answered${or.unanswered ? ` · ${or.unanswered} open` : ''}`}
                        trend={tr('owner_response_p50_s', 'down', FORMAT.span)}
                    />
                    <StatTile
                        label="Weekly throughput"
                        value={d.flow.weekly_throughput === null ? '—' : d.flow.weekly_throughput.toFixed(1)}
                        definition="Tasks shipped in this window ÷ the window's length in weeks. The sparkline is Tasks shipped in each Monday week."
                        caption="Tasks a week"
                        trend={tr('weekly_throughput', 'up', FORMAT.decimal)}
                    />
                    <StatTile
                        label="Rework after Done"
                        value={formatRate(d.rework.rate)}
                        definition="Tasks shipped in this window that were moved out of Done again before the window ended ÷ Tasks shipped."
                        caption={`${d.rework.reopened} of ${d.rework.shipped} shipped`}
                        trend={tr('rework_rate', 'down', FORMAT.rate, true)}
                    />
                    <StatTile
                        label="First-attempt merges"
                        value={formatRate(d.first_attempt.rate)}
                        definition="Workflow runs started in this window whose every PR merged, and how many got there with no retried agent step and no park in the run (its sub-task runs included). Agent tests are left out."
                        caption={d.first_attempt.merged_runs === 0 ? 'no merged runs' : `${d.first_attempt.clean} of ${d.first_attempt.merged_runs} merged runs`}
                        trend={tr('first_attempt_merge_rate', 'up', FORMAT.rate, true)}
                    />
                </TileGrid>
            </Box>
        </>
    );
}

export function DeliveryTab({ window }: { window: AnalyticsWindow }) {
    const { data: d, error } = useAnalyticsDelivery(window);
    const navigate = useNavigate();
    if (error) return <Alert severity="error">Could not load delivery analytics: {(error as Error).message}</Alert>;
    if (!d) return <TabSkeleton />;

    const unit = d.period.bucket;
    const tp = d.throughput.map((b) => ({
        label: bucketLabel(b.bucket),
        tasks: b.tasks,
        sub_tasks: b.sub_tasks,
        cycle_h: b.cycle_p50_s === null ? null : Number((b.cycle_p50_s / 3600).toFixed(2)),
    }));
    const anyShipped = d.shipped.tasks + d.shipped.sub_tasks > 0;
    const statusTotal = d.time_in_status.reduce((n, s) => n + s.avg_s, 0);
    const sourceTotal = d.source_mix.jira + d.source_mix.native;

    return (
        <Box sx={{ display: 'grid', gap: { xs: 2, md: 3 } }}>
            <Tiles d={d} window={window} />

            <CardGrid>
                <Card>
                    <ChartTitle
                        title={`Throughput per ${unit}`}
                        sub="Items whose first move into Done falls in each bucket, stacked by kind."
                    />
                    {anyShipped ? (
                        <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={tp} margin={{ top: 4, right: 16, left: -18, bottom: 0 }}>
                                <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_COLORS.rail }} tickLine={false} minTickGap={16} />
                                <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
                                <Tooltip {...TOOLTIP_STYLE} />
                                <Legend {...LEGEND_PROPS} />
                                <Bar dataKey="tasks" name="Tasks" stackId="k" fill={CHART_COLORS.task} stroke={ATLAS_PALETTE.white} strokeWidth={1} maxBarSize={22} />
                                <Bar dataKey="sub_tasks" name="Sub-tasks" stackId="k" fill={CHART_COLORS.subTask} stroke={ATLAS_PALETTE.white} strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={22} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <ChartEmpty label="Nothing shipped in this window" sub="A Task counts here the first time it moves into Done." />
                    )}
                </Card>

                <Card>
                    <ChartTitle
                        title="Cycle time trend"
                        sub={`Median hours from first In progress to Done for the Tasks shipped in each ${unit}. Gaps are ${unit}s with nothing shipped.`}
                    />
                    {d.cycle_time.count > 0 ? (
                        <ResponsiveContainer width="100%" height={240}>
                            <LineChart data={tp} margin={{ top: 8, right: 20, left: -10, bottom: 0 }}>
                                <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_COLORS.rail }} tickLine={false} minTickGap={16} />
                                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={hourTick} />
                                <Tooltip {...TOOLTIP_STYLE} cursor={{ stroke: CHART_COLORS.rail }} formatter={hoursTooltip} />
                                <Line type="linear" dataKey="cycle_h" name="Median cycle time" stroke={CHART_COLORS.task} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: ATLAS_PALETTE.white, fill: CHART_COLORS.task }} activeDot={{ r: 6, strokeWidth: 2, stroke: ATLAS_PALETTE.white, fill: CHART_COLORS.task }} connectNulls={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <ChartEmpty label="No cycle times yet" sub="A cycle time needs a Task that moved into In progress and then into Done in this window." />
                    )}
                </Card>

                <Card>
                    <ChartTitle
                        title="Cycle time distribution"
                        sub="How many shipped Tasks took each span from first In progress to Done. A long right tail is where the slow work hides."
                    />
                    {d.cycle_time.count > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={d.cycle_histogram} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                                <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_COLORS.rail }} tickLine={false} interval={0} />
                                <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
                                <Tooltip {...TOOLTIP_STYLE} />
                                <Bar dataKey="count" name="Tasks" fill={CHART_COLORS.task} radius={[4, 4, 0, 0]} maxBarSize={36} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <ChartEmpty label="No cycle times yet" sub="Ship a Task through In progress and its cycle time lands here." />
                    )}
                </Card>

                <Card>
                    <ChartTitle
                        title="Where shipped work waited"
                        sub="Average time a shipped Task spent in each status before Done, averaged over every shipped Task, so the rows add up to the mean lead time."
                    />
                    {statusTotal > 0 ? (
                        <BarList
                            label="Average time in each status"
                            rows={d.time_in_status.map((s) => ({
                                key: s.status,
                                label: getStatusLabel(s.status),
                                value: s.avg_s,
                                display: formatSpan(s.avg_s),
                                note: `${Math.round((s.avg_s / statusTotal) * 100)}%`,
                                // The one status that is the Owner's queue gets the emphasis colour.
                                ...(s.status === 'waiting_for_info' ? { color: CHART_COLORS.terminal } : {}),
                            }))}
                            color={CHART_COLORS.task}
                        />
                    ) : (
                        <ChartEmpty label="Nothing shipped in this window" sub="Time in status is measured over the Tasks shipped in the window." />
                    )}
                </Card>

                <Card>
                    <ChartTitle
                        title="Cycle time by priority"
                        sub="Median cycle time of the Tasks shipped at each priority. If urgent work is not faster, priority is not steering the queue."
                    />
                    {d.cycle_time.count > 0 ? (
                        <BarList
                            label="Median cycle time by priority"
                            rows={d.by_priority.map((p) => ({
                                key: p.priority,
                                label: PRIORITY_LABEL[p.priority],
                                value: p.cycle_p50_s ?? 0,
                                display: formatSpan(p.cycle_p50_s),
                                note: `${p.shipped} shipped`,
                            }))}
                            color={CHART_COLORS.task}
                        />
                    ) : (
                        <ChartEmpty label="No cycle times yet" sub="Cycle time by priority appears once Tasks ship through In progress." />
                    )}
                </Card>

                <Card>
                    <ChartTitle title="Where shipped Tasks came from" sub="Shipped Tasks with a linked Jira issue vs Tasks created in Atlas." />
                    {sourceTotal > 0 ? (
                        <BarList
                            label="Shipped Tasks by source"
                            rows={[
                                { key: 'native', label: 'Created in Atlas', value: d.source_mix.native, display: String(d.source_mix.native), note: `${Math.round((d.source_mix.native / sourceTotal) * 100)}%` },
                                { key: 'jira', label: 'From Jira', value: d.source_mix.jira, display: String(d.source_mix.jira), note: `${Math.round((d.source_mix.jira / sourceTotal) * 100)}%`, color: CHART_COLORS.jira },
                            ]}
                            color={CHART_COLORS.task}
                        />
                    ) : (
                        <ChartEmpty label="Nothing shipped in this window" sub="The source split counts shipped Tasks." />
                    )}
                </Card>
            </CardGrid>

            <Card>
                <ChartTitle
                    title="Oldest work in progress"
                    sub={`Tasks open now, oldest first, aged from their first In progress. Past ${formatSpan(d.wip.aging_after_s)} counts as aging.`}
                />
                {d.wip.oldest.length === 0 ? (
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>No Tasks are in progress, waiting or in review right now.</Typography>
                ) : (
                    <Box component="ul" aria-label="Oldest work in progress" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                        {d.wip.oldest.map((w) => {
                            const aging = w.age_s > d.wip.aging_after_s;
                            return (
                                <Box
                                    component="li"
                                    key={w.id}
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: { xs: '1fr auto', sm: '88px 1fr auto auto' },
                                        gap: { xs: 0.5, sm: 2 },
                                        alignItems: 'baseline',
                                        py: 1.25,
                                        borderTop: `1px solid ${ATLAS_PALETTE.slate08}`,
                                        '&:first-of-type': { borderTop: 'none' },
                                    }}
                                >
                                    <Box component={RouterLink} to={itemPath('task', w.id)} sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono, fontSize: 12.5, color: ATLAS_PALETTE.brandBlue, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                                        {w.id}
                                    </Box>
                                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate, gridColumn: { xs: '1 / -1', sm: 'auto' }, gridRow: { xs: 2, sm: 'auto' }, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {w.title}
                                    </Typography>
                                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, display: { xs: 'none', sm: 'block' } }}>
                                        {getStatusLabel(w.status)}
                                    </Typography>
                                    <Typography sx={{ ...NUM_SX, color: aging ? ATLAS_PALETTE.warnFg : ATLAS_PALETTE.slate80, fontWeight: aging ? 600 : 400 }}>
                                        {formatSpan(w.age_s)}
                                        {aging ? ' · aging' : ''}
                                    </Typography>
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </Card>

            <Card>
                <ChartTitle title="By project" sub="Tasks shipped in this window per project, with their median cycle and lead time. Open a project for its cost breakdown." />
                {d.by_project.length === 0 ? (
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>No project shipped a Task in this window.</Typography>
                ) : (
                    <TableScroll label="Delivery by project">
                        <Table size="small" aria-label="Delivery by project" sx={{ minWidth: 420 }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={HEAD_SX}>Project</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Shipped</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Cycle p50</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Lead p50</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {d.by_project.map((p) => (
                                    <TableRow key={p.project_id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/analytics/project/${p.project_id}`)}>
                                        <TableCell>
                                            <Box component={RouterLink} to={`/analytics/project/${p.project_id}`} onClick={stopRowClick} sx={{ color: ATLAS_PALETTE.slate, fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                                                {p.project_name}
                                            </Box>
                                        </TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{p.shipped}</TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{formatSpan(p.cycle_p50_s)}</TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{formatSpan(p.lead_p50_s)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableScroll>
                )}
            </Card>
        </Box>
    );
}
