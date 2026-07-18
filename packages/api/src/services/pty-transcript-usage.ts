import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CostFields } from './claude-cost-parser.js';
import { lookupClaudePrices, type ClaudeModelPrices } from './claude-model-pricing.js';

// Compute token + USD cost from a Claude Code PTY-mode JSONL transcript.
//
// PTY mode does NOT emit a final `type:"result"` envelope the way
// `claude -p --output-format stream-json` does (that's what
// `claude-cost-parser.ts` reads for agent runs). Instead, every
// `{"type":"assistant", "message":{...}}` line in the JSONL carries a
// per-turn `usage` block. Sum those blocks across the session and apply
// the per-model pricing table.
//
// This is the same algorithm the user's status line tool (e.g.
// `ccusage`) runs against the same JSONL files, so the numbers atlas's
// terminal-history page surfaces agree with what the live status line
// displayed during the session.
//
// Cache writes have two tiers in Anthropic's billing — ephemeral 5m and
// ephemeral 1h — and the JSONL exposes both counts in
// `message.usage.cache_creation.{ephemeral_5m_input_tokens,
// ephemeral_1h_input_tokens}`. We track them separately, apply the
// per-tier rates, and combine for the final USD cost. The single
// `cache_creation_tokens` column we persist is the SUM of both tiers
// (matching the `agent_runs` column semantics).

interface UsageBlock {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
    };
}

interface PerModelTotals {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite5m: number;
    cacheWrite1h: number;
}

function emptyTotals(): PerModelTotals {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
}

function addUsage(totals: PerModelTotals, usage: UsageBlock): void {
    if (typeof usage.input_tokens === 'number') totals.input += usage.input_tokens;
    if (typeof usage.output_tokens === 'number') totals.output += usage.output_tokens;
    if (typeof usage.cache_read_input_tokens === 'number') totals.cacheRead += usage.cache_read_input_tokens;
    // Prefer the split (ephemeral_5m + ephemeral_1h) when present so
    // we bill the 1h tier at its higher rate. Older clients only emit
    // the rolled-up `cache_creation_input_tokens` — fall back to that
    // and bill the entire amount at the 5m rate (closest approximation;
    // overestimates cost for any 1h portion the older client created).
    const split = usage.cache_creation;
    const has5m = split && typeof split.ephemeral_5m_input_tokens === 'number';
    const has1h = split && typeof split.ephemeral_1h_input_tokens === 'number';
    if (has5m || has1h) {
        if (has5m) totals.cacheWrite5m += split!.ephemeral_5m_input_tokens!;
        if (has1h) totals.cacheWrite1h += split!.ephemeral_1h_input_tokens!;
    } else if (typeof usage.cache_creation_input_tokens === 'number') {
        totals.cacheWrite5m += usage.cache_creation_input_tokens;
    }
}

function costFor(totals: PerModelTotals, prices: ClaudeModelPrices): number {
    return (
        (totals.input * prices.input +
            totals.output * prices.output +
            totals.cacheRead * prices.cache_read +
            totals.cacheWrite5m * prices.cache_write_5m +
            totals.cacheWrite1h * prices.cache_write_1h) /
        1_000_000
    );
}

interface SumResult {
    fields: CostFields;
    assistantEventCount: number;
    // ISO timestamps for the first + last assistant event that contributed —
    // subagent rows record these so the UI can render a lifetime. Parent
    // sessions ignore them (`cli_sessions` already tracks its own lifecycle
    // timestamps via `created_at` / `closed_at`).
    firstEventAt: string | null;
    lastEventAt: string | null;
}

