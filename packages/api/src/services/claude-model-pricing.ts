// Anthropic Claude model pricing — USD per 1 million tokens.
//
// Source of truth: LiteLLM's `model_prices_and_context_window.json`
// (https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json),
// snapshot 2026-06-30. Same upstream that powers `ccusage` and other
// status-line tools — so the cost numbers atlas's terminal-history page
// shows agree (modulo rounding) with whatever the user's status line
// displays during a live session.
//
// Cache write splits: Anthropic bills "ephemeral 1h" cache writes at a
// higher rate than "ephemeral 5m" writes. The PTY JSONL exposes both
// counts in `message.usage.cache_creation.{ephemeral_5m,ephemeral_1h}_
// input_tokens`, so we keep separate `cache_write_5m` / `cache_write_1h`
// fields. Older snapshots without the split bill at the 5m rate.
//
// When Anthropic ships new model IDs, add an entry below and a matching
// `claude-model-pricing.test.ts` row. The `lookupClaudePrices` helper
// resolves dated suffix variants (`claude-haiku-4-5-20251001` ->
// `claude-haiku-4-5`) so the table doesn't need both forms for every
// release.

export interface ClaudeModelPrices {
    /** USD per 1M input tokens (uncached prompt). */
    input: number;
    /** USD per 1M output tokens (model response). */
    output: number;
    /** USD per 1M ephemeral-5m cache writes. */
    cache_write_5m: number;
    /** USD per 1M ephemeral-1h cache writes. */
    cache_write_1h: number;
    /** USD per 1M cache reads (any tier). */
    cache_read: number;
}

export const CLAUDE_MODEL_PRICING: Record<string, ClaudeModelPrices> = {
    // Opus 4 family. 4-1 is the original $15/$75 tier; 4-5 onward dropped
    // to the $5/$25 tier.
    'claude-opus-4': { input: 15.0, output: 75.0, cache_write_5m: 18.75, cache_write_1h: 30.0, cache_read: 1.5 },
    'claude-opus-4-1': { input: 15.0, output: 75.0, cache_write_5m: 18.75, cache_write_1h: 30.0, cache_read: 1.5 },
    'claude-opus-4-5': { input: 5.0, output: 25.0, cache_write_5m: 6.25, cache_write_1h: 10.0, cache_read: 0.5 },
    'claude-opus-4-6': { input: 5.0, output: 25.0, cache_write_5m: 6.25, cache_write_1h: 10.0, cache_read: 0.5 },
    'claude-opus-4-7': { input: 5.0, output: 25.0, cache_write_5m: 6.25, cache_write_1h: 10.0, cache_read: 0.5 },
    'claude-opus-4-8': { input: 5.0, output: 25.0, cache_write_5m: 6.25, cache_write_1h: 10.0, cache_read: 0.5 },
    // Sonnet 4 family.
    'claude-sonnet-4': { input: 3.0, output: 15.0, cache_write_5m: 3.75, cache_write_1h: 6.0, cache_read: 0.3 },
    'claude-sonnet-4-5': { input: 3.0, output: 15.0, cache_write_5m: 3.75, cache_write_1h: 6.0, cache_read: 0.3 },
    'claude-sonnet-4-6': { input: 3.0, output: 15.0, cache_write_5m: 3.75, cache_write_1h: 6.0, cache_read: 0.3 },
    // Haiku 4 family.
    'claude-haiku-4-5': { input: 1.0, output: 5.0, cache_write_5m: 1.25, cache_write_1h: 2.0, cache_read: 0.1 },
    // Fable 5 — Anthropic's experimental release, priced between sonnet
    // and opus tiers.
    'claude-fable-5': { input: 10.0, output: 50.0, cache_write_5m: 12.5, cache_write_1h: 20.0, cache_read: 1.0 },
    // Pre-4 fallbacks (sonnet 3.7 + opus 3 + haiku 3) — atlas's terminals
    // shouldn't see these in practice but the lookup helper falls back to
    // them rather than returning null when the model id starts with one
    // of these prefixes (see `lookupClaudePrices`).
    'claude-3-7-sonnet': { input: 3.0, output: 15.0, cache_write_5m: 3.75, cache_write_1h: 6.0, cache_read: 0.3 },
    'claude-3-5-sonnet': { input: 3.0, output: 15.0, cache_write_5m: 3.75, cache_write_1h: 6.0, cache_read: 0.3 },
    'claude-3-5-haiku': { input: 0.8, output: 4.0, cache_write_5m: 1.0, cache_write_1h: 1.6, cache_read: 0.08 },
    'claude-3-opus': { input: 15.0, output: 75.0, cache_write_5m: 18.75, cache_write_1h: 30.0, cache_read: 1.5 },
    'claude-3-haiku': { input: 0.25, output: 1.25, cache_write_5m: 0.3, cache_write_1h: 0.48, cache_read: 0.03 },
};

/**
 * Anthropic appends a release-date suffix to many model ids
 * (`claude-haiku-4-5-20251001`, `claude-opus-4-7-20260416`). Strip the
 * trailing date so the lookup hits the base entry. Format: `-` followed
 * by exactly 8 digits. Defensive: if the suffix isn't a date, leave the
 * id alone (Anthropic occasionally ships -beta, -preview, -latest).
 */
function stripDateSuffix(modelId: string): string {
    return modelId.replace(/-\d{8}$/, '');
}

/**
 * Look up pricing for a Claude model id. Returns the exact entry first
 * (so `claude-haiku-4-5-20251001` hits a direct match if the table has
 * it), then falls back to the date-stripped id, then to a prefix scan
 * over the table for old / unanticipated suffixes (`-latest`, `-beta`).
 * Returns null only when no prefix matches — caller should treat that as
 * "unknown model, skip cost calculation" rather than zero-cost.
 */
export function lookupClaudePrices(modelId: string): ClaudeModelPrices | null {
    if (!modelId) return null;
    const exact = CLAUDE_MODEL_PRICING[modelId];
    if (exact) return exact;
    const stripped = stripDateSuffix(modelId);
    if (stripped !== modelId) {
        const byStripped = CLAUDE_MODEL_PRICING[stripped];
        if (byStripped) return byStripped;
    }
    // Prefix scan — pick the LONGEST matching table key so
    // `claude-opus-4-1-rc1` resolves to `claude-opus-4-1` and not the
    // shorter `claude-opus-4`.
    let bestKey: string | null = null;
    for (const key of Object.keys(CLAUDE_MODEL_PRICING)) {
        if (modelId.startsWith(key) && (bestKey === null || key.length > bestKey.length)) {
            bestKey = key;
        }
    }
    return bestKey ? (CLAUDE_MODEL_PRICING[bestKey] ?? null) : null;
}
