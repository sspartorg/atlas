import { Suspense, lazy, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { api } from '../api/api.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../theme/tokens.js';
import { formatCostUsd, formatTokenCount } from '../utils/formatCost.js';

// Below-the-fold cards code-split into their own chunks so the hero
// paints immediately on first navigation. All 7 cards below the hero
// share the same uniform 2-col grid (12/12 mobile, 6/12 web) and each
// renders its own empty state when its dataset is empty.
const AgenticDailyCard = lazy(() => import('./analytics/_AgenticDailyCard.js'));
const TerminalDailyCard = lazy(() => import('./analytics/_TerminalDailyCard.js'));
const MonthlyLadder = lazy(() => import('./analytics/_MonthlyLadder.js'));
const SpendByAgentCard = lazy(() => import('./analytics/_SpendByAgentCard.js'));
const ProjectCostBars = lazy(() => import('./analytics/_ProjectCostBars.js'));
const TopRunsTable = lazy(() => import('./analytics/_TopRunsTable.js'));
const TerminalSessionsCard = lazy(() => import('./analytics/_TerminalSessionsCard.js'));

const MONO = TYPOGRAPHY.fontFamilyMono;

// Parse a YYYY-MM-DD (or any ISO that starts with YYYY-MM-DD) as a local-tz Date.
// Slicing avoids the UTC-midnight drift JS introduces for date-only ISO strings.
function parseYMDLocal(s: string): Date | null {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    const date = new Date(y, m - 1, d);
    /* v8 ignore next -- JS Date rolls over out-of-range numeric y/m/d instead of producing NaN, so with y/m/d already truthy (guarded above) this null path can't be hit by any real numeric input; kept as a defensive guard for exotic engines */
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatYMD(s: string, opts: Intl.DateTimeFormatOptions): string {
    const d = parseYMDLocal(s);
    return d ? d.toLocaleDateString(undefined, opts) : s;
}

// Chart series palette — fixed mid-saturation colours that read on both the
// light (#FAFAFA) and dark (#0A0A0A) page surfaces without flipping. The
// previous `ATLAS_PALETTE.brandBlue` / `.cerulean` / etc. all collapsed to
// the same accent value in Mercury, leaving multi-series charts monochrome.
// Mirrors `_chrome.tsx#CHART_COLORS` so the main /analytics surface and the
// drill-down pages share a single chart vocabulary.
const CHART_COLORS = {
    cost:         '#3B82F6',
    costSoft:     'rgba(59,130,246,.18)',
    input:        '#A855F7',
    output:       '#06B6D4',
    cached:       '#10B981',
    runs:         '#F59E0B',
    // Manual terminal sessions accent — kept in sync with `_chrome.tsx`
    // so the main /analytics surface and the drill-down pages share the
    // same vocabulary.
    terminal:     '#F97316',
    terminalSoft: 'rgba(249,115,22,.18)',
    grid:         'rgba(127,127,127,.16)',
    rail:         'rgba(127,127,127,.28)',
};

// Keyframe block injected once via a hidden style tag at the top of the page.
// We need raw CSS for staggered cascades and the "live" pulse — sx alone can't
// host @keyframes cleanly while still benefiting from compile-time emotion.
const ANIMATION_CSS = `
@keyframes atlas-anal-fade {
    from { opacity: 0; transform: translate3d(0, 12px, 0); }
    to   { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes atlas-anal-pulse {
    0%, 100% { transform: scale(1); opacity: 0.9; }
    50%      { transform: scale(1.35); opacity: 0.3; }
}
@keyframes atlas-anal-shimmer {
    0%   { background-position: -1200px 0; }
    100% { background-position: 1200px 0; }
}
.atlas-anal-cascade > * {
    opacity: 0;
    animation: atlas-anal-fade 480ms cubic-bezier(.18,.7,.2,1) forwards;
}
.atlas-anal-cascade > *:nth-of-type(1) { animation-delay: 0ms; }
.atlas-anal-cascade > *:nth-of-type(2) { animation-delay: 70ms; }
.atlas-anal-cascade > *:nth-of-type(3) { animation-delay: 140ms; }
.atlas-anal-cascade > *:nth-of-type(4) { animation-delay: 210ms; }
.atlas-anal-cascade > *:nth-of-type(5) { animation-delay: 280ms; }
.atlas-anal-cascade > *:nth-of-type(6) { animation-delay: 350ms; }
.atlas-anal-cascade > *:nth-of-type(7) { animation-delay: 420ms; }
`;

function Eyebrow({ children, light }: { children: React.ReactNode; light?: boolean }) {
    return (
        <Typography
            sx={{
                fontFamily: MONO,
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                /* v8 ignore next -- every Eyebrow call site in this file lives on the always-dark hero band and passes `light`; the non-light fallback is defensive for a future call site outside the hero */
                color: light ? 'rgba(255,255,255,.62)' : ATLAS_PALETTE.slate40,
            }}
        >
            {children}
        </Typography>
    );
}

function MetricMarquee({
    label,
    value,
    sub,
    accent,
}: {
    label: string;
    value: React.ReactNode;
    sub?: React.ReactNode;
    accent: string;
}) {
    return (
        <Box
            sx={{
                pl: 2.5,
                borderLeft: `2px solid ${accent}`,
                minWidth: 0,
            }}
        >
            <Typography
                sx={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: 'rgba(255,255,255,.55)',
                    fontWeight: 600,
                }}
            >
                {label}
            </Typography>
            <Typography
                sx={{
                    fontSize: 24,
                    fontWeight: 700,
                    // MetricMarquee always sits on the dark hero band — fixed
                    // white instead of the mode-flipping `ATLAS_PALETTE.white`.
                    color: '#FFFFFF',
                    mt: 0.5,
                    lineHeight: 1.1,
                    fontVariantNumeric: 'tabular-nums',
                }}
            >
                {value}
            </Typography>
            {/* v8 ignore next -- every MetricMarquee call site in this file passes a non-empty `sub` string; the falsy branch is unreachable in practice */}
            {sub && (
                <Typography
                    sx={{
                        fontFamily: MONO,
                        fontSize: 11,
                        color: 'rgba(255,255,255,.55)',
                        mt: 0.5,
                    }}
                >
                    {sub}
                </Typography>
            )}
        </Box>
    );
}

export function Analytics() {
    useSetPageTitle('Analytics');

    const { data, isPending } = useQuery({
        queryKey: ['analytics'],
        queryFn: () => api.analytics.get(),
        staleTime: 30_000,
    });

    // Stable "now" label per render — viewer-tz wall clock.
    const now = new Date();
    const monthLabel = now.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    const todayLabel = now.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
    const clockLabel = now.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const tzShort = (() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
            return 'UTC';
        }
    })();

    const chartData = useMemo(
        () =>
            (data?.daily ?? []).map((d) => ({
                date: formatYMD(d.date, { month: 'short', day: 'numeric' }),
                cost: Number(d.total_cost_usd.toFixed(4)),
                terminalCost: Number((d.terminal_total_cost_usd ?? 0).toFixed(4)),
                input: d.input_tokens,
                output: d.output_tokens,
                cached: d.cache_read_tokens,
                runs: d.run_count,
                terminalSessions: d.terminal_session_count ?? 0,
                terminalInput: d.terminal_input_tokens ?? 0,
                terminalOutput: d.terminal_output_tokens ?? 0,
                terminalCached: d.terminal_cache_read_tokens ?? 0,
            })),
        [data?.daily],
    );

    // Separate per-source datasets for the two Daily cards. Each row in
    // chartData becomes one entry in either array — we keep ALL dates
    // (even when one source had zero activity that day) so the two
    // charts share an x-axis and read as time-aligned siblings.
    const agenticDailyData = useMemo(
        () =>
            chartData.map((d) => ({
                date: d.date,
                cost: d.cost,
                input: d.input,
                output: d.output,
                cached: d.cached,
                runs: d.runs,
            })),
        [chartData],
    );
    const terminalDailyData = useMemo(
        () =>
            chartData.map((d) => ({
                date: d.date,
                cost: d.terminalCost,
                input: d.terminalInput,
                output: d.terminalOutput,
                cached: d.terminalCached,
                sessions: d.terminalSessions,
            })),
        [chartData],
    );

    const momData = useMemo(
        () =>
            (data?.monthly ?? []).map((m) => ({
                month: formatYMD(m.month + '-01', { month: 'short', year: '2-digit' }),
                key: m.month,
                cost: Number(m.total_cost_usd.toFixed(4)),
                terminalCost: Number((m.terminal_total_cost_usd ?? 0).toFixed(4)),
                runs: m.run_count,
                terminalSessions: m.terminal_session_count ?? 0,
                input: m.input_tokens,
                output: m.output_tokens,
                cached: m.cache_read_tokens,
            })),
        [data?.monthly],
    );

    // Month-over-month delta for hero KPIs (current vs previous month).
    // The delta tracks COMBINED spend (agentic + terminal) because that's
    // what the hero headline reports — a swing in terminal usage is just
    // as important to flag as a swing in autonomous runs.
    const momDelta = useMemo(() => {
        if (!data || momData.length < 2) return null;
        const cur = momData[momData.length - 1];
        const prev = momData[momData.length - 2];
        /* v8 ignore next -- defensive: momData.length >= 2 (checked above) already guarantees cur/prev are defined; guards against a future refactor of the length check */
        if (!cur || !prev) return null;
        const curCombined = cur.cost + cur.terminalCost;
        const prevCombined = prev.cost + prev.terminalCost;
        const costDelta = prevCombined > 0 ? (curCombined - prevCombined) / prevCombined : null;
        const runsDelta = prev.runs > 0 ? (cur.runs - prev.runs) / prev.runs : null;
        return { costDelta, runsDelta };
    }, [data, momData]);

    if (isPending) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: { xs: 6, md: 12 } }}>
                <Typography sx={{ fontSize: 22, fontWeight: 700, color: ATLAS_PALETTE.slate, mb: 6 }}>
                    Analytics
                </Typography>
                <Skeleton variant="rectangular" height={260} sx={{ borderRadius: '18px', mb: 4 }} />
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3, mb: 4 }}>
                    <Skeleton variant="rectangular" height={120} sx={{ borderRadius: '14px' }} />
                    <Skeleton variant="rectangular" height={120} sx={{ borderRadius: '14px' }} />
                    <Skeleton variant="rectangular" height={120} sx={{ borderRadius: '14px' }} />
                </Box>
                <Skeleton variant="rectangular" height={320} sx={{ borderRadius: '14px', mb: 4 }} />
                <Skeleton variant="rectangular" height={240} sx={{ borderRadius: '14px' }} />
            </Box>
        );
    }

    if (!data) return null;

    const totalTokens =
        data.summary.input_tokens + data.summary.output_tokens + data.summary.cache_read_tokens;
    const cacheEffPct = (data.cacheEfficiency * 100).toFixed(1);

    const totalAgentCost = data.byAgent.reduce((acc, a) => acc + a.total_cost_usd, 0);
    const topProjectMax = data.byProject.length > 0
        ? Math.max(...data.byProject.map((p) => p.total_cost_usd))
        : 0;
    const topRunsMaxCost = data.topRuns.length > 0
        ? Math.max(...data.topRuns.map((r) => r.total_cost_usd))
        : 0;

    // Derived measurable metrics — these are the numbers leadership actually
    // wants to see, not the raw sums above. With terminal sessions in
    // scope, the unified "spend" / "session count" pair replaces the
    // agent-only "cost" / "run count" pair for hero-level KPIs. Per-source
    // numbers are still available via data.summary / terminalSummary
    // for the source-split chip and the dedicated terminal-sessions card.
    //
    // Defensive defaults for terminal* slices — older API responses (or
    // tests with partial fixtures) may omit them. Treating them as
    // zero/empty lets the rest of the hero render normally and shows
    // an empty TerminalSessionsCard further down.
    const terminalSummary = data.terminalSummary ?? {
        total_cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        session_count: 0,
    };
    const terminalByCli = data.terminalByCli ?? [];
    const terminalByProject = data.terminalByProject ?? [];
    const topTerminalSessions = data.topTerminalSessions ?? [];

    const runCount = data.summary.run_count;
    const terminalSessionCount = terminalSummary.session_count;
    const sessionCount = runCount + terminalSessionCount;
    const totalSpend = data.summary.total_cost_usd + terminalSummary.total_cost_usd;
    const terminalTokens =
        terminalSummary.input_tokens +
        terminalSummary.output_tokens +
        terminalSummary.cache_read_tokens;
    const totalTokensAll = totalTokens + terminalTokens;
    const avgCostPerSession = sessionCount > 0 ? totalSpend / sessionCount : 0;
    const avgTokensPerSession = sessionCount > 0 ? totalTokensAll / sessionCount : 0;
    const costPerMillionTokens =
        totalTokensAll > 0 ? (totalSpend / totalTokensAll) * 1_000_000 : 0;
    const daysActive = data.daily.length;
    // Per-source active-day counts — drives the sub-line on each Daily
    // card. Counts only days where THAT source had any spend or token
    // activity, so an agentic-only month doesn't claim "30 active days"
    // on the terminal card and vice-versa.
    const agenticActiveDays = chartData.filter(
        (d) => d.cost > 0 || d.input > 0 || d.output > 0 || d.cached > 0 || d.runs > 0,
    ).length;
    const terminalActiveDays = chartData.filter(
        (d) =>
            d.terminalCost > 0 ||
            d.terminalInput > 0 ||
            d.terminalOutput > 0 ||
            d.terminalCached > 0 ||
            d.terminalSessions > 0,
    ).length;
    const cacheReadTokens = data.summary.cache_read_tokens;

    const formatDeltaPct = (v: number | null) => {
        /* v8 ignore next -- the sole call site below only invokes formatDeltaPct inside a `momDelta.costDelta !== null` guard, so v is never null there; kept as a defensive fallback for future call sites */
        if (v === null) return '—';
        const sign = v >= 0 ? '+' : '';
        return `${sign}${(v * 100).toFixed(1)}%`;
    };

    // Headline insight — one measurable sentence with hard numbers. Priority:
    //   1. Large MoM cost swing (dollars + percentage)
    //   2. Material cache savings (dollars + hit rate)
    //   3. Workload concentration on top agent
    //   4. Fallback: run / project / day activity counts
    const headlineInsight: { label: string; sentence: string; tone: 'good' | 'warn' | 'neutral' } = (() => {
        if (momDelta && momDelta.costDelta !== null && Math.abs(momDelta.costDelta) >= 0.25 && momData.length >= 2) {
            const cur = momData[momData.length - 1]!;
            const prev = momData[momData.length - 2]!;
            const tone: 'good' | 'warn' = momDelta.costDelta < 0 ? 'good' : 'warn';
            const dir = momDelta.costDelta < 0 ? 'down' : 'up';
            return {
                label: 'Month-over-month',
                sentence: `Spend is ${dir} ${Math.abs(momDelta.costDelta * 100).toFixed(1)}% vs last month — ${formatCostUsd(cur.cost)} this month against ${formatCostUsd(prev.cost)} prior.`,
                tone,
            };
        }
        if (data.cacheEfficiency >= 0.5) {
            return {
                label: 'Cache leverage',
                sentence: `${(data.cacheEfficiency * 100).toFixed(1)}% of input context came from cache this month — ${formatTokenCount(cacheReadTokens)} cached reads against ${formatTokenCount(data.summary.input_tokens)} fresh input across ${runCount.toLocaleString()} runs.`,
                tone: 'good',
            };
        }
        if (data.byAgent.length > 0) {
            const top = data.byAgent[0]!;
            const topShare = totalAgentCost > 0 ? (top.total_cost_usd / totalAgentCost) * 100 : 0;
            if (topShare >= 40) {
                return {
                    label: 'Workload concentration',
                    sentence: `${top.agent_name} carries ${topShare.toFixed(0)}% of agent spend (${formatCostUsd(top.total_cost_usd)} of ${formatCostUsd(totalAgentCost)}) — the rest of the fleet is sharing the remainder.`,
                    tone: 'neutral',
                };
            }
        }
        return {
            label: 'Activity',
            sentence: `${sessionCount.toLocaleString()} session${sessionCount === 1 ? '' : 's'} (${runCount.toLocaleString()} agentic, ${terminalSessionCount.toLocaleString()} terminal) on ${daysActive} active day${daysActive === 1 ? '' : 's'} across ${data.byProject.length} project${data.byProject.length === 1 ? '' : 's'}, averaging ${formatCostUsd(avgCostPerSession)} per session.`,
            tone: 'neutral',
        };
    })();

    // Insight chip lives inside the always-dark hero band — fixed hex
    // values keep these legible regardless of the mode-flipping palette.
    const insightTone = {
        good: {
            bg: 'rgba(134,239,172,.18)',
            bd: 'rgba(134,239,172,.45)',
            dot: '#86EFAC',
        },
        warn: {
            bg: 'rgba(252,211,77,.18)',
            bd: 'rgba(252,211,77,.45)',
            dot: '#FCD34D',
        },
        neutral: {
            bg: 'rgba(125,211,252,.16)',
            bd: 'rgba(125,211,252,.42)',
            dot: '#7DD3FC',
        },
    }[headlineInsight.tone];

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: { xs: 6, md: 12 } }}>
            {/* Inject keyframes once. */}
            <style>{ANIMATION_CSS}</style>

            <Box className="atlas-anal-cascade" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* ── Hero Command Deck ────────────────────────────────────────── */}
                <Box
                    sx={{
                        position: 'relative',
                        borderRadius: '18px',
                        overflow: 'hidden',
                        // Hero band is intentionally always-dark (navy → indigo
                        // gradient) regardless of theme mode, so its contents
                        // use fixed-light colour values rather than the
                        // mode-aware `ATLAS_PALETTE.white` (which flips to a
                        // near-black in dark mode and was rendering invisible
                        // text on the dark hero).
                        background: `
                            radial-gradient(1200px 320px at 90% -10%, rgba(0,185,255,.35), transparent 60%),
                            radial-gradient(900px 260px at 0% 110%, rgba(70,33,124,.32), transparent 55%),
                            linear-gradient(135deg, #0b1f44 0%, #122a5c 55%, #0d2050 100%)
                        `,
                        color: '#FFFFFF',
                        p: { xs: 4, md: 6 },
                        boxShadow: '0 24px 60px rgba(11,31,68,.18)',
                    }}
                >
                    {/* Dot-grid texture overlay */}
                    <Box
                        aria-hidden
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            backgroundImage:
                                'radial-gradient(rgba(255,255,255,.06) 1px, transparent 1px)',
                            backgroundSize: '22px 22px',
                            backgroundPosition: '0 0',
                            mixBlendMode: 'screen',
                            pointerEvents: 'none',
                        }}
                    />
                    {/* Top "live" rail */}
                    <Box
                        sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            height: 2,
                            background: 'linear-gradient(90deg, transparent, #7DD3FC, transparent)',
                            opacity: 0.7,
                        }}
                    />

                    <Box
                        sx={{
                            position: 'relative',
                            display: 'grid',
                            gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr' },
                            gap: { xs: 5, md: 8 },
                            alignItems: 'end',
                        }}
                    >
                        {/* Left: brand line + headline metric */}
                        <Box sx={{ minWidth: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
                                <Box
                                    sx={{
                                        // Fixed sky-blue against the always-dark hero — `ATLAS_PALETTE.cerulean`
                                        // collapsed to monochrome (invisible against the navy gradient in light
                                        // mode and indistinct in dark) so the live-rail dot is now anchored.
                                        width: 10,
                                        height: 10,
                                        borderRadius: '50%',
                                        background: '#7DD3FC',
                                        boxShadow: '0 0 0 4px rgba(125,211,252,.22)',
                                        position: 'relative',
                                        '&::after': {
                                            content: '""',
                                            position: 'absolute',
                                            inset: -3,
                                            borderRadius: '50%',
                                            border: '2px solid #7DD3FC',
                                            animation: 'atlas-anal-pulse 1800ms ease-in-out infinite',
                                        },
                                    }}
                                />
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        letterSpacing: '0.22em',
                                        textTransform: 'uppercase',
                                        color: 'rgba(255,255,255,.7)',
                                        fontWeight: 600,
                                    }}
                                >
                                    {todayLabel} · {clockLabel} {tzShort}
                                </Typography>
                            </Box>

                            <Typography
                                sx={{
                                    fontFamily: '"Inter", system-ui, sans-serif',
                                    fontSize: { xs: 36, md: 48 },
                                    fontWeight: 800,
                                    lineHeight: 1,
                                    letterSpacing: '-0.025em',
                                    color: '#FFFFFF',
                                }}
                            >
                                Analytics
                            </Typography>
                            <Typography
                                sx={{
                                    fontSize: 14,
                                    color: 'rgba(255,255,255,.7)',
                                    mt: 1.5,
                                    maxWidth: 560,
                                    lineHeight: 1.55,
                                }}
                            >
                                AI spend, throughput, and cache efficiency for {monthLabel} — autonomous agent runs and manual terminal sessions combined. All times shown in {tzShort}.
                            </Typography>

                            {/* Headline metric: total cost */}
                            <Box sx={{ mt: 6 }}>
                                <Eyebrow light>Total Spend · {monthLabel}</Eyebrow>
                                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mt: 1 }}>
                                    <Typography
                                        sx={{
                                            fontFamily: '"Inter", system-ui, sans-serif',
                                            fontSize: { xs: 56, md: 84 },
                                            fontWeight: 800,
                                            lineHeight: 1,
                                            letterSpacing: '-0.03em',
                                            // Always-light text on the fixed-dark hero band — use a literal
                                            // gradient instead of `ATLAS_PALETTE.white` (mode-flipping token).
                                            color: '#FFFFFF',
                                            fontVariantNumeric: 'tabular-nums',
                                            background: 'linear-gradient(180deg, #FFFFFF 0%, rgba(255,255,255,.78) 100%)',
                                            WebkitBackgroundClip: 'text',
                                            WebkitTextFillColor: 'transparent',
                                            backgroundClip: 'text',
                                        }}
                                    >
                                        {formatCostUsd(totalSpend)}
                                    </Typography>
                                    {momDelta?.costDelta !== null && momDelta?.costDelta !== undefined && (
                                        <Box
                                            sx={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 0.5,
                                                px: 1.5,
                                                py: 0.5,
                                                borderRadius: '999px',
                                                // Fixed pastel rgba tints — the pill sits on the always-dark hero
                                                // band, so ATLAS_PALETTE.green/.orange flip to near-black in light
                                                // mode and rendered dark-on-dark. Values track the insight-chip family.
                                                background:
                                                    momDelta.costDelta >= 0
                                                        ? 'rgba(252,211,77,.18)'
                                                        : 'rgba(134,239,172,.18)',
                                                border:
                                                    momDelta.costDelta >= 0
                                                        ? '1px solid rgba(252,211,77,.45)'
                                                        : '1px solid rgba(134,239,172,.45)',
                                                color:
                                                    momDelta.costDelta >= 0
                                                        ? '#FCD34D'
                                                        : '#86EFAC',
                                                fontFamily: MONO,
                                                fontSize: 12,
                                                fontWeight: 700,
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {momDelta.costDelta >= 0 ? '▲' : '▼'}{' '}
                                            {formatDeltaPct(momDelta.costDelta)}
                                            <Typography
                                                component="span"
                                                sx={{ fontSize: 10, opacity: 0.7, ml: 0.5 }}
                                            >
                                                vs last month
                                            </Typography>
                                        </Box>
                                    )}
                                </Box>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 12,
                                        color: 'rgba(255,255,255,.55)',
                                        mt: 1.5,
                                    }}
                                >
                                    {sessionCount.toLocaleString()} session{sessionCount === 1 ? '' : 's'} · {formatTokenCount(totalTokensAll)} tokens processed
                                    {data.byAgent.length > 0 && (
                                        <> · {data.byAgent.length} agent{data.byAgent.length === 1 ? '' : 's'} contributing</>
                                    )}
                                </Typography>

                                {/* Source split chip — breaks the unified total
                                    into its agentic (autonomous run) and terminal
                                    (manual user-driven) components so the Owner
                                    sees WHERE the spend came from at a glance.
                                    Same eyebrow-style typography as the rest of
                                    the hero metadata; one colored dot per source
                                    keyed to the daily-trend chart palette. */}
                                <Box
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 2.5,
                                        mt: 1.5,
                                        flexWrap: 'wrap',
                                    }}
                                >
                                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                        <Box
                                            sx={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: '50%',
                                                background: CHART_COLORS.cost,
                                                boxShadow: '0 0 0 2px rgba(59,130,246,.25)',
                                            }}
                                        />
                                        <Typography
                                            sx={{
                                                fontFamily: MONO,
                                                fontSize: 11.5,
                                                color: 'rgba(255,255,255,.78)',
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            {formatCostUsd(data.summary.total_cost_usd)} <Box component="span" sx={{ color: 'rgba(255,255,255,.45)', ml: 0.5, fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Agentic</Box>
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                        <Box
                                            sx={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: '50%',
                                                background: CHART_COLORS.terminal,
                                                boxShadow: '0 0 0 2px rgba(249,115,22,.28)',
                                            }}
                                        />
                                        <Typography
                                            sx={{
                                                fontFamily: MONO,
                                                fontSize: 11.5,
                                                color: 'rgba(255,255,255,.78)',
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            {formatCostUsd(terminalSummary.total_cost_usd)} <Box component="span" sx={{ color: 'rgba(255,255,255,.45)', ml: 0.5, fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Terminal</Box>
                                        </Typography>
                                    </Box>
                                </Box>
                            </Box>
                        </Box>

                        {/* Right: marquee metrics + inline sparkline */}
                        <Box sx={{ minWidth: 0 }}>
                            <Box
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(2, 1fr)',
                                    gap: 4,
                                    mb: 4,
                                }}
                            >
                                <MetricMarquee
                                    label="Avg cost / session"
                                    value={sessionCount > 0 ? formatCostUsd(avgCostPerSession) : '—'}
                                    sub={`${runCount.toLocaleString()} agentic · ${terminalSessionCount.toLocaleString()} terminal`}
                                    accent="#7DD3FC"
                                />
                                <MetricMarquee
                                    label="Avg tokens / session"
                                    value={sessionCount > 0 ? formatTokenCount(Math.round(avgTokensPerSession)) : '—'}
                                    sub={`${formatTokenCount(totalTokensAll)} total`}
                                    accent="#C4B5FD"
                                />
                                <MetricMarquee
                                    label="Cost / 1M tokens"
                                    value={totalTokensAll > 0 ? `$${costPerMillionTokens.toFixed(2)}` : '—'}
                                    sub="blended effective rate"
                                    accent="#FCD34D"
                                />
                                <MetricMarquee
                                    label="Cache hit rate"
                                    value={`${cacheEffPct}%`}
                                    sub={`${formatTokenCount(cacheReadTokens)} cached reads`}
                                    accent="#86EFAC"
                                />
                            </Box>

                            {/* Inline sparkline of the current month, contrasted on the gradient */}
                            <Box
                                sx={{
                                    border: '1px solid rgba(255,255,255,.12)',
                                    borderRadius: '12px',
                                    p: 2.5,
                                    background: 'rgba(255,255,255,.04)',
                                    backdropFilter: 'blur(6px)',
                                }}
                            >
                                <Box
                                    sx={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        mb: 1.5,
                                    }}
                                >
                                    <Eyebrow light>Daily Pulse — {monthLabel}</Eyebrow>
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 10,
                                            color: 'rgba(255,255,255,.55)',
                                        }}
                                    >
                                        {chartData.length}d
                                    </Typography>
                                </Box>
                                <ResponsiveContainer width="100%" height={70}>
                                    <AreaChart
                                        data={
                                            chartData.length > 0
                                                ? chartData
                                                : [
                                                      {
                                                          date: '',
                                                          cost: 0,
                                                          terminalCost: 0,
                                                          input: 0,
                                                          output: 0,
                                                          cached: 0,
                                                          runs: 0,
                                                          terminalSessions: 0,
                                                          terminalInput: 0,
                                                          terminalOutput: 0,
                                                          terminalCached: 0,
                                                      },
                                                  ]
                                        }
                                        margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
                                    >
                                        <defs>
                                            <linearGradient id="heroSpark" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#7DD3FC" stopOpacity={0.55} />
                                                <stop offset="100%" stopColor="#7DD3FC" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <Area
                                            type="monotone"
                                            dataKey="cost"
                                            stroke="#7DD3FC"
                                            strokeWidth={1.75}
                                            fill="url(#heroSpark)"
                                            dot={false}
                                            isAnimationActive
                                            animationDuration={900}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </Box>
                        </Box>
                    </Box>

                    {/* Hero footer: headline insight */}
                    <Box
                        sx={{
                            position: 'relative',
                            mt: { xs: 4, md: 6 },
                            pt: 3,
                            borderTop: '1px solid rgba(255,255,255,.10)',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 2,
                            minWidth: 0,
                        }}
                    >
                        <Box
                            sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: insightTone.dot,
                                boxShadow: `0 0 0 4px ${insightTone.bg}`,
                                flexShrink: 0,
                                mt: '6px',
                            }}
                        />
                        <Box sx={{ minWidth: 0 }}>
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 10,
                                    letterSpacing: '0.18em',
                                    textTransform: 'uppercase',
                                    color: 'rgba(255,255,255,.55)',
                                    fontWeight: 600,
                                    mb: 0.5,
                                }}
                            >
                                {headlineInsight.label}
                            </Typography>
                            <Typography
                                sx={{
                                    fontSize: 14,
                                    color: 'rgba(255,255,255,.92)',
                                    lineHeight: 1.55,
                                    maxWidth: 920,
                                }}
                            >
                                {headlineInsight.sentence}
                            </Typography>
                        </Box>
                    </Box>
                </Box>

                {/* ── Below-hero analytics grid ────────────────────────────────────
                    Uniform 2-col layout: every card is 6/12 on web (md+) and
                    12/12 on mobile (xs/sm). Each card renders its own empty
                    state when its dataset is empty, so the page never shows
                    a blank column when one half of the data is missing. */}
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
                        gap: 3,
                        '& > *': { minWidth: 0 },
                    }}
                >
                    <Suspense fallback={<Skeleton variant="rounded" height={420} />}>
                        <AgenticDailyCard
                            data={agenticDailyData}
                            monthLabel={monthLabel}
                            daysActive={agenticActiveDays}
                            runCount={runCount}
                            totalAgentTokens={totalTokens}
                            totalAgentCost={data.summary.total_cost_usd}
                        />
                    </Suspense>
                    <Suspense fallback={<Skeleton variant="rounded" height={420} />}>
                        <TerminalDailyCard
                            data={terminalDailyData}
                            monthLabel={monthLabel}
                            activeDays={terminalActiveDays}
                            sessionCount={terminalSessionCount}
                            totalTerminalTokens={terminalTokens}
                            totalTerminalCost={terminalSummary.total_cost_usd}
                        />
                    </Suspense>
                    <Suspense fallback={<Skeleton variant="rounded" height={420} />}>
                        <MonthlyLadder momData={momData} />
                    </Suspense>
                    <Suspense fallback={<Skeleton variant="rounded" height={420} />}>
                        <SpendByAgentCard
                            byAgent={data.byAgent}
                            totalAgentCost={totalAgentCost}
                        />
                    </Suspense>
                    <Suspense fallback={<Skeleton variant="rounded" height={420} />}>
                        <TerminalSessionsCard
                            summary={terminalSummary}
                            byCli={terminalByCli}
                            topSessions={topTerminalSessions}
                            monthLabel={monthLabel}
                        />
                    </Suspense>
                    <Suspense fallback={<Skeleton variant="rounded" height={420} />}>
                        <ProjectCostBars
                            byProject={data.byProject}
                            terminalByProject={terminalByProject}
                            topProjectMax={topProjectMax}
                        />
                    </Suspense>
                    <Suspense fallback={<Skeleton variant="rounded" height={420} />}>
                        <Box sx={{ gridColumn: { md: '1 / -1' }, minWidth: 0 }}>
                            <TopRunsTable
                                topRuns={data.topRuns}
                                topRunsMaxCost={topRunsMaxCost}
                            />
                        </Box>
                    </Suspense>
                </Box>
            </Box>
        </Box>
    );
}

