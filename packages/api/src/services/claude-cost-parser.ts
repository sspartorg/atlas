// Pure JSONL-line parser for Claude Code stream-json `result` events.
// Lives here because `agent-runner.ts` runs `claude -p --output-format
// stream-json` for autonomous runs, and that mode DOES emit `result`
// events with `total_cost_usd` + `usage` populated. Agent-runner re-exports
// `parseClaudeCostFromOutput` for back-compat with `parse-cost.test.ts`
// and other internal callers.
//
// Terminal-v2 interactive sessions do NOT use this parser. Their JSONL
// transcript has no `type:"result"` events and the per-message records
// carry token usage without any USD cost; we don't try to surface that
// (see the migration `014_cli_sessions_drop_cost_columns.ts` rationale).

export interface CostFields {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_creation_tokens: number | null;
    cache_read_tokens: number | null;
    total_cost_usd: number | null;
    credits: number | null;
}

// Scans an NDJSON-flavoured string backward for the Claude CLI's final
// `result` event and extracts token counts + cost. Returns null when the
// input contains no parseable result event (simulated runs, CLI crashes
// before the result line, plain-text output, etc.).
export function parseClaudeCostFromOutput(output: string): CostFields | null {
    const lines = output.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = (lines[i] ?? '').trim();
        if (!line.startsWith('{')) continue;
        try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            if (obj['type'] !== 'result') continue;
            const costUsd = typeof obj['total_cost_usd'] === 'number' ? obj['total_cost_usd'] : null;
            const usage = obj['usage'] as Record<string, unknown> | undefined;
            if (costUsd === null && !usage) continue;
            return {
                total_cost_usd: costUsd,
                input_tokens: typeof usage?.['input_tokens'] === 'number' ? (usage['input_tokens'] as number) : null,
                output_tokens: typeof usage?.['output_tokens'] === 'number' ? (usage['output_tokens'] as number) : null,
                cache_creation_tokens: typeof usage?.['cache_creation_input_tokens'] === 'number' ? (usage['cache_creation_input_tokens'] as number) : null,
                cache_read_tokens: typeof usage?.['cache_read_input_tokens'] === 'number' ? (usage['cache_read_input_tokens'] as number) : null,
                credits: null,
            };
        } catch {
            /* keep searching */
        }
    }
    return null;
}
