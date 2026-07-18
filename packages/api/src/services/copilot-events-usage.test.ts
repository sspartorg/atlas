import { describe, expect, it } from 'vitest';
import {
    parseCopilotEventsUsage,
    extractCopilotSubagentInvocations,
} from './copilot-events-usage.js';

// Helper: build a session.shutdown event line. Defaults mirror the real
// sample inspected on a atlas copilot session.
function shutdownLine(opts: {
    totalNanoAiu?: number;
    input?: number;
    output?: number;
    cache_read?: number;
    modelMetrics?: Record<string, { usage: Record<string, number> }>;
}): string {
    return JSON.stringify({
        type: 'session.shutdown',
        data: {
            shutdownType: 'routine',
            ...(opts.totalNanoAiu !== undefined ? { totalNanoAiu: opts.totalNanoAiu } : {}),
            tokenDetails: {
                input: { tokenCount: opts.input ?? 0 },
                output: { tokenCount: opts.output ?? 0 },
                cache_read: { tokenCount: opts.cache_read ?? 0 },
            },
            ...(opts.modelMetrics ? { modelMetrics: opts.modelMetrics } : {}),
        },
    });
}

describe('parseCopilotEventsUsage', () => {
    it('returns null for empty input (COP-EMPTY)', () => {
        expect(parseCopilotEventsUsage('')).toBeNull();
    });

    it('returns null when no session.shutdown event is present (COP-NO-SHUTDOWN)', () => {
        // session still live, or copilot crashed before emitting
        const jsonl =
            JSON.stringify({ type: 'session.start', data: {} }) +
            '\n' +
            JSON.stringify({ type: 'assistant.message', data: { outputTokens: 5 } });
        expect(parseCopilotEventsUsage(jsonl)).toBeNull();
    });

    it('extracts totals + cost from a real-shape shutdown event (COP-SHUTDOWN-PRESENT)', () => {
        // Real numbers from a atlas copilot session inspection.
        const jsonl = shutdownLine({
            totalNanoAiu: 1_122_300_000,
            input: 14802,
            output: 27,
            cache_read: 0,
            modelMetrics: {
                'gpt-5.4-mini': {
                    usage: {
                        inputTokens: 14802,
                        outputTokens: 27,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                    },
                },
            },
        });
        const r = parseCopilotEventsUsage(jsonl)!;
        expect(r.input_tokens).toBe(14802);
        expect(r.output_tokens).toBe(27);
        expect(r.cache_read_tokens).toBe(0);
        expect(r.cache_creation_tokens).toBe(0); // modelMetrics had cacheWriteTokens=0 (seen)
        // (1_122_300_000 / 1e9) * 0.04 = 1.1223 * 0.04 = 0.044892
        expect(r.total_cost_usd).toBeCloseTo(0.044892, 6);
    });

    it('returns null cost when totalNanoAiu is zero (COP-ZERO-NANO)', () => {
        // Distinguish "we know it cost nothing" from "we don't know" —
        // null is more honest than $0.00 (which might look like a bug).
        const jsonl = shutdownLine({
            totalNanoAiu: 0,
            input: 100,
            output: 50,
        });
        const r = parseCopilotEventsUsage(jsonl)!;
        expect(r.input_tokens).toBe(100);
        expect(r.output_tokens).toBe(50);
        expect(r.total_cost_usd).toBeNull();
    });

    it('sums cacheWriteTokens across multiple modelMetrics entries (COP-MULTI-MODEL)', () => {
        const jsonl = shutdownLine({
            totalNanoAiu: 500_000_000,
            input: 1000,
            output: 100,
            modelMetrics: {
                'gpt-5.4-mini': { usage: { cacheWriteTokens: 4000 } },
                'gpt-5.4': { usage: { cacheWriteTokens: 6000 } },
            },
        });
        const r = parseCopilotEventsUsage(jsonl)!;
        expect(r.cache_creation_tokens).toBe(10000);
        expect(r.total_cost_usd).toBeCloseTo(0.02, 6); // 0.5 AIU * $0.04
    });

    it('leaves cache_creation_tokens null when modelMetrics is missing (COP-MALFORMED)', () => {
        // Defensive: if Copilot ever drops modelMetrics or it's empty,
        // we don't fabricate 0 (which would imply we measured zero).
        const jsonl = JSON.stringify({
            type: 'session.shutdown',
            data: {
                totalNanoAiu: 100_000_000,
                tokenDetails: {
                    input: { tokenCount: 50 },
                    output: { tokenCount: 10 },
                    cache_read: { tokenCount: 0 },
                },
                // no modelMetrics
            },
        });
        const r = parseCopilotEventsUsage(jsonl)!;
        expect(r.input_tokens).toBe(50);
        expect(r.output_tokens).toBe(10);
        expect(r.cache_creation_tokens).toBeNull();
    });

    it('skips malformed JSON lines without crashing (COP-BAD-JSON)', () => {
        const good = shutdownLine({ totalNanoAiu: 100_000_000, input: 10, output: 5 });
        const jsonl = ['not-json', '{broken', good].join('\n');
        const r = parseCopilotEventsUsage(jsonl)!;
        expect(r.input_tokens).toBe(10);
        expect(r.total_cost_usd).toBeCloseTo(0.004, 6); // 0.1 AIU * $0.04
    });

    it('uses the LAST shutdown event when multiple appear (COP-LAST-SHUTDOWN-WINS)', () => {
        // Defensive — single session.shutdown is the contract, but if
        // copilot ever logs an earlier shutdown then resumes and logs
        // another, the latest one has the most up-to-date totals.
        const early = shutdownLine({ totalNanoAiu: 100_000_000, input: 10 });
        const late = shutdownLine({ totalNanoAiu: 500_000_000, input: 50 });
        const r = parseCopilotEventsUsage(`${early}\n${late}`)!;
        expect(r.input_tokens).toBe(50);
        expect(r.total_cost_usd).toBeCloseTo(0.02, 6); // 0.5 AIU * $0.04
    });

    it('returns null when a session.shutdown event carries no data field (COP-SHUTDOWN-NO-DATA)', () => {
        // Defensive branch: `data && typeof data === 'object'` guards
        // against a malformed shutdown event where the `data` key is
        // absent — the loop skips the assignment, `shutdown` stays
        // null, function returns null.
        const jsonl = JSON.stringify({ type: 'session.shutdown' });
        expect(parseCopilotEventsUsage(jsonl)).toBeNull();
    });

    it('returns null when session.shutdown data is a primitive (COP-SHUTDOWN-DATA-STRING)', () => {
        // Same defensive branch — `typeof data === 'object'` is false
        // for strings, numbers, and booleans, so the assignment is
        // skipped and the function returns null.
        const jsonl = JSON.stringify({ type: 'session.shutdown', data: 'garbage' });
        expect(parseCopilotEventsUsage(jsonl)).toBeNull();
    });

    it('skips lines that do not start with { (COP-NON-JSON-PREFIX)', () => {
        // The `!line.startsWith('{')` guard bypasses non-JSON leading
        // lines (log preambles, banner text) without invoking JSON.parse
        // for every one.
        const good = shutdownLine({ totalNanoAiu: 100_000_000, input: 10, output: 5 });
        const jsonl = ['# banner text', '=== session start ===', good].join('\n');
        const r = parseCopilotEventsUsage(jsonl)!;
        expect(r.input_tokens).toBe(10);
    });
});

