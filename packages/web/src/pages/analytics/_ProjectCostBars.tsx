import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { formatCostUsd } from '../../utils/formatCost.js';
import { Card, ChartEmpty, ChartTitle, CHART_COLORS, MONO } from './_chrome.js';

interface ProjectRow {
    project_id: string | null;
    project_name: string;
    total_cost_usd: number;
    run_count: number;
}

interface TerminalProjectRow {
    project_id: string | null;
    // Null for standalone sessions — they have no project to left-join to,
    // and are surfaced here as their own "Standalone" bar so their spend
    // isn't silently missing from the cost breakdown.
    project_name: string | null;
    total_cost_usd: number;
    session_count: number;
}

interface Combined {
    project_id: string | null;
    project_name: string;
    agent_cost: number;
    terminal_cost: number;
    run_count: number;
    session_count: number;
    total_cost: number;
}

// Merge the agent-runs `byProject` and the terminal-sessions
// `terminalByProject` arrays on `project_id`. A project can appear in
// either or both — surface anything with non-zero combined spend, sorted
// by combined spend descending so the visual order matches the bar
// widths.
function mergeByProject(
    byProject: ProjectRow[],
    terminalByProject: TerminalProjectRow[],
): Combined[] {
    const m = new Map<string, Combined>();
    for (const p of byProject) {
        const key = p.project_id ?? `__name:${p.project_name}`;
        m.set(key, {
            project_id: p.project_id,
            project_name: p.project_name,
            agent_cost: p.total_cost_usd,
            terminal_cost: 0,
            run_count: p.run_count,
            session_count: 0,
            total_cost: p.total_cost_usd,
        });
    }
    for (const t of terminalByProject) {
        const name = t.project_name ?? 'Standalone';
        const key = t.project_id ?? `__name:${name}`;
        const existing = m.get(key);
        if (existing) {
            existing.terminal_cost = t.total_cost_usd;
            existing.session_count = t.session_count;
            existing.total_cost = existing.agent_cost + t.total_cost_usd;
        } else {
            m.set(key, {
                project_id: t.project_id,
                project_name: name,
                agent_cost: 0,
                terminal_cost: t.total_cost_usd,
                run_count: 0,
                session_count: t.session_count,
                total_cost: t.total_cost_usd,
            });
        }
    }
    return Array.from(m.values())
        .filter((r) => r.total_cost > 0)
        .sort((a, b) => b.total_cost - a.total_cost);
}

export function ProjectCostBars({
    byProject,
    terminalByProject,
    topProjectMax,
}: {
    byProject: ProjectRow[];
    terminalByProject: TerminalProjectRow[];
    topProjectMax: number;
}) {
    const rows = mergeByProject(byProject, terminalByProject);
    // Recompute the normaliser against the COMBINED total so terminal
    // contribution doesn't make any bar overflow. Falls back to the
    // page-level `topProjectMax` if every row is zero (defensive).
    const maxCombined = rows.length > 0 ? Math.max(...rows.map((r) => r.total_cost)) : topProjectMax;
    if (rows.length === 0) {
        return (
            <Card>
                <ChartTitle
                    eyebrow="Spend by project"
                    title="Cost per project — this month"
                    sub="Per-project split of agentic and terminal spend, normalised against the largest spender."
                />
                <ChartEmpty
                    label="No project spend this month"
                    sub="Runs and terminal sessions get attributed back to a project at completion — once one closes, it lands here."
                />
            </Card>
        );
    }
    return (
        <Card>
            <ChartTitle
                eyebrow="Spend by project"
                title="Cost per project — this month"
                sub={`${rows.length} project${rows.length === 1 ? '' : 's'} touched. Each bar splits agentic spend (blue) from manual terminal spend (orange); width is normalised against the largest combined spender.`}
            />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {rows.map((p) => {
                    const agentPct = maxCombined > 0 ? (p.agent_cost / maxCombined) * 100 : 0;
                    const terminalPct = maxCombined > 0 ? (p.terminal_cost / maxCombined) * 100 : 0;
                    const isClickable = Boolean(p.project_id);
                    return (
                        <Box
                            key={p.project_id ?? p.project_name}
                            {...(isClickable
                                ? {
                                      component: RouterLink,
                                      to: `/analytics/project/${p.project_id ?? ''}`,
                                  }
                                : {})}
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: {
                                    xs: 'minmax(0, 1fr) auto',
                                    sm: '160px 1fr 110px 110px',
                                },
                                gridTemplateAreas: {
                                    xs: `"name cost" "bar bar" "runs runs"`,
                                    sm: 'unset',
                                },
                                alignItems: 'center',
                                columnGap: { xs: 1.5, sm: 3 },
                                rowGap: { xs: 0.5, sm: 0 },
                                py: 1.5,
                                px: 2,
                                borderRadius: '10px',
                                border: `1px solid transparent`,
                                textDecoration: 'none',
                                color: 'inherit',
                                cursor: isClickable ? 'pointer' : 'default',
                                transition: 'background 160ms ease, border-color 160ms ease',
                                '&:hover': {
                                    background: ATLAS_PALETTE.cloud,
                                    borderColor: isClickable ? 'rgba(0,122,201,.18)' : 'transparent',
                                },
                            }}
                        >
                            <Typography
                                sx={{
                                    gridArea: { xs: 'name', sm: 'auto' },
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    minWidth: 0,
                                }}
                                title={p.project_name}
                            >
                                {p.project_name}
                            </Typography>
                            <Box
                                sx={{
                                    gridArea: { xs: 'bar', sm: 'auto' },
                                    position: 'relative',
                                    height: 10,
                                    borderRadius: '999px',
                                    background: 'rgba(127,127,127,.10)',
                                    overflow: 'hidden',
                                    display: 'flex',
                                }}
                            >
                                {p.agent_cost > 0 && (
                                    <Box
                                        sx={{
                                            height: '100%',
                                            width: `${Math.max(2, agentPct)}%`,
                                            background: CHART_COLORS.cost,
                                            animation: 'atlas-anal-fade 700ms cubic-bezier(.18,.7,.2,1) both',
                                        }}
                                        title={`Agentic ${formatCostUsd(p.agent_cost)}`}
                                    />
                                )}
                                {p.terminal_cost > 0 && (
                                    <Box
                                        sx={{
                                            height: '100%',
                                            width: `${Math.max(2, terminalPct)}%`,
                                            background: CHART_COLORS.terminal,
                                            animation: 'atlas-anal-fade 700ms cubic-bezier(.18,.7,.2,1) both',
                                        }}
                                        title={`Terminal ${formatCostUsd(p.terminal_cost)}`}
                                    />
                                )}
                            </Box>
                            <Typography
                                sx={{
                                    gridArea: { xs: 'cost', sm: 'auto' },
                                    fontFamily: MONO,
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: ATLAS_PALETTE.slate,
                                    textAlign: 'right',
                                    fontVariantNumeric: 'tabular-nums',
                                }}
                            >
                                {formatCostUsd(p.total_cost)}
                            </Typography>
                            <Typography
                                sx={{
                                    gridArea: { xs: 'runs', sm: 'auto' },
                                    fontFamily: MONO,
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                    textAlign: 'right',
                                }}
                            >
                                {p.run_count} run{p.run_count === 1 ? '' : 's'}
                                {p.session_count > 0 && (
                                    <>
                                        {' '}· {p.session_count} term
                                    </>
                                )}
                            </Typography>
                        </Box>
                    );
                })}
            </Box>
        </Card>
    );
}

export default ProjectCostBars;
