import { describe, it, expect } from 'vitest';
import {
    parseCostFromOutput,
    parseClaudeCostFromOutput,
    parseCopilotCostFromOutput,
} from './agent-runner.js';

// Real-shape fixtures captured 2026-06-01 from one-shot probes of both
// CLIs. The Claude block matches `claude --print --output-format
// stream-json` final-result event; the Copilot block matches `copilot -p
// ... --output-format json` final-result event plus a representative
// `assistant.message` carrying `outputTokens`.

const CLAUDE_RESULT_LINE = JSON.stringify({
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.0123,
    usage: {
        input_tokens: 42,
        output_tokens: 100,
        cache_creation_input_tokens: 7,
        cache_read_input_tokens: 13,
    },
});

const CLAUDE_FIXTURE = [
    '{"type":"system","subtype":"init","model":"claude-sonnet-4-6"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}',
    CLAUDE_RESULT_LINE,
].join('\n');

// JSONL-only fixture (no stderr summary) — exercises the JSONL fallback
// for credit estimation when Copilot's stderr summary isn't present.
const COPILOT_FIXTURE = [
    '{"type":"session.mcp_server_status_changed","data":{"serverName":"atlas","status":"connected"}}',
    '{"type":"user.message","data":{"content":"hi"}}',
    '{"type":"assistant.message","data":{"messageId":"a","model":"claude-sonnet-4.6","content":"hello","outputTokens":4}}',
    '{"type":"assistant.message","data":{"messageId":"b","model":"claude-sonnet-4.6","content":"world","outputTokens":11}}',
    '{"type":"result","exitCode":0,"usage":{"premiumRequests":2,"totalApiDurationMs":3606,"sessionDurationMs":13490,"codeChanges":{"linesAdded":0,"linesRemoved":0,"filesModified":[]}}}',
].join('\n');

// Real-shape fixture from a long Coder run captured 2026-06-01 — JSONL
// PLUS the stderr summary the CLI emits at end-of-run. Demonstrates
// stderr precedence over JSONL fallback.
const COPILOT_FIXTURE_WITH_STDERR = [
    '{"type":"assistant.message","data":{"messageId":"a","model":"claude-sonnet-4.6","content":"diff","outputTokens":3000}}',
    '{"type":"result","exitCode":0,"usage":{"premiumRequests":1,"totalApiDurationMs":540000,"sessionDurationMs":545000,"codeChanges":{"linesAdded":223,"linesRemoved":37,"filesModified":[]}}}',
    '[stderr] Changes    +223 -37',
    '[stderr] AI Credits 119 (9m 5s)',
    '[stderr] Tokens     ↑ 2.4m (2.3m cached) • ↓ 17.3k (2.4k reasoning)',
].join('\n');

// Captured 2026-06-09 from run 7b52488f. Copilot CLI added a `, X written`
// field inside the `↑ N (...)` parens, breaking the old cached-only regex.
const COPILOT_FIXTURE_WITH_WRITTEN = [
    '[stderr] Changes    +127 -38',
    '[stderr] AI Credits 131 (7m 30s)',
    '[stderr] Tokens     ↑ 2.4m (2.4m cached, 77.8k written) • ↓ 20.6k (2.9k reasoning)',
].join('\n');

describe('parseClaudeCostFromOutput', () => {
    it('pulls total_cost_usd and all four usage fields from the final result event', () => {
        const cost = parseClaudeCostFromOutput(CLAUDE_FIXTURE);
        expect(cost).toEqual({
            total_cost_usd: 0.0123,
            input_tokens: 42,
            output_tokens: 100,
            cache_creation_tokens: 7,
            cache_read_tokens: 13,
            credits: null,
        });
    });

    it('returns null when no `result` event is present (CLI crashed early)', () => {
        const cost = parseClaudeCostFromOutput('{"type":"system","subtype":"init"}\n[stderr] boom');
        expect(cost).toBeNull();
    });

    it('returns null for empty / non-JSON output (simulated runs)', () => {
        expect(parseClaudeCostFromOutput('')).toBeNull();
        expect(parseClaudeCostFromOutput('just some plain text\n[ERROR] no JSON')).toBeNull();
    });
});

