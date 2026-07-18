import type { CostFields } from './claude-cost-parser.js';

// Compute token + USD cost from a Copilot CLI PTY-mode events.jsonl.
//
// Copilot writes a `{"type":"session.shutdown","data":{...}}` event at
// the end of every session. That event carries all the session-level
// aggregates the user's status line displays — sourced from the same
// in-memory state Copilot pipes via stdin to the statusLine command:
//
//   - `totalNanoAiu`            -> total billable usage in nano-AIU
//   - `tokenDetails.input/output/cache_read.tokenCount`
//   - `modelMetrics[*].usage.{inputTokens, outputTokens, cacheReadTokens,
//      cacheWriteTokens}` — per-model breakdown
//
// Cost formula (matches the recipe in the user's
// `~/.copilot/status.py:8` exactly):
//
//   dollars = (totalNanoAiu / 1e9) * AIU_RATE_USD
//   AIU_RATE_USD = 0.04   // Copilot premium-request rate
//
// `totalPremiumRequests` is intentionally NOT used — user confirmed it
// carries a known upstream bug. `totalNanoAiu` is the authoritative
// number (same source the SQL-based status-line variant queries from
// `data.db.sessions.total_nano_aiu`).
//
// Returns null when no `session.shutdown` event is present (session
// still live, copilot crashed before emitting, file truncated). Caller
// leaves cost columns null rather than persisting zero.

const AIU_RATE_USD = 0.04;

interface CopilotShutdownData {
    totalNanoAiu?: unknown;
    tokenDetails?: {
        input?: { tokenCount?: unknown };
        output?: { tokenCount?: unknown };
        cache_read?: { tokenCount?: unknown };
    };
    modelMetrics?: Record<
        string,
        { usage?: { cacheWriteTokens?: unknown } }
    >;
}

function numOrNull(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function parseCopilotEventsUsage(jsonl: string): CostFields | null {
    if (!jsonl) return null;
    // Walk forward; remember the LAST `session.shutdown` we see. There
    // should only ever be one, but if copilot ever writes multiple
    // (defensive), the final one carries the most up-to-date totals.
    let shutdown: CopilotShutdownData | null = null;
    for (const rawLine of jsonl.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('{')) continue;
        let obj: Record<string, unknown>;
        try {
            obj = JSON.parse(line) as Record<string, unknown>;
        } catch {
            continue;
        }
        if (obj['type'] !== 'session.shutdown') continue;
        const data = obj['data'];
        if (data && typeof data === 'object') {
            shutdown = data as CopilotShutdownData;
        }
    }
    if (!shutdown) return null;

    const td = shutdown.tokenDetails ?? {};
    const input = numOrNull(td.input?.tokenCount);
    const output = numOrNull(td.output?.tokenCount);
    const cacheRead = numOrNull(td.cache_read?.tokenCount);

    // Cache writes — only available via per-model metrics, summed
    // across all models that contributed. If no model exposes the
    // field, leave the column null (vs. 0) to distinguish "we don't
    // know" from "we know it's zero".
    let cacheWrite = 0;
    let cacheWriteSeen = false;
    const mm = shutdown.modelMetrics ?? {};
    for (const entry of Object.values(mm)) {
        const cw = entry?.usage?.cacheWriteTokens;
        if (typeof cw === 'number' && Number.isFinite(cw)) {
            cacheWrite += cw;
            cacheWriteSeen = true;
        }
    }

    const nano = numOrNull(shutdown.totalNanoAiu) ?? 0;
    // Suppress $0.00 when the session never billed anything — null is
    // more honest than fake-precision zero.
    const costUsd =
        nano > 0 ? Number(((nano / 1_000_000_000) * AIU_RATE_USD).toFixed(6)) : null;

    return {
        input_tokens: input,
        output_tokens: output,
        cache_creation_tokens: cacheWriteSeen ? cacheWrite : null,
        cache_read_tokens: cacheRead,
        total_cost_usd: costUsd,
        credits: null,
    };
}

export interface CopilotSubagentInvocation {
    /** Stable key inside a session — `agentName` deduped across turns. */
    agentName: string;
    /** Display label ("Design Reviewer", "atlas-<uuid>", …). */
    agentDisplayName: string | null;
    /** Tool names the subagent was allowed to call, if the event carried them. */
    tools: string[];
    /** Timestamp of the first `subagent.selected` event for this agent. */
    firstSelectedAt: string | null;
    /** Timestamp of the last `subagent.selected` event for this agent. */
    lastSelectedAt: string | null;
}

interface CopilotSubagentEventData {
    agentName?: unknown;
    agentDisplayName?: unknown;
    tools?: unknown;
}

/**
 * Walk a Copilot `events.jsonl` and return every unique
 * `type:"subagent.selected"` invocation seen — collapsed by
 * `agentName` (the same subagent can be re-selected multiple times
 * within a session; each row here represents "at least one turn was
 * delegated to it").
 *
 * The events carry the agent's identity and tool list but NO token
 * or cost data. A 33-session sample of `~/.copilot/session-state/`
 * confirmed the on-disk format does not tag per-turn LLM requests
 * with the selected subagent, so atlas cannot attribute cost. Callers
 * mark rows built from this data as `is_estimate = true` and leave
 * token columns null.
 */
export function extractCopilotSubagentInvocations(
    jsonl: string,
): CopilotSubagentInvocation[] {
    if (!jsonl) return [];
    const byName = new Map<string, CopilotSubagentInvocation>();
    for (const rawLine of jsonl.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('{')) continue;
        let obj: Record<string, unknown>;
        try {
            obj = JSON.parse(line) as Record<string, unknown>;
        } catch {
            continue;
        }
        if (obj['type'] !== 'subagent.selected') continue;
        const data = obj['data'] as CopilotSubagentEventData | undefined;
        if (!data) continue;
        const name = typeof data.agentName === 'string' ? data.agentName : null;
        if (!name) continue;
        const timestamp = typeof obj['timestamp'] === 'string' ? (obj['timestamp'] as string) : null;
        const display = typeof data.agentDisplayName === 'string' ? data.agentDisplayName : null;
        const tools = Array.isArray(data.tools)
            ? data.tools.filter((t): t is string => typeof t === 'string')
            : [];
        const existing = byName.get(name);
        if (existing) {
            if (timestamp) existing.lastSelectedAt = timestamp;
            // Prefer the first non-empty tools list observed (the event
            // sometimes fires with `tools: []` after the initial arm).
            if (existing.tools.length === 0 && tools.length > 0) existing.tools = tools;
        } else {
            byName.set(name, {
                agentName: name,
                agentDisplayName: display,
                tools,
                firstSelectedAt: timestamp,
                lastSelectedAt: timestamp,
            });
        }
    }
    return Array.from(byName.values());
}