// Helper for the subagent extractor tests — build a `subagent.selected`
// event line matching the real event shape observed on-disk.
function subagentLine(opts: {
    name: string;
    display?: string | null;
    tools?: string[];
    timestamp?: string;
}): string {
    return JSON.stringify({
        type: 'subagent.selected',
        timestamp: opts.timestamp ?? '2026-07-03T10:00:00.000Z',
        data: {
            agentName: opts.name,
            ...(opts.display !== undefined ? { agentDisplayName: opts.display } : {}),
            ...(opts.tools !== undefined ? { tools: opts.tools } : {}),
        },
    });
}

describe('extractCopilotSubagentInvocations', () => {
    it('returns [] on empty input (CSI-EMPTY)', () => {
        expect(extractCopilotSubagentInvocations('')).toEqual([]);
    });

    it('collapses repeated selection of the same agent into one row (CSI-DEDUP)', () => {
        const jsonl = [
            subagentLine({ name: 'atlas-abc', display: 'Design Reviewer', tools: ['read'], timestamp: '2026-07-03T10:00:00.000Z' }),
            subagentLine({ name: 'atlas-abc', display: 'Design Reviewer', tools: [], timestamp: '2026-07-03T10:05:00.000Z' }),
        ].join('\n');
        const rows = extractCopilotSubagentInvocations(jsonl);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.agentName).toBe('atlas-abc');
        expect(rows[0]!.agentDisplayName).toBe('Design Reviewer');
        expect(rows[0]!.tools).toEqual(['read']);
        expect(rows[0]!.firstSelectedAt).toBe('2026-07-03T10:00:00.000Z');
        expect(rows[0]!.lastSelectedAt).toBe('2026-07-03T10:05:00.000Z');
    });

    it('returns one row per unique agentName across three invocations (CSI-THREE)', () => {
        const jsonl = [
            subagentLine({ name: 'atlas-a', display: 'A', tools: ['read', 'write'] }),
            subagentLine({ name: 'atlas-b', display: 'B', tools: ['grep'] }),
            subagentLine({ name: 'atlas-c', display: 'C', tools: [] }),
        ].join('\n');
        const rows = extractCopilotSubagentInvocations(jsonl);
        expect(rows).toHaveLength(3);
        const names = rows.map((r) => r.agentName).sort();
        expect(names).toEqual(['atlas-a', 'atlas-b', 'atlas-c']);
    });

    it('ignores events that lack an agentName field (CSI-NO-NAME)', () => {
        const jsonl = JSON.stringify({
            type: 'subagent.selected',
            data: { agentDisplayName: 'nameless' },
        });
        expect(extractCopilotSubagentInvocations(jsonl)).toEqual([]);
    });

    it('ignores non-subagent events interleaved in the stream (CSI-INTERLEAVED)', () => {
        const jsonl = [
            JSON.stringify({ type: 'assistant.message', data: {} }),
            subagentLine({ name: 'atlas-a', display: 'A' }),
            JSON.stringify({ type: 'session.shutdown', data: {} }),
        ].join('\n');
        const rows = extractCopilotSubagentInvocations(jsonl);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.agentName).toBe('atlas-a');
    });
});