describe('parseCopilotCostFromOutput', () => {
    // Workstream #6 (2026-06-02) — the JSONL `premiumRequests × multiplier`
    // credit-estimate fallback is gone. When the stderr `AI Credits` line is
    // absent, credits and total_cost_usd stay null; the AI Usage card in the
    // web UI hides the cost row on null total_cost_usd, which matches Claude's
    // behavior on runs without a `result` event. JSONL `outputTokens` is
    // still summed across `assistant.message` events.
    it('returns null credits when no stderr summary is present (no estimation)', () => {
        const cost = parseCopilotCostFromOutput(COPILOT_FIXTURE);
        expect(cost).toEqual({
            total_cost_usd: null,
            input_tokens: null,
            output_tokens: 15, // 4+11 summed from assistant.message events
            cache_creation_tokens: null,
            cache_read_tokens: null,
            credits: null,
        });
    });

    it('uses the stderr summary as authoritative when present, including full token breakdown', () => {
        const cost = parseCopilotCostFromOutput(COPILOT_FIXTURE_WITH_STDERR);
        // AI Credits 119 from stderr × $0.01 = $1.19.
        // ↑ 2.4m total (2.3m cached) → 100k new input, 2.3m cache-read.
        // ↓ 17.3k output.
        expect(cost).toEqual({
            total_cost_usd: 1.19,
            input_tokens: 100_000,
            output_tokens: 17_300,
            cache_creation_tokens: null,
            cache_read_tokens: 2_300_000,
            credits: 119,
        });
    });

    it('parses the new `(X cached, Y written)` token-line format from current Copilot CLI', () => {
        const cost = parseCopilotCostFromOutput(COPILOT_FIXTURE_WITH_WRITTEN);
        // ↑ 2.4m total, 2.4m cached → 0 new input, 2.4m cache-read.
        // ↓ 20.6k output.
        // AI Credits 131 × $0.01 = $1.31.
        expect(cost).toEqual({
            total_cost_usd: 1.31,
            input_tokens: 0,
            output_tokens: 20_600,
            cache_creation_tokens: null,
            cache_read_tokens: 2_400_000,
            credits: 131,
        });
    });

    it('parses an `AI Credits` line with a fractional value', () => {
        const fractional = [
            '{"type":"assistant.message","data":{"messageId":"a","model":"claude-sonnet-4.6","content":"hi","outputTokens":4}}',
            '{"type":"result","exitCode":0,"usage":{"premiumRequests":1}}',
            '[stderr] AI Credits 7.99 (14s)',
            '[stderr] Tokens     ↑ 21.1k • ↓ 54',
        ].join('\n');
        const cost = parseCopilotCostFromOutput(fractional);
        expect(cost?.credits).toBe(7.99);
        expect(cost?.total_cost_usd).toBe(0.0799);
        expect(cost?.input_tokens).toBe(21_100); // no cached portion → all new
        expect(cost?.cache_read_tokens).toBeNull();
        expect(cost?.output_tokens).toBe(54);
    });

    it('keeps credits null on an unknown model with no stderr summary (no estimate)', () => {
        const unknownModel = [
            '{"type":"assistant.message","data":{"messageId":"a","model":"some-future-model","content":"hi","outputTokens":3}}',
            '{"type":"result","exitCode":0,"usage":{"premiumRequests":5}}',
        ].join('\n');
        const cost = parseCopilotCostFromOutput(unknownModel);
        expect(cost?.credits).toBeNull();
        expect(cost?.total_cost_usd).toBeNull();
        expect(cost?.output_tokens).toBe(3);
    });

    it('returns a result even when JSONL crashed mid-run, if the stderr AI Credits line survived', () => {
        const stderrOnly = [
            '[stderr] AI Credits 42 (5m)',
            '[stderr] Tokens     ↑ 500 • ↓ 100',
        ].join('\n');
        const cost = parseCopilotCostFromOutput(stderrOnly);
        expect(cost?.credits).toBe(42);
        expect(cost?.total_cost_usd).toBe(0.42);
    });

    it('returns null when the run never produced a `result` event', () => {
        const partial = [
            '{"type":"session.mcp_server_status_changed","data":{"serverName":"atlas","status":"connected"}}',
            '{"type":"assistant.message","data":{"content":"hi","outputTokens":3}}',
            '[stderr] CLI died',
        ].join('\n');
        const cost = parseCopilotCostFromOutput(partial);
        expect(cost).toBeNull();
    });

    it('handles a `result` event with no usage block gracefully', () => {
        const cost = parseCopilotCostFromOutput('{"type":"result","exitCode":0}');
        expect(cost).toEqual({
            total_cost_usd: null,
            input_tokens: null,
            output_tokens: null,
            cache_creation_tokens: null,
            cache_read_tokens: null,
            credits: null,
        });
    });

    it('handles a result event with usage but no premiumRequests', () => {
        const cost = parseCopilotCostFromOutput(
            '{"type":"result","exitCode":0,"usage":{"sessionDurationMs":1000}}',
        );
        expect(cost?.credits).toBeNull();
        expect(cost?.total_cost_usd).toBeNull();
    });
});

