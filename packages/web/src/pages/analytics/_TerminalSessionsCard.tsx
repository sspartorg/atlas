import { Fragment, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import { Link as RouterLink } from 'react-router-dom';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { formatCostUsd, formatTokenCount } from '../../utils/formatCost.js';
import { Card, ChartTitle, Eyebrow, CHART_COLORS, MONO } from './_chrome.js';
import type { AnalyticsSessionSubagent } from '../../api/types.js';
import { CLI_SHORT_LABEL, type AgentCli } from '@atlas/shared';

// "Manual terminal sessions" surface — the dedicated section that puts a
// face on the orange accent we use elsewhere on /analytics for terminal
// data. Three metric tiles (sessions / spend / avg duration), a per-CLI
// horizontal bar split, and a 5-row top-sessions table that deep-links
// to /terminal/<id>/history.
//
// All inputs are the terminal slices already in the AnalyticsResponse:
//   terminalSummary  — current-month totals
//   terminalByCli    — claude vs copilot breakdown
//   topTerminalSessions — 10 most expensive (we render 5 here)
//
// Auto-hides when terminalSummary.session_count is 0, so this card never
// renders a blank stat block when the Owner hasn't used the terminal
// surface yet.

interface TerminalSummary {
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    session_count: number;
}

interface ByCliRow {
    cli: AgentCli;
    total_cost_usd: number;
    session_count: number;
    input_tokens: number;
    output_tokens: number;
}

interface TopSession {
    session_id: string;
    // Null for standalone sessions — they have no project to left-join to.
    project_name: string | null;
    title: string;
    cli: AgentCli;
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    closed_at: string;
    subagents: AnalyticsSessionSubagent[];
}

interface Props {
    summary: TerminalSummary;
    byCli: ByCliRow[];
    topSessions: TopSession[];
    monthLabel: string;
}

// Label + accent now come from the shared CLI presentation registry, keyed on
// `AgentCli`. They used to be local maps keyed on an inline
// `'claude' | 'copilot'` union — which meant a third CLI rendered an
// `undefined` label in an `undefined`-coloured segment, with no type error and
// no failing test to catch it.
const CLI_LABEL: Record<AgentCli, string> = CLI_SHORT_LABEL;

// Per-CLI accent, scoped to this card because the bar split is the only place
// that needs one. Claude is the agentic palette's blue (same family as agent
// runs), Copilot the brand green, Ollama amber — three values that stay
// readable against the card's orange chrome.
const CLI_ACCENT: Record<AgentCli, string> = {
    claude: '#6366F1',
    copilot: '#22C55E',
    ollama: ATLAS_PALETTE.amber,
};

function relativeShort(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const diffMs = Date.now() - d.getTime();
    const mins = Math.round(diffMs / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 14) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function TerminalSessionsCard({ summary, byCli, topSessions, monthLabel }: Props) {
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const toggleExpanded = (sessionId: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(sessionId)) next.delete(sessionId);
            else next.add(sessionId);
            return next;
        });
    if (summary.session_count === 0) {
        // Empty state — keep the card visible (consistent with the rest
        // of the page) but in a quieter "no terminal usage yet this
        // month" shape so it doesn't read as a missing-data bug.
        return (
            <Card>
                <ChartTitle
                    eyebrow="Manual terminal sessions"
                    title="Owner-driven runs"
                    sub={`No closed sessions this month — start one from /terminal to populate this view.`}
                />
                <Box
                    sx={{
                        textAlign: 'center',
                        color: ATLAS_PALETTE.slate40,
                        fontFamily: MONO,
                        fontSize: 12,
                        py: 4,
                    }}
                >
                    — no terminal sessions for {monthLabel} —
                </Box>
            </Card>
        );
    }

    const totalCliCost = byCli.reduce((acc, r) => acc + r.total_cost_usd, 0);
    const totalTokens =
        summary.input_tokens + summary.output_tokens + summary.cache_read_tokens;

    return (
        <Card>
            <ChartTitle
                eyebrow="Manual terminal sessions"
                title="Owner-driven runs"
                sub={`Closed sessions for ${monthLabel}. Manual terminal usage parallels autonomous agent runs in this period.`}
            />

            {/* Metric tiles — three across, oriented along the orange
                accent so they read as "this is the terminal half" of
                the analytics surface. Same tabular-numerics + mono
                pairing the rest of the page uses. */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                    gap: 2,
                    mb: 4,
                    pb: 3,
                    borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                }}
            >
                <MetricTile
                    label="Sessions closed"
                    value={summary.session_count.toLocaleString()}
                    sub={byCli
                        .map(
                            (r) =>
                                `${r.session_count.toLocaleString()} ${CLI_LABEL[r.cli].toLowerCase()}`,
                        )
                        .join(' · ')}
                    accent={CHART_COLORS.terminal}
                />
                <MetricTile
                    label="Total spend"
                    value={formatCostUsd(summary.total_cost_usd)}
                    sub={`${formatTokenCount(totalTokens)} tokens · ${formatTokenCount(summary.cache_read_tokens)} cached`}
                    accent={CHART_COLORS.terminal}
                />
                <MetricTile
                    label="Avg per session"
                    value={
                        summary.session_count > 0
                            ? formatCostUsd(summary.total_cost_usd / summary.session_count)
                            : '—'
                    }
                    sub="blended across both CLIs"
                    accent={CHART_COLORS.terminal}
                />
            </Box>

            {/* Two-column body. Left: per-CLI horizontal bar. Right:
                top sessions table. Stacks on narrow screens. */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', lg: '1fr 1.2fr' },
                    gap: 4,
                    '& > *': { minWidth: 0 },
                }}
            >
                {/* By CLI */}
                <Box>
                    <Eyebrow>Split by CLI</Eyebrow>
                    <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        {byCli.map((r) => {
                            const pct = totalCliCost > 0 ? (r.total_cost_usd / totalCliCost) * 100 : 0;
                            return (
                                <Box key={r.cli}>
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'baseline',
                                            justifyContent: 'space-between',
                                            mb: 0.75,
                                        }}
                                    >
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Box
                                                sx={{
                                                    width: 8,
                                                    height: 8,
                                                    borderRadius: '50%',
                                                    background: CLI_ACCENT[r.cli],
                                                }}
                                            />
                                            <Typography
                                                sx={{
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                    color: ATLAS_PALETTE.slate,
                                                }}
                                            >
                                                {CLI_LABEL[r.cli]}
                                            </Typography>
                                            <Typography
                                                sx={{
                                                    fontFamily: MONO,
                                                    fontSize: 11,
                                                    color: ATLAS_PALETTE.slate40,
                                                }}
                                            >
                                                {r.session_count} session{r.session_count === 1 ? '' : 's'}
                                            </Typography>
                                        </Box>
                                        <Typography
                                            sx={{
                                                fontFamily: MONO,
                                                fontSize: 12.5,
                                                fontWeight: 700,
                                                color: ATLAS_PALETTE.slate,
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            {formatCostUsd(r.total_cost_usd)}
                                            <Box
                                                component="span"
                                                sx={{
                                                    ml: 1,
                                                    color: ATLAS_PALETTE.slate40,
                                                    fontSize: 10.5,
                                                }}
                                            >
                                                {pct.toFixed(1)}%
                                            </Box>
                                        </Typography>
                                    </Box>
                                    {/* Bar */}
                                    <Box
                                        sx={{
                                            position: 'relative',
                                            height: 8,
                                            borderRadius: '999px',
                                            background: ATLAS_PALETTE.slate06,
                                            overflow: 'hidden',
                                        }}
                                    >
                                        <Box
                                            sx={{
                                                position: 'absolute',
                                                left: 0,
                                                top: 0,
                                                bottom: 0,
                                                width: `${Math.max(2, Math.min(100, pct))}%`,
                                                background: CLI_ACCENT[r.cli],
                                                borderRadius: '999px',
                                                transition: 'width 320ms ease',
                                            }}
                                        />
                                    </Box>
                                </Box>
                            );
                        })}
                        {byCli.length === 0 && (
                            <Typography
                                sx={{
                                    color: ATLAS_PALETTE.slate40,
                                    fontFamily: MONO,
                                    fontSize: 12,
                                    py: 2,
                                }}
                            >
                                no CLI breakdown
                            </Typography>
                        )}
                    </Box>
                </Box>

                {/* Top sessions table */}
                <Box>
                    <Eyebrow>Top sessions by cost</Eyebrow>
                    <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                        {topSessions.slice(0, 5).map((s) => {
                            const isOpen = expanded.has(s.session_id);
                            const hasSubagents = s.subagents.length > 0;
                            return (
                                <Fragment key={s.session_id}>
                                    <Box
                                        sx={{
                                            display: 'grid',
                                            gridTemplateColumns: '1fr auto auto auto',
                                            alignItems: 'center',
                                            gap: 1.5,
                                            p: 1.5,
                                            borderRadius: '10px',
                                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                            background: ATLAS_PALETTE.surfaceRaised,
                                            transition: 'border-color 160ms ease, background 160ms ease',
                                            '&:hover': {
                                                borderColor: CHART_COLORS.terminal,
                                                background: CHART_COLORS.terminalSoft,
                                            },
                                        }}
                                    >
                                        <Box
                                            component={RouterLink}
                                            to={`/terminal/${s.session_id}/history`}
                                            sx={{
                                                minWidth: 0,
                                                textDecoration: 'none',
                                                color: 'inherit',
                                            }}
                                        >
                                            <Typography
                                                sx={{
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                    color: ATLAS_PALETTE.slate,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {s.title || `Session ${s.session_id.slice(0, 8)}`}
                                            </Typography>
                                            <Typography
                                                sx={{
                                                    fontFamily: MONO,
                                                    fontSize: 10.5,
                                                    color: ATLAS_PALETTE.slate40,
                                                    mt: 0.25,
                                                }}
                                            >
                                                {s.project_name ?? 'Standalone'} · {relativeShort(s.closed_at)} · {formatTokenCount(s.input_tokens + s.output_tokens + s.cache_read_tokens)} tok
                                                {hasSubagents && ` · ${s.subagents.length} subagent${s.subagents.length === 1 ? '' : 's'}`}
                                            </Typography>
                                        </Box>
                                        <Chip
                                            label={CLI_LABEL[s.cli]}
                                            size="small"
                                            sx={{
                                                height: 20,
                                                fontFamily: MONO,
                                                fontSize: 10.5,
                                                fontWeight: 600,
                                                color: CLI_ACCENT[s.cli],
                                                backgroundColor: `${CLI_ACCENT[s.cli]}1A`,
                                                border: `1px solid ${CLI_ACCENT[s.cli]}44`,
                                            }}
                                        />
                                        <Typography
                                            sx={{
                                                fontFamily: MONO,
                                                fontSize: 13,
                                                fontWeight: 700,
                                                color: ATLAS_PALETTE.slate,
                                                fontVariantNumeric: 'tabular-nums',
                                                textAlign: 'right',
                                                minWidth: 60,
                                            }}
                                        >
                                            {formatCostUsd(s.total_cost_usd)}
                                        </Typography>
                                        <IconButton
                                            aria-label={isOpen ? 'Collapse subagents' : 'Expand subagents'}
                                            onClick={() => toggleExpanded(s.session_id)}
                                            disabled={!hasSubagents}
                                            size="small"
                                            sx={{
                                                color: hasSubagents
                                                    ? ATLAS_PALETTE.slate60
                                                    : ATLAS_PALETTE.slate30,
                                                width: 28,
                                                height: 28,
                                            }}
                                        >
                                            <Box
                                                component="span"
                                                className="material-symbols-rounded"
                                                sx={{
                                                    fontSize: 18,
                                                    transition: 'transform 150ms ease',
                                                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                                }}
                                            >
                                                expand_more
                                            </Box>
                                        </IconButton>
                                    </Box>
                                    {isOpen && hasSubagents && (
                                        <SubagentPanel cli={s.cli} subagents={s.subagents} />
                                    )}
                                </Fragment>
                            );
                        })}
                        {topSessions.length === 0 && (
                            <Typography
                                sx={{
                                    color: ATLAS_PALETTE.slate40,
                                    fontFamily: MONO,
                                    fontSize: 12,
                                    py: 2,
                                }}
                            >
                                no sessions yet
                            </Typography>
                        )}
                    </Box>
                </Box>
            </Box>
        </Card>
    );
}

