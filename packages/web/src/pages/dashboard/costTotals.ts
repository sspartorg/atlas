import type { CostSummary, TerminalCostSummary } from '../../api/types.js';

export interface ICostTotals {
    usd: number;
    runs: number;
    tokens: number;
}

// Month-to-date spend across agent runs and terminal sessions. Null when the
// API sent neither summary (no activity yet / older API).
export function costTotals(
    runs: CostSummary | undefined,
    terminal: TerminalCostSummary | undefined
): ICostTotals | null {
    if (!runs && !terminal) return null;
    return {
        usd: (runs?.total_cost_usd ?? 0) + (terminal?.total_cost_usd ?? 0),
        runs: runs?.run_count ?? 0,
        tokens:
            (runs?.input_tokens ?? 0) +
            (runs?.output_tokens ?? 0) +
            (runs?.cache_read_tokens ?? 0) +
            (terminal?.input_tokens ?? 0) +
            (terminal?.output_tokens ?? 0) +
            (terminal?.cache_read_tokens ?? 0),
    };
}