describe('parseCostFromOutput (dispatcher)', () => {
    it('routes Claude output through the Claude parser', () => {
        const cost = parseCostFromOutput(CLAUDE_FIXTURE, 'claude');
        expect(cost?.total_cost_usd).toBe(0.0123);
        expect(cost?.input_tokens).toBe(42);
        expect(cost?.credits).toBeNull();
    });

    it('parses Ollama output as Claude but zeroes the cost', () => {
        // Ollama runs the Claude binary, so the output IS Claude stream-json
        // and the token counts are real and worth keeping. The `total_cost_usd`
        // the CLI wrote, though, is Anthropic's price table applied to a
        // request Anthropic never served — a phantom charge. Ollama is free.
        const cost = parseCostFromOutput(CLAUDE_FIXTURE, 'ollama');
        expect(cost?.total_cost_usd).toBe(0);
        expect(cost?.input_tokens).toBe(42);
        expect(cost?.output_tokens).toBe(100);
    });

    it('returns null for an Ollama run that produced no parseable result event', () => {
        // Zeroing must not manufacture a cost row out of nothing — a crashed
        // run still has to read as "no data", not "a free run happened".
        expect(parseCostFromOutput('not json at all', 'ollama')).toBeNull();
    });

    it('routes Copilot output through the Copilot parser', () => {
        const cost = parseCostFromOutput(COPILOT_FIXTURE, 'copilot');
        // Workstream #6 — credits stay null when stderr summary is absent;
        // JSONL outputTokens still sums (4+11=15).
        expect(cost?.credits).toBeNull();
        expect(cost?.output_tokens).toBe(15);
        expect(cost?.input_tokens).toBeNull();
    });

    it('does NOT misparse Claude output if accidentally routed as Copilot (no premiumRequests in Claude)', () => {
        // Claude's `result` event has neither `usage.premiumRequests` nor
        // `assistant.message` event types, so the Copilot parser returns
        // a zero-fields shape with credits = null. This is the intended
        // defensive behaviour — silently mis-attributing cost would be
        // worse than blank fields.
        const cost = parseCostFromOutput(CLAUDE_FIXTURE, 'copilot');
        expect(cost?.credits).toBeNull();
        expect(cost?.total_cost_usd).toBeNull();
    });

    it('does NOT misparse Copilot output if accidentally routed as Claude (no Claude-shape token fields)', () => {
        // Copilot's `result.usage` block has different field names
        // (`premiumRequests` vs Claude's `input_tokens` etc.). The Claude
        // parser matches the result line but finds nothing recognisable —
        // every CostFields entry comes back null. That's the right
        // defensive behaviour: don't crash, don't fabricate values.
        const cost = parseCostFromOutput(COPILOT_FIXTURE, 'claude');
        expect(cost?.total_cost_usd).toBeNull();
        expect(cost?.input_tokens).toBeNull();
        expect(cost?.output_tokens).toBeNull();
        expect(cost?.cache_creation_tokens).toBeNull();
        expect(cost?.cache_read_tokens).toBeNull();
        expect(cost?.credits).toBeNull();
    });
});