function MetricTile({
    label,
    value,
    sub,
    accent,
}: {
    label: string;
    value: string;
    sub?: string;
    accent: string;
}) {
    return (
        <Box
            sx={{
                pl: 2,
                borderLeft: `2px solid ${accent}`,
            }}
        >
            <Typography
                sx={{
                    fontFamily: MONO,
                    fontSize: 10.5,
                    fontWeight: 600,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: ATLAS_PALETTE.slate40,
                }}
            >
                {label}
            </Typography>
            <Typography
                sx={{
                    fontFamily: TYPOGRAPHY.fontFamily,
                    fontSize: 22,
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    mt: 0.5,
                    lineHeight: 1.1,
                    fontVariantNumeric: 'tabular-nums',
                }}
            >
                {value}
            </Typography>
            {sub && (
                <Typography
                    sx={{
                        fontFamily: MONO,
                        fontSize: 11,
                        color: ATLAS_PALETTE.slate60,
                        mt: 0.5,
                    }}
                >
                    {sub}
                </Typography>
            )}
        </Box>
    );
}

function SubagentPanel({
    cli,
    subagents,
}: {
    cli: AgentCli;
    subagents: AnalyticsSessionSubagent[];
}) {
    return (
        <Box
            sx={{
                ml: 2,
                mt: -0.25,
                mb: 0.5,
                pl: 2,
                py: 1.5,
                borderLeft: `2px solid ${CLI_ACCENT[cli]}44`,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
            }}
        >
            {subagents.map((sa) => {
                const totalTokens =
                    (sa.input_tokens ?? 0) + (sa.output_tokens ?? 0) + (sa.cache_read_tokens ?? 0);
                return (
                    <Box
                        key={sa.subagent_key}
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: '1fr auto',
                            alignItems: 'center',
                            gap: 1.5,
                        }}
                    >
                        <Box sx={{ minWidth: 0 }}>
                            <Typography
                                sx={{
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {sa.agent_type ?? sa.subagent_key}
                                {sa.is_estimate && (
                                    <Box
                                        component="span"
                                        sx={{
                                            ml: 1,
                                            px: 0.75,
                                            py: 0.1,
                                            borderRadius: '4px',
                                            fontFamily: MONO,
                                            fontSize: 9.5,
                                            fontWeight: 500,
                                            color: ATLAS_PALETTE.slate60,
                                            background: ATLAS_PALETTE.slate06,
                                            verticalAlign: 'middle',
                                        }}
                                    >
                                        ~ estimate
                                    </Box>
                                )}
                            </Typography>
                            {sa.description && (
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 10.5,
                                        color: ATLAS_PALETTE.slate40,
                                        mt: 0.25,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {sa.description}
                                </Typography>
                            )}
                        </Box>
                        <Typography
                            sx={{
                                fontFamily: MONO,
                                fontSize: 11.5,
                                color: ATLAS_PALETTE.slate60,
                                fontVariantNumeric: 'tabular-nums',
                                textAlign: 'right',
                            }}
                        >
                            {sa.cost_usd !== null && sa.cost_usd !== undefined
                                ? formatCostUsd(sa.cost_usd)
                                : '—'}
                            {totalTokens > 0 && (
                                <Box component="span" sx={{ color: ATLAS_PALETTE.slate40, ml: 1 }}>
                                    {formatTokenCount(totalTokens)} tok
                                </Box>
                            )}
                        </Typography>
                    </Box>
                );
            })}
            {cli === 'copilot' && (
                <Typography
                    sx={{
                        mt: 0.5,
                        fontFamily: MONO,
                        fontSize: 10,
                        color: ATLAS_PALETTE.slate40,
                        fontStyle: 'italic',
                    }}
                >
                    Copilot events.jsonl does not record per-subagent token/cost — list only.
                </Typography>
            )}
        </Box>
    );
}

export default TerminalSessionsCard;
