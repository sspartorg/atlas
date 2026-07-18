import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { formatCostUsd, formatTokenCount } from '../../utils/formatCost.js';
import { formatAbsolute } from '../../utils/time.js';
import { Card, ChartEmpty, ChartTitle, CHART_COLORS, MONO } from './_chrome.js';

interface TopRun {
    run_id: string;
    agent_id: string;
    agent_name: string;
    issue_id: string | null;
    issue_type: string;
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    created_at: string;
}

export function TopRunsTable({
    topRuns,
    topRunsMaxCost,
}: {
    topRuns: TopRun[];
    topRunsMaxCost: number;
}) {
    const grid = '36px 1fr 120px 90px 90px 90px 110px';
    if (topRuns.length === 0) {
        return (
            <Card>
                <ChartTitle
                    eyebrow="Most expensive runs"
                    title="Top runs by cost"
                    sub="Top 10 completed runs this month ranked by spend."
                />
                <ChartEmpty
                    label="No completed runs this month"
                    sub="Top runs are picked from agents whose runs completed within the current month."
                />
            </Card>
        );
    }
    return (
        <Card>
            <ChartTitle
                eyebrow="Most expensive runs"
                title="Top runs by cost"
                sub={`Top ${topRuns.length} run${topRuns.length === 1 ? '' : 's'} ranked by spend this month · click an agent to open the run.`}
            />
            <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 700 }}>
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: grid,
                            gap: 2,
                            pb: 1.5,
                            mb: 1,
                            borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                        }}
                    >
                        {['#', 'Agent / Item', 'Cost', 'Input', 'Output', 'Cached', 'Time'].map((h) => (
                            <Typography
                                key={h}
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 10.5,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate60,
                                    letterSpacing: '0.14em',
                                    textTransform: 'uppercase',
                                }}
                            >
                                {h}
                            </Typography>
                        ))}
                    </Box>
                    {topRuns.map((run, idx) => {
                        const intensity = topRunsMaxCost > 0 ? run.total_cost_usd / topRunsMaxCost : 0;
                        const rank = idx + 1;
                        const isPodium = rank <= 3;
                        return (
                            <Box
                                key={run.run_id}
                                sx={{
                                    position: 'relative',
                                    display: 'grid',
                                    gridTemplateColumns: grid,
                                    gap: 2,
                                    py: 1.5,
                                    borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                                    '&:last-of-type': { borderBottom: 'none' },
                                    '&::before': {
                                        content: '""',
                                        position: 'absolute',
                                        left: 0,
                                        right: 0,
                                        bottom: 0,
                                        height: 2,
                                        background: `linear-gradient(90deg, ${CHART_COLORS.cost} 0%, ${CHART_COLORS.output} 100%)`,
                                        transform: `scaleX(${intensity})`,
                                        transformOrigin: 'left center',
                                        opacity: 0.18,
                                        transition: 'opacity 200ms ease',
                                    },
                                    '&:hover': {
                                        background: ATLAS_PALETTE.cloud,
                                        '&::before': { opacity: 0.5 },
                                    },
                                    transition: 'background 120ms ease',
                                }}
                            >
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 12.5,
                                        fontWeight: 700,
                                        color: isPodium ? CHART_COLORS.cost : ATLAS_PALETTE.slate40,
                                        letterSpacing: '0.05em',
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {String(rank).padStart(2, '0')}
                                </Typography>
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography
                                        component={RouterLink}
                                        to={`/agents/${run.agent_id}/runs/${run.run_id}`}
                                        sx={{
                                            fontSize: 13,
                                            fontWeight: 600,
                                            color: CHART_COLORS.cost,
                                            textDecoration: 'none',
                                            '&:hover': { textDecoration: 'underline' },
                                            display: 'block',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {run.agent_name}
                                    </Typography>
                                    {run.issue_id && (
                                        <Typography
                                            sx={{
                                                fontSize: 11,
                                                color: ATLAS_PALETTE.slate40,
                                                fontFamily: MONO,
                                                mt: 0.25,
                                            }}
                                        >
                                            {run.issue_type} · {run.issue_id}
                                        </Typography>
                                    )}
                                </Box>
                                <Typography
                                    sx={{
                                        fontSize: 13,
                                        fontFamily: MONO,
                                        color: ATLAS_PALETTE.slate,
                                        fontWeight: 700,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {formatCostUsd(run.total_cost_usd)}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontSize: 12,
                                        fontFamily: MONO,
                                        color: ATLAS_PALETTE.slate60,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {formatTokenCount(run.input_tokens)}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontSize: 12,
                                        fontFamily: MONO,
                                        color: ATLAS_PALETTE.slate60,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {formatTokenCount(run.output_tokens)}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontSize: 12,
                                        fontFamily: MONO,
                                        color: ATLAS_PALETTE.slate60,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {formatTokenCount(run.cache_read_tokens)}
                                </Typography>
                                <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate40, fontFamily: MONO }}>
                                    {formatAbsolute(run.created_at)}
                                </Typography>
                            </Box>
                        );
                    })}
                </Box>
            </Box>
        </Card>
    );
}

export default TopRunsTable;
