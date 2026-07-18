import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../theme/tokens.js';
import { formatCostUsd, formatTokenCount } from '../utils/formatCost.js';

// Compact "AI Usage" card used by both the agent-run detail page and the
// terminal-session history page. Renders four rows:
//
//   Cost              $0.1234
//   Context           1.2M    (0K new · 1.2M cached)
//   Output            45K
//   Cache created     0       (or the captured value)
//
// Inputs come from `agent_runs` / `cli_sessions` row columns; both tables
// expose the same shape (`total_cost_usd`, `input_tokens`,
// `output_tokens`, `cache_creation_tokens`, `cache_read_tokens`). The
// panel hides itself entirely when `total_cost_usd` is null — that's the
// "no cost data available" state (copilot interactive sessions, simulated
// runs, runs whose CLI crashed before emitting usage). Caller can also
// short-circuit (e.g. AgentRunDetail also gates on `isSimulatedRun`).

export interface AiUsagePanelProps {
    total_cost_usd: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_creation_tokens: number | null;
    cache_read_tokens: number | null;
}

export function AiUsagePanel({
    total_cost_usd,
    input_tokens,
    output_tokens,
    cache_creation_tokens,
    cache_read_tokens,
}: AiUsagePanelProps) {
    if (total_cost_usd == null) return null;
    const rows: Array<{ label: string; value: string; sub?: string }> = [
        { label: 'Cost', value: formatCostUsd(total_cost_usd) },
        {
            label: 'Context',
            value: formatTokenCount((input_tokens ?? 0) + (cache_read_tokens ?? 0)),
            sub: `${formatTokenCount(input_tokens)} new · ${formatTokenCount(cache_read_tokens)} cached`,
        },
        { label: 'Output', value: formatTokenCount(output_tokens) },
        { label: 'Cache created', value: formatTokenCount(cache_creation_tokens) },
    ];
    return (
        <Box
            sx={{
                mt: 2,
                p: 2,
                background: ATLAS_PALETTE.slate06,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '8px',
            }}
        >
            <Typography
                sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: ATLAS_PALETTE.slate60,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    mb: 1.5,
                }}
            >
                AI Usage
            </Typography>
            {rows.map(({ label, value, sub }) => (
                <Box
                    key={label}
                    sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}
                >
                    <Typography
                        sx={{ fontSize: 11, color: ATLAS_PALETTE.slate40, minWidth: 90 }}
                    >
                        {label}
                    </Typography>
                    <Typography
                        sx={{
                            fontSize: 13,
                            fontWeight: 600,
                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                            color: ATLAS_PALETTE.slate,
                        }}
                    >
                        {value}
                    </Typography>
                    {sub && (
                        <Typography
                            sx={{
                                fontSize: 11,
                                color: ATLAS_PALETTE.slate40,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                            }}
                        >
                            ({sub})
                        </Typography>
                    )}
                </Box>
            ))}
        </Box>
    );
}
