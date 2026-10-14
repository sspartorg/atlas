import { useLayoutEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE, ELEVATION, LABEL_COLORS } from '../../theme/tokens.js';
import { FormHeading } from '../../components/FormHeading.js';
import { LiveDot } from '../../components/LiveDot.js';
import { useActiveRuns } from '../../hooks/useActiveRuns.js';
import { useThemeModeContext } from '../../hooks/useThemeModeContext.js';
import { CATEGORIES } from './categories.js';
import type { AgentSummary } from '../../api/types.js';

interface IAgentRosterProps {
    agents: AgentSummary[];
    /** Fill the parent's height and show as many agents as fit (desktop sidebar). */
    fill: boolean;
    expanded: boolean;
    onToggleExpanded: () => void;
}

// Collapsed and not filling a column (stacked layouts): a fixed preview.
const STACKED_ROWS = 6;
// Row height until a real row has been measured; a group header (its top
// padding, title and rule) is a fixed 50px.
const ROW_PX = 37;
const HEAD_PX = 50;

/**
 * How many rows of each group to show. Groups are taken in order; each costs
 * its header plus its rows, and a group is only started if at least one of
 * its rows fits.
 */
export function fitRows(
    sizes: number[],
    budgetPx: number,
    maxRows: number,
    rowPx: number,
    headPx: number
): number[] {
    let px = budgetPx;
    let rows = maxRows;
    return sizes.map((size) => {
        const fit = Math.min(size, rows, Math.floor((px - headPx) / rowPx));
        if (fit <= 0) {
            px = 0;
            return 0;
        }
        px -= headPx + fit * rowPx;
        rows -= fit;
        return fit;
    });
}

