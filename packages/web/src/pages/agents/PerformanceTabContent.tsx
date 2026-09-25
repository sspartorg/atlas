import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { IAgent } from '@atlas/shared';

import { useAgentPerformance } from '../../hooks/useAgentTests.js';
import type { AgentPerformance, FirstPass } from '../../api/types.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { formatCostUsd } from '../../utils/formatCost.js';

// Agent performance (ADR 0023 phase 2, ATL-140).
//
// 515 `agent_runs` rows have carried cli, model, effort, token counts, cost and
// outcome since ADR 0014 — snapshotted explicitly so agent configurations could
// be compared — and the only thing that ever read them was a CLI script writing
// markdown into a gitignored directory.
//
// **The page shows no pass rate.** ADR 0023 is explicit: on the v4 golden set
// `agent-release-reviewer` scored 64% *because it rejected four times*, and
// those rejections were the most valuable thing in the run, including an
// unescaped value reaching rendered HTML that the Architect's spec had ruled
// out of scope. A page that ranked agents on that number would recommend
// culling the best reviewer in the fleet.
//
// The plan for this page said to label rejections from `agents.role_id` —
// "Caught" for a reviewer, "Rejected" for a performer. The data says that does
// not work: `agent-coder` and `agent-release-reviewer` are BOTH `engineer`, and
// every reviewer shares a role with the writer it reviews. So nothing is
// classified. The three outcomes are shown side by side, named for what they
// are, and **a rejection is never drawn in the failure colour** — which is the
// substance of the warning rather than its wording.

const OUTCOMES = [
    {
        key: 'applied' as const,
        label: 'Applied',
        color: ATLAS_PALETTE.success,
        hint: 'Routed onward first time.',
    },
    {
        key: 'rejected' as const,
        label: 'Sent back',
        // Deliberately not the error colour. A reviewer's rejections are its
        // product; on a delivery they are the defect it stopped.
        color: ATLAS_PALETTE.brandBlue,
        hint: 'Sent the work back first time. For a reviewer this is the job, not a failure.',
    },
    {
        key: 'parked' as const,
        label: 'Asked you',
        color: ATLAS_PALETTE.warning,
        hint: 'Stopped and asked, or produced no readable outcome.',
    },
];

function total(fp: FirstPass): number {
    return fp.applied + fp.rejected + fp.parked;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    const body = (
        <Box>
            <Typography sx={{ fontSize: 20, fontWeight: 600, color: ATLAS_PALETTE.slate, lineHeight: 1.2 }}>
                {value}
            </Typography>
            <Typography
                sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, textTransform: 'uppercase', letterSpacing: '.04em' }}
            >
                {label}
            </Typography>
        </Box>
    );
    return hint ? (
        <Tooltip title={hint}>
            <Box>{body}</Box>
        </Tooltip>
    ) : (
        body
    );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <Box sx={{ p: 2.5, borderRadius: '8px', border: `1px solid ${ATLAS_PALETTE.slate10}`, background: ATLAS_PALETTE.white }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate, mb: 2 }}>{title}</Typography>
            {children}
        </Box>
    );
}

/** The three outcomes as one bar, with counts. No percentage anywhere. */
function FirstPassBar({ fp }: { fp: FirstPass }) {
    const n = total(fp);
    if (n === 0) {
        return <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>No steps in this window.</Typography>;
    }
    return (
        <Box>
            <Box sx={{ display: 'flex', height: 10, borderRadius: '5px', overflow: 'hidden', mb: 1.5 }}>
                {OUTCOMES.map((o) =>
                    fp[o.key] === 0 ? null : (
                        <Tooltip key={o.key} title={`${o.label}: ${fp[o.key]} of ${n}`}>
                            <Box sx={{ width: `${(fp[o.key] / n) * 100}%`, background: o.color }} />
                        </Tooltip>
                    ),
                )}
            </Box>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {OUTCOMES.map((o) => (
                    <Tooltip key={o.key} title={o.hint}>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '2px', background: o.color }} />
                            <Typography sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                                {fp[o.key]}
                            </Typography>
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{o.label}</Typography>
                        </Box>
                    </Tooltip>
                ))}
            </Box>
        </Box>
    );
}

function secs(v: number | null): string {
    return v === null ? '—' : v < 60 ? `${Math.round(v)}s` : `${Math.round(v / 60)}m`;
}

