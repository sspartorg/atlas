import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import type { AnalyticsWindow, IAnalyticsWorkflows } from '@atlas/shared';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { useAnalyticsWorkflows } from '../../hooks/useAnalytics.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { formatCostUsd } from '../../utils/formatCost.js';
import { formatSpan } from '../../utils/time.js';
import { OUTCOMES, OutcomeBar } from '../agents/PerformanceTabContent.js';
import {
    AXIS_TICK,
    BarList,
    bucketLabel,
    Card,
    CHART_COLORS,
    FORMAT,
    TOOLTIP_STYLE,
    trendFor,
    usdTick,
    CardGrid,
    ChartEmpty,
    ChartTitle,
    formatRate,
    StatTile,
    TableScroll,
    TabSkeleton,
    TileGrid,
    stopRowClick,
} from './_chrome.js';

const pctTick = (v: number) => `${v}%`;

/** The hovered agent: its name and both coordinates, in words. */
function AgentDotTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; cost: number; applied: number; steps: number } }> }) {
    const p = active ? payload?.[0]?.payload : undefined;
    if (!p) return null;
    return (
        <Box sx={{ ...TOOLTIP_STYLE.contentStyle, px: 1.5, py: 1 }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: ATLAS_PALETTE.slate }}>{p.name}</Typography>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate80 }}>
                {formatCostUsd(p.cost)} a step · {p.applied}% applied first time · {p.steps} steps
            </Typography>
        </Box>
    );
}

const HEAD_SX = { fontSize: 11.5, fontWeight: 600, color: ATLAS_PALETTE.slate60, whiteSpace: 'nowrap' as const };
const NUM_SX = { fontFamily: TYPOGRAPHY.fontFamilyMono, fontSize: 12.5, whiteSpace: 'nowrap' as const };