// Shared helper — walk the JSONL, sum per-model usage, apply pricing.
// Broken out of `parseClaudePtyUsage` so `parseClaudeSubagentUsage` can
// call the same algorithm without duplicating the dedup + tiered
// cache-write logic. Returns null when the transcript contributes zero
// assistant events (caller decides what to persist).
function sumClaudeJsonl(jsonl: string, fallbackModel: string): SumResult | null {
    if (!jsonl) return null;
    const perModel = new Map<string, PerModelTotals>();
    // Dedup by Anthropic's API message id (`message.id`, e.g.
    // `msg_01LPWyhfaL55wSB1CGduAAcT`). Claude Code's PTY mode writes
    // each assistant message TWICE in the on-disk JSONL — once at
    // streaming-start, once at streaming-end — and BOTH writes carry
    // the SAME `usage` block. Without dedup, summing them produces
    // exactly 2x the real cost (verified empirically: a user observed
    // $0.03 in the status line then $0.06 in atlas's card). `ccusage`
    // and other status-line tools dedup the same way.
    const seenMessageIds = new Set<string>();
    let assistantEventCount = 0;
    let firstEventAt: string | null = null;
    let lastEventAt: string | null = null;
    for (const rawLine of jsonl.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('{')) continue;
        let obj: Record<string, unknown>;
        try {
            obj = JSON.parse(line) as Record<string, unknown>;
        } catch {
            continue;
        }
        if (obj['type'] !== 'assistant') continue;
        const message = obj['message'] as
            | { id?: unknown; model?: unknown; usage?: UsageBlock }
            | undefined;
        if (!message || !message.usage) continue;
        // Drop duplicates. Defensive: events without a `message.id`
        // (shouldn't occur in real Anthropic output) fall through and
        // contribute — better to over-count a corner case than to
        // silently lose legitimate usage.
        const msgId = typeof message.id === 'string' && message.id.length > 0
            ? message.id
            : null;
        if (msgId) {
            if (seenMessageIds.has(msgId)) continue;
            seenMessageIds.add(msgId);
        }
        assistantEventCount += 1;
        const timestamp = typeof obj['timestamp'] === 'string' ? (obj['timestamp'] as string) : null;
        if (timestamp) {
            if (!firstEventAt) firstEventAt = timestamp;
            lastEventAt = timestamp;
        }
        const model =
            typeof message.model === 'string' && message.model.length > 0
                ? message.model
                : fallbackModel;
        let totals = perModel.get(model);
        if (!totals) {
            totals = emptyTotals();
            perModel.set(model, totals);
        }
        addUsage(totals, message.usage);
    }
    if (assistantEventCount === 0) return null;

    let grandInput = 0;
    let grandOutput = 0;
    let grandCacheRead = 0;
    let grandCacheWrite = 0;
    let grandCostUsd = 0;
    let pricedAtLeastOneModel = false;
    for (const totals of perModel.values()) {
        grandInput += totals.input;
        grandOutput += totals.output;
        grandCacheRead += totals.cacheRead;
        grandCacheWrite += totals.cacheWrite5m + totals.cacheWrite1h;
    }
    for (const [model, totals] of perModel.entries()) {
        const prices = lookupClaudePrices(model);
        if (prices) {
            grandCostUsd += costFor(totals, prices);
            pricedAtLeastOneModel = true;
        }
        // Unknown model -> token totals still accumulate (so the UI
        // shows real context/output counts) but no cost contribution
        // for that turn. Caller can spot the discrepancy by comparing
        // total_cost_usd against the token magnitude.
    }
    return {
        fields: {
            total_cost_usd: pricedAtLeastOneModel ? Number(grandCostUsd.toFixed(6)) : null,
            input_tokens: grandInput,
            output_tokens: grandOutput,
            cache_creation_tokens: grandCacheWrite,
            cache_read_tokens: grandCacheRead,
            credits: null,
        },
        assistantEventCount,
        firstEventAt,
        lastEventAt,
    };
}

/**
 * Sum per-event usage across a Claude PTY JSONL transcript and compute
 * total USD cost via the pricing table.
 *
 * Sessions can use different models across turns (rare but possible —
 * e.g. user switches mid-session); we track per-model totals and sum
 * the per-model costs at the end so each turn bills at its own rate.
 *
 * Returns null when no assistant events were parseable — caller leaves
 * the cost columns null in that case rather than persisting zero
 * (zero would falsely imply "we computed cost and got nothing").
 *
 * `fallbackModel` is used when an assistant event omits
 * `message.model` (defensive — every real event observed in production
 * has it, but the JSONL spec doesn't strictly require it).
 */