export function PerformanceTabContent({ agent }: { agent: IAgent }) {
    const { data, isLoading, error } = useAgentPerformance(agent.id);

    if (isLoading) return <CircularProgress size={20} />;
    if (error) {
        return (
            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.error }}>
                {(error as Error).message}
            </Typography>
        );
    }
    if (!data) return null;
    const perf: AgentPerformance = data;

    if (perf.quality.dispatches === 0) {
        return (
            <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>Nothing to measure yet</Typography>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    This agent has taken no workflow steps in the last 90 days. Ad-hoc runs and test runs are not
                    counted here — a step is a position in a graph, and neither has one.
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'grid', gap: 2.5 }}>
            <Card title="How its first attempts went">
                <FirstPassBar fp={perf.quality.first_pass} />
                <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', mt: 2.5 }}>
                    <Stat label="steps" value={String(perf.quality.steps)} hint="Distinct positions it occupied in a workflow graph." />
                    <Stat
                        label="loops"
                        value={String(perf.quality.loops)}
                        hint="Dispatches beyond the first on the same step — the price of getting it wrong."
                    />
                    <Stat
                        label="gate catches"
                        value={String(perf.quality.gate_catch)}
                        hint="Times a deterministic gate went red after this agent last said the work was done. The one quality signal an agent cannot author about itself."
                    />
                </Box>
            </Card>

            <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
                <Card title="Cost">
                    <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Stat label="total" value={formatCostUsd(perf.cost.total_usd)} />
                        <Stat
                            label="per step"
                            value={perf.cost.per_step_usd === null ? '—' : formatCostUsd(perf.cost.per_step_usd)}
                        />
                        <Stat
                            label="cache hit"
                            value={perf.cost.cache_hit_pct === null ? '—' : `${Math.round(perf.cost.cache_hit_pct * 100)}%`}
                            hint="Share of input served from cache."
                        />
                    </Box>
                </Card>
                <Card title="Latency">
                    <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Stat label="median" value={secs(perf.latency.p50_s)} />
                        <Stat label="p95" value={secs(perf.latency.p95_s)} />
                        <Stat
                            label="first token"
                            value={perf.latency.ttft_p50_ms === null ? '—' : `${(perf.latency.ttft_p50_ms / 1000).toFixed(1)}s`}
                            hint="Median time from a run starting to the agent's first word. Only from runs with a trace."
                        />
                    </Box>
                </Card>
            </Box>

            <Card title="What it reaches for">
                {perf.tools.runs_with_trace === 0 ? (
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                        None of these {perf.tools.runs_total} runs has a trace — every one of them finished before
                        Atlas started reading transcripts.
                    </Typography>
                ) : (
                    <>
                        <Box sx={{ display: 'grid', gap: 0.75, mb: 1.5 }}>
                            {perf.tools.top.map((t) => {
                                const busiest = perf.tools.top[0]?.calls ?? 1;
                                return (
                                    <Box key={t.name} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                        <Typography
                                            sx={{
                                                fontSize: 12,
                                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                                color: ATLAS_PALETTE.slate,
                                                minWidth: 180,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {t.name}
                                        </Typography>
                                        <Box
                                            aria-hidden="true"
                                            sx={{
                                                height: 6,
                                                borderRadius: '3px',
                                                background: ATLAS_PALETTE.brandBlue,
                                                width: `${Math.max(4, (t.calls / busiest) * 100)}%`,
                                                maxWidth: 320,
                                            }}
                                        />
                                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{t.calls}</Typography>
                                    </Box>
                                );
                            })}
                        </Box>
                        {/* The denominator, stated. A percentage over an unstated
                            one is the dishonest kind of number. */}
                        <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                            From {perf.tools.runs_with_trace} of {perf.tools.runs_total} runs · {perf.tools.avg_turns}{' '}
                            turns and {perf.tools.avg_tool_calls} tool calls on average
                        </Typography>
                    </>
                )}
            </Card>

            {/* ATL-140: the numbers must be attributable to the configuration
                that produced them, so a model or prompt change reads as a break
                in the series rather than a smear across it. */}
            <Card title="Measured at">
                <Box sx={{ display: 'grid', gap: 1 }}>
                    {perf.by_config.map((c) => (
                        <Box
                            key={`${c.model}-${c.effort}`}
                            sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}
                        >
                            <Typography
                                sx={{ fontSize: 12, fontFamily: TYPOGRAPHY.fontFamilyMono, color: ATLAS_PALETTE.slate, minWidth: 220 }}
                            >
                                {c.model ?? 'unrecorded'} · {c.effort ?? 'unrecorded'}
                            </Typography>
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                                {c.steps} steps · {formatCostUsd(c.cost_usd)}
                            </Typography>
                            <Box sx={{ flex: 1, minWidth: 160, maxWidth: 260 }}>
                                <Box sx={{ display: 'flex', height: 6, borderRadius: '3px', overflow: 'hidden' }}>
                                    {OUTCOMES.map((o) =>
                                        c.first_pass[o.key] === 0 ? null : (
                                            <Box
                                                key={o.key}
                                                sx={{
                                                    width: `${(c.first_pass[o.key] / total(c.first_pass)) * 100}%`,
                                                    background: o.color,
                                                }}
                                            />
                                        ),
                                    )}
                                </Box>
                            </Box>
                        </Box>
                    ))}
                </Box>
            </Card>
        </Box>
    );
}