export function WorkflowsTab({ window }: { window: AnalyticsWindow }) {
    const { data: w, error } = useAnalyticsWorkflows(window);
    const navigate = useNavigate();
    if (error) return <Alert severity="error">Could not load workflow analytics: {(error as Error).message}</Alert>;
    if (!w) return <TabSkeleton />;

    const finished = w.runs.completed + w.runs.cancelled + w.runs.error;
    const tr = (k: keyof IAnalyticsWorkflows['trends'], good: 'up' | 'down', f: (v: number) => string, points = false) =>
        trendFor(w.trends[k], good, window, w.period.bucket, f, points);
    const scatter = w.agents
        .filter((a) => a.steps > 0 && a.per_step_usd !== null)
        .map((a) => ({ name: a.name, cost: a.per_step_usd ?? 0, applied: Math.round((a.first_pass.applied / a.steps) * 100), steps: a.steps }));
    const gateTotal = w.gates.pass + w.gates.fail + w.gates.unavailable + w.gates.needs_review;

    return (
        <Box sx={{ display: 'grid', gap: { xs: 2, md: 3 } }}>
            <TileGrid cols={5}>
                <StatTile
                    label="Success rate"
                    value={formatRate(w.runs.success_rate)}
                    definition="Completed ÷ finished workflow runs (completed, cancelled or error) started in this window. Runs still going or waiting for you are left out; agent tests are left out."
                    caption={`${w.runs.completed} of ${finished} finished`}
                    trend={tr('success_rate', 'up', FORMAT.rate, true)}
                />
                <StatTile
                    label="Workflow runs"
                    value={w.runs.total.toLocaleString()}
                    definition="Top-level workflow runs started in this window. A sub-task's run is part of its Task's run and is not counted on its own."
                    trend={tr('runs', 'up', FORMAT.count)}
                />
                <StatTile
                    label="Gate pass rate"
                    value={formatRate(w.gates.pass_rate)}
                    definition="Script-step checks that passed ÷ those that passed or failed in this window. A check that could not run is absence of evidence, not a failure, so it is left out."
                    caption={`${w.gates.pass} passed · ${w.gates.fail} failed`}
                    trend={tr('gate_pass_rate', 'up', FORMAT.rate, true)}
                />
                <StatTile
                    label="Retries"
                    value={w.retries.retries.toLocaleString()}
                    definition="Agent runs started as a retry of an earlier run, out of every agent run created in this window."
                    caption={`${formatRate(w.retries.rate)} of ${w.retries.dispatches} agent runs`}
                    trend={tr('retries', 'down', FORMAT.count)}
                />
                <StatTile
                    label="Retries per Task"
                    value={w.retries_per_task.rate === null ? '—' : w.retries_per_task.rate.toFixed(2)}
                    definition="Agent-run retries in this window ÷ the Tasks those agent runs worked for (a sub-task's run counts for its Task). Agent runs with no Task and agent tests are left out of the Tasks."
                    caption={w.retries_per_task.tasks === 0 ? 'no Tasks worked' : `${w.retries_per_task.retries} retries over ${w.retries_per_task.tasks} Tasks`}
                    trend={tr('retries_per_task', 'down', FORMAT.decimal)}
                />
            </TileGrid>

            {/* The park list grows with every kind; the two short cards stack beside it
                rather than one of them stretching to its height. */}
            <CardGrid>
                <Box sx={{ display: 'grid', gap: { xs: 2, md: 3 }, alignContent: 'start' }}>
                    <Card>
                        <ChartTitle title="How runs ended" sub="Top-level runs started in this window, by where they are now." />
                        {w.runs.total === 0 ? (
                            <ChartEmpty label="No workflow runs in this window" sub="Runs appear here once a workflow starts on a Task." />
                        ) : (
                            <BarList
                                label="Runs by outcome"
                                rows={[
                                    { key: 'completed', label: 'Completed', value: w.runs.completed, display: String(w.runs.completed), color: ATLAS_PALETTE.success },
                                    { key: 'waiting', label: 'Waiting for you', value: w.runs.waiting_for_owner, display: String(w.runs.waiting_for_owner), color: ATLAS_PALETTE.warning },
                                    { key: 'running', label: 'Running', value: w.runs.running, display: String(w.runs.running), color: ATLAS_PALETTE.brandBlue },
                                    { key: 'cancelled', label: 'Cancelled', value: w.runs.cancelled, display: String(w.runs.cancelled), color: ATLAS_PALETTE.slate40 },
                                    { key: 'error', label: 'Error', value: w.runs.error, display: String(w.runs.error), color: ATLAS_PALETTE.error },
                                ]}
                            />
                        )}
                    </Card>

                    <Card>
                        <ChartTitle title="Gate verdicts" sub="Every Script-step check Atlas ran in this window." />
                        {gateTotal === 0 ? (
                            <ChartEmpty label="No checks ran in this window" sub="A workflow's Script steps record a verdict each time they run." />
                        ) : (
                            <BarList
                                label="Gate verdicts"
                                rows={[
                                    { key: 'pass', label: 'Passed', value: w.gates.pass, display: String(w.gates.pass), color: ATLAS_PALETTE.success },
                                    { key: 'fail', label: 'Failed', value: w.gates.fail, display: String(w.gates.fail), color: ATLAS_PALETTE.error },
                                    { key: 'needs_review', label: 'Needs review', value: w.gates.needs_review, display: String(w.gates.needs_review), color: ATLAS_PALETTE.warning },
                                    { key: 'unavailable', label: 'Could not run', value: w.gates.unavailable, display: String(w.gates.unavailable), color: ATLAS_PALETTE.slate40 },
                                ]}
                            />
                        )}
                    </Card>

                </Box>
                <Card>
                    <ChartTitle title="Why runs stopped for you" sub="Times a run parked and waited for you in this window, by why it stopped. A sub-task that waits holds its Task too; that counts once." />
                    {w.park_reasons.length === 0 ? (
                        <ChartEmpty label="No parks in this window" sub="When a run stops to ask you something, the reason is counted here." />
                    ) : (
                        <BarList
                            label="Park reasons"
                            color={ATLAS_PALETTE.warning}
                            rows={w.park_reasons.map((p) => ({ key: p.kind, label: p.reason, value: p.count, display: String(p.count) }))}
                        />
                    )}
                </Card>

            </CardGrid>

            <CardGrid>
                <Card>
                    <ChartTitle title="Red checks by script" sub="Script-step checks that failed in this window, most failures first. Runs counts the workflow runs (a Task's run with its sub-task runs) that hit the failure." />
                    {w.gate_failures.length === 0 ? (
                        <ChartEmpty label="No failed checks in this window" sub="A Script step that goes red is counted here under its check." />
                    ) : (
                        <TableScroll label="Red checks by script">
                            <Table size="small" aria-label="Red checks by script" sx={{ minWidth: 360 }}>
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={HEAD_SX}>Check</TableCell>
                                        <TableCell sx={HEAD_SX} align="right">Failures</TableCell>
                                        <TableCell sx={HEAD_SX} align="right">Runs</TableCell>
                                        <TableCell sx={HEAD_SX} align="right">Last failed</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {w.gate_failures.map((g) => (
                                        <TableRow key={g.script_id}>
                                            <TableCell sx={{ fontSize: 13, color: ATLAS_PALETTE.slate, fontWeight: 600 }}>{g.name}</TableCell>
                                            <TableCell align="right" sx={NUM_SX}>{g.failures}</TableCell>
                                            <TableCell align="right" sx={NUM_SX}>{g.runs}</TableCell>
                                            <TableCell align="right" sx={NUM_SX}>{bucketLabel(g.last_at)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableScroll>
                    )}
                </Card>

                <Card>
                    <ChartTitle
                        title="Agents: cost vs first-attempt success"
                        sub="Each dot is an agent: cost per step across, share of its steps applied on the first attempt up. A comparison, not a ranking: a reviewer that sends work back is doing its job, so a low dot is not a failing agent. The Agents table below has every number."
                    />
                    {scatter.length === 0 ? (
                        <ChartEmpty label="No agent steps in this window" sub="Each agent that takes a workflow step appears here." />
                    ) : (
                        <ResponsiveContainer width="100%" height={240}>
                            <ScatterChart margin={{ top: 8, right: 16, left: -8, bottom: 8 }}>
                                <CartesianGrid stroke={CHART_COLORS.grid} />
                                <XAxis type="number" dataKey="cost" name="Cost per step" tick={AXIS_TICK} axisLine={{ stroke: CHART_COLORS.rail }} tickLine={false} tickFormatter={usdTick} />
                                <YAxis type="number" dataKey="applied" name="Applied first time" domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={pctTick} />
                                <ChartTooltip {...TOOLTIP_STYLE} cursor={{ stroke: CHART_COLORS.rail }} content={<AgentDotTooltip />} />
                                <Scatter data={scatter} name="Agents" fill={CHART_COLORS.cost} stroke={ATLAS_PALETTE.white} strokeWidth={2} />
                            </ScatterChart>
                        </ResponsiveContainer>
                    )}
                </Card>
            </CardGrid>

            <Card>
                <ChartTitle title="Cost per run" sub="What each workflow's runs cost on average, every step of the run and its sub-task runs included." />
                {w.by_workflow.every((r) => r.cost_per_run_usd === null) ? (
                    <ChartEmpty label="No run cost in this window" sub="Cost appears once a run's agent steps complete." />
                ) : (
                    <BarList
                        label="Cost per run by workflow"
                        rows={w.by_workflow.map((r) => ({
                            key: r.workflow_id,
                            label: r.name,
                            value: r.cost_per_run_usd ?? 0,
                            display: r.cost_per_run_usd === null ? '—' : formatCostUsd(r.cost_per_run_usd),
                            note: `${r.runs} run${r.runs === 1 ? '' : 's'}`,
                        }))}
                    />
                )}
            </Card>

            <Card>
                <ChartTitle title="Workflows" sub="Each workflow's runs started in this window. Duration is the median of completed runs; loops and gate rounds are averages per run." />
                {w.by_workflow.length === 0 ? (
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>No workflow ran in this window.</Typography>
                ) : (
                    <TableScroll label="Workflows compared">
                        <Table size="small" aria-label="Workflows compared" sx={{ minWidth: 640 }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={HEAD_SX}>Workflow</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Runs</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Success</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Median duration</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Loops / run</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Gate rounds / run</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Cost / run</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {w.by_workflow.map((r) => (
                                    <TableRow key={r.workflow_id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/workflows/${r.workflow_id}`)}>
                                        <TableCell>
                                            <Box component={RouterLink} to={`/workflows/${r.workflow_id}`} onClick={stopRowClick} sx={{ color: ATLAS_PALETTE.slate, fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                                                {r.name}
                                            </Box>
                                        </TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{r.runs}</TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{formatRate(r.success_rate)}</TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{formatSpan(r.median_duration_s)}</TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{r.avg_loops.toFixed(1)}</TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{r.avg_gate_rounds.toFixed(1)}</TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{r.cost_per_run_usd === null ? '—' : formatCostUsd(r.cost_per_run_usd)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableScroll>
                )}
            </Card>

            <Card>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
                    <ChartTitle
                        title="Agents"
                        sub="Every agent that took a workflow step in this window, in name order. This is a comparison, not a ranking: a reviewer that sends work back is doing its job, so “Sent back” is never shown as failure."
                    />
                    <Button component={RouterLink} to="/agents/performance" variant="outlined" size="small" sx={{ textTransform: 'none', flexShrink: 0 }}>
                        Fleet performance
                    </Button>
                </Box>
                <Box component="ul" aria-label="First attempt legend" sx={{ listStyle: 'none', m: 0, mb: 1, p: 0, display: 'flex', gap: 1.5, flexWrap: 'wrap', fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                    <Box component="li" sx={{ fontWeight: 600 }}>First attempt:</Box>
                    {OUTCOMES.map((o) => (
                        <Box component="li" key={o.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '2px', background: o.color }} />
                            {o.label}
                        </Box>
                    ))}
                </Box>
                {w.agents.length === 0 ? (
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>No agent took a workflow step in this window.</Typography>
                ) : (
                    <TableScroll label="Agents compared">
                        <Table size="small" aria-label="Agents compared" sx={{ minWidth: 640 }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={HEAD_SX}>Agent</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Steps</TableCell>
                                    <TableCell sx={HEAD_SX}>First attempt</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Loops</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Gate catches</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">Cost / step</TableCell>
                                    <TableCell sx={HEAD_SX} align="right">p95</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {w.agents.map((a) => (
                                    <TableRow key={a.agent_id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/agents/${a.agent_id}?tab=performance`)}>
                                        <TableCell>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: a.accent_color ?? ATLAS_PALETTE.slate40 }} />
                                                <Box component={RouterLink} to={`/agents/${a.agent_id}?tab=performance`} onClick={stopRowClick} sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate, whiteSpace: 'nowrap', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                                                    {a.name}
                                                </Box>
                                            </Box>
                                        </TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{a.steps}</TableCell>
                                        <TableCell sx={{ minWidth: 160 }}>
                                            <Tooltip title={OUTCOMES.map((o) => `${o.label}: ${a.first_pass[o.key]}`).join(' · ')}>
                                                <Box>
                                                    <OutcomeBar fp={a.first_pass} />
                                                    <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mt: 0.5, fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                                                        {a.first_pass.applied} · {a.first_pass.rejected} · {a.first_pass.parked}
                                                    </Typography>
                                                </Box>
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{a.loops}</TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{a.gate_catch}</TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{a.per_step_usd === null ? '—' : formatCostUsd(a.per_step_usd)}</TableCell>
                                        <TableCell align="right" sx={NUM_SX}>{formatSpan(a.p95_s)}</TableCell>
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