export function parseClaudePtyUsage(
    jsonl: string,
    fallbackModel: string,
): CostFields | null {
    const result = sumClaudeJsonl(jsonl, fallbackModel);
    return result ? result.fields : null;
}

interface SubagentMeta {
    agentType?: unknown;
    description?: unknown;
    spawnDepth?: unknown;
    toolUseId?: unknown;
}

export interface ClaudeSubagentUsage {
    /** Filename stem, e.g. `agent-a45055be156df0831`. Stable key per session. */
    subagentKey: string;
    /** From `<key>.meta.json`. `Plan`, `Explore`, `general-purpose`, etc. */
    agentType: string | null;
    /** From `<key>.meta.json`. One-liner the caller passed to the Agent tool. */
    description: string | null;
    spawnDepth: number | null;
    tokens: CostFields;
    startedAt: string | null;
    endedAt: string | null;
}

/**
 * Discover every subagent JSONL under a parent Claude session's on-disk
 * dir and sum each one independently.
 *
 * A Claude Code session that invoked the `Agent` tool at least once
 * creates:
 *   ~/.claude/projects/<encoded-cwd>/<parentSessionId>/subagents/
 *       agent-<id>.jsonl        <- per-turn events, each with usage
 *       agent-<id>.meta.json    <- { agentType, description, spawnDepth,
 *                                    toolUseId }
 *
 * Returns [] when the `subagents/` dir is missing (session never
 * spawned one) or unreadable. Individual JSONLs that parse to zero
 * events are silently skipped.
 */
export async function parseClaudeSubagentUsage(
    parentSessionDir: string,
    fallbackModel: string,
): Promise<ClaudeSubagentUsage[]> {
    const subagentsDir = path.join(parentSessionDir, 'subagents');
    let entries: string[];
    try {
        entries = await fs.readdir(subagentsDir);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return [];
        // eslint-disable-next-line no-console
        console.warn(
            `[pty-transcript-usage] subagents dir read failed for ${parentSessionDir}: ${(err as Error).message}`,
        );
        return [];
    }
    const jsonlFiles = entries.filter((n) => n.endsWith('.jsonl'));
    const out: ClaudeSubagentUsage[] = [];
    for (const filename of jsonlFiles) {
        const key = filename.replace(/\.jsonl$/, '');
        const jsonlPath = path.join(subagentsDir, filename);
        const metaPath = path.join(subagentsDir, `${key}.meta.json`);

        let jsonl: string;
        try {
            jsonl = await fs.readFile(jsonlPath, 'utf8');
        } catch {
            continue;
        }
        const summed = sumClaudeJsonl(jsonl, fallbackModel);
        if (!summed) continue;

        let meta: SubagentMeta | null = null;
        try {
            const metaContent = await fs.readFile(metaPath, 'utf8');
            meta = JSON.parse(metaContent) as SubagentMeta;
        } catch {
            // Missing meta is fine — the JSONL still yields cost data.
            meta = null;
        }
        out.push({
            subagentKey: key,
            agentType: typeof meta?.agentType === 'string' ? meta.agentType : null,
            description: typeof meta?.description === 'string' ? meta.description : null,
            // 2026-07-03 audit round 3: guard against non-integer numbers.
            // A malformed <agent>.meta.json with `spawnDepth: 1.5` (or any
            // finite float) passes `typeof === 'number'` and then blows
            // up the whole subagent batch INSERT because the DB column is
            // `integer`. Every ingest error is swallowed with a warn, so
            // the entire subagent breakdown for that session would be
            // silently lost. `Number.isInteger` rejects non-finite AND
            // non-integer values in one check.
            spawnDepth: Number.isInteger(meta?.spawnDepth)
                ? (meta as { spawnDepth: number }).spawnDepth
                : null,
            tokens: summed.fields,
            startedAt: summed.firstEventAt,
            endedAt: summed.lastEventAt,
        });
    }
    return out;
}