// Active agents grouped by category, working agents first. "Working" means
// a queued or in-progress run (useActiveRuns, SSE-refreshed).
export function AgentRoster({ agents, fill, expanded, onToggleExpanded }: IAgentRosterProps) {
    const { mode } = useThemeModeContext();
    const { agentIds: busy } = useActiveRuns();
    const listRef = useRef<HTMLElement>(null);
    const [budget, setBudget] = useState({ px: 0, row: ROW_PX });

    // Measure the list's height and a real row, so the column shows exactly
    // as many agents as fit. Runs after every render but only sets state when
    // a number changed, so it settles in one extra pass.
    const measure = () => {
        const el = listRef.current;
        if (!el) return;
        const li = el.querySelector('li');
        const next = {
            px: el.clientHeight,
            row: li ? Math.round(li.getBoundingClientRect().height) : budget.row,
        };
        if (next.px !== budget.px || next.row !== budget.row) setBudget(next);
    };
    useLayoutEffect(() => {
        if (fill && !expanded) measure();
    });
    useLayoutEffect(() => {
        const el = listRef.current;
        if (!fill || expanded || !el) return;
        const ro = new ResizeObserver(() =>
            setBudget((b) => (b.px === el.clientHeight ? b : { ...b, px: el.clientHeight }))
        );
        ro.observe(el);
        return () => ro.disconnect();
    }, [fill, expanded]);

    const active = agents.filter((a) => a.status === 'active');
    const groups = CATEGORIES.map((cat) => ({
        cat,
        agents: active
            .filter((a) => a.category === cat.key)
            .sort(
                (a, b) =>
                    Number(busy.has(b.id)) - Number(busy.has(a.id)) || a.name.localeCompare(b.name)
            ),
    })).filter((g) => g.agents.length > 0);

    const shown = expanded
        ? groups.map((g) => g.agents.length)
        : fitRows(
              groups.map((g) => g.agents.length),
              fill ? budget.px : Infinity,
              fill ? Infinity : STACKED_ROWS,
              budget.row,
              HEAD_PX
          );
    const hidden = active.length - shown.reduce((n, k) => n + k, 0);

    return (
        <Paper
            elevation={0}
            component="section"
            id="agent-roster"
            aria-labelledby="roster-heading"
            sx={{
                bgcolor: 'background.paper',
                borderRadius: '8px',
                boxShadow: ELEVATION.low,
                p: 5,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                // Filling a column: take the column's height, never set it.
                ...(fill && !expanded && { position: 'absolute', inset: 0 }),
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 2,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                    <Box id="roster-heading">
                        <FormHeading>Your agents</FormHeading>
                    </Box>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                        {busy.size > 0 ? `${busy.size} working, ` : ''}
                        {active.length} active
                    </Typography>
                </Box>
                <Link
                    component={RouterLink}
                    to="/agents"
                    underline="hover"
                    sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, py: '6px', my: '-6px' }}
                >
                    Manage agents
                </Link>
            </Box>

            {active.length === 0 ? (
                <Typography sx={{ mt: 4, fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    No active agents.{' '}
                    <Link component={RouterLink} to="/agents/marketplace" underline="hover">
                        Install agents from the Marketplace
                    </Link>
                    .
                </Typography>
            ) : (
                <Box ref={listRef} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    {groups.map((g, gi) => {
                        const count = shown[gi] ?? 0;
                        if (count === 0) return null;
                        const color = LABEL_COLORS[g.cat.color][mode];
                        const working = g.agents.filter((a) => busy.has(a.id)).length;
                        return (
                            <Box key={g.cat.key} sx={{ pt: 5 }}>
                                <Box
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'baseline',
                                        gap: 2,
                                        pb: 2,
                                        borderBottom: `2px solid ${color.border}`,
                                    }}
                                >
                                    <Typography
                                        component="h3"
                                        sx={{
                                            fontSize: 13,
                                            fontWeight: 600,
                                            color: ATLAS_PALETTE.slate,
                                        }}
                                    >
                                        {g.cat.label}
                                    </Typography>
                                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                                        {working > 0
                                            ? `${working} of ${g.agents.length} working`
                                            : `${g.agents.length} idle`}
                                    </Typography>
                                </Box>
                                <Box
                                    component="ul"
                                    sx={{
                                        listStyle: 'none',
                                        m: 0,
                                        p: 0,
                                        ...(expanded && {
                                            display: 'grid',
                                            gridTemplateColumns:
                                                'repeat(auto-fill, minmax(260px, 1fr))',
                                            columnGap: 6,
                                        }),
                                    }}
                                >
                                    {g.agents.slice(0, count).map((agent) => (
                                        <Box component="li" key={agent.id}>
                                            <Link
                                                component={RouterLink}
                                                to={`/agents/${agent.id}`}
                                                underline="none"
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 3,
                                                    py: 2,
                                                    px: 1,
                                                    mx: -1,
                                                    borderRadius: '4px',
                                                    color: ATLAS_PALETTE.slate,
                                                    '&:hover': { bgcolor: ATLAS_PALETTE.slate06 },
                                                }}
                                            >
                                                {busy.has(agent.id) ? (
                                                    <LiveDot
                                                        size={8}
                                                        label="Working"
                                                        animate={false}
                                                    />
                                                ) : (
                                                    <Box
                                                        role="img"
                                                        aria-label="Idle"
                                                        sx={{
                                                            width: 8,
                                                            height: 8,
                                                            flexShrink: 0,
                                                            borderRadius: '50%',
                                                            border: `1.5px solid ${ATLAS_PALETTE.slate30}`,
                                                        }}
                                                    />
                                                )}
                                                <Typography
                                                    component="span"
                                                    noWrap
                                                    sx={{ fontSize: 13, flex: 1, minWidth: 0 }}
                                                >
                                                    {agent.name}
                                                </Typography>
                                                {agent.designation && (
                                                    <Typography
                                                        component="span"
                                                        noWrap
                                                        sx={{
                                                            fontSize: 12,
                                                            color: ATLAS_PALETTE.slate60,
                                                            maxWidth: '45%',
                                                        }}
                                                    >
                                                        {agent.designation}
                                                    </Typography>
                                                )}
                                            </Link>
                                        </Box>
                                    ))}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>
            )}

            {(expanded || hidden > 0) && (
                <Button
                    size="small"
                    variant="text"
                    aria-expanded={expanded}
                    onClick={onToggleExpanded}
                    sx={{
                        mt: 2,
                        alignSelf: 'flex-start',
                        px: 1,
                        fontSize: 12,
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    {expanded ? 'Show fewer' : `Show all ${active.length}`}
                </Button>
            )}
        </Paper>
    );
}
