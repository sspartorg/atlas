import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    parseClaudePtyUsage,
    parseClaudeSubagentUsage,
} from './pty-transcript-usage.js';

// Helper: build a single `type:"assistant"` JSONL line with a usage block.
// `msgId` defaults to a unique id per call so existing tests don't
// accidentally trigger dedup. Tests that DO want dedup pass an explicit id.
let msgIdCounter = 0;
function asstLine(
    model: string,
    usage: Record<string, unknown>,
    msgId?: string,
): string {
    msgIdCounter += 1;
    return JSON.stringify({
        type: 'assistant',
        message: {
            id: msgId ?? `msg_auto_${msgIdCounter}`,
            model,
            usage,
        },
    });
}

describe('parseClaudePtyUsage', () => {
    it('returns null for empty input (PTU-EMPTY)', () => {
        expect(parseClaudePtyUsage('', 'claude-haiku-4-5')).toBeNull();
    });

    it('returns null when transcript has no assistant events (PTU-USER-ONLY)', () => {
        const jsonl =
            JSON.stringify({ type: 'user', message: { content: 'hi' } }) +
            '\n' +
            JSON.stringify({ type: 'summary', summary: 'done' });
        expect(parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')).toBeNull();
    });

    it('skips assistant events with no `usage` block without crashing (PTU-NO-USAGE)', () => {
        const jsonl =
            JSON.stringify({
                type: 'assistant',
                message: { model: 'claude-haiku-4-5', content: [] },
            }) + '\n';
        expect(parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')).toBeNull();
    });

    it('skips malformed JSON lines (PTU-BAD-JSON)', () => {
        const good = asstLine('claude-haiku-4-5', { input_tokens: 100, output_tokens: 50 });
        const jsonl = ['not-json', good, '{broken'].join('\n');
        const result = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5');
        expect(result).not.toBeNull();
        expect(result!.input_tokens).toBe(100);
        expect(result!.output_tokens).toBe(50);
    });

    it('accumulates input_tokens when output_tokens is absent (PTU-NO-OUTPUT-FIELD)', () => {
        // Exercises the `typeof usage.output_tokens === 'number'` false
        // branch — a usage block that carries input_tokens but omits
        // output_tokens entirely (e.g. a turn still streaming when the
        // session was captured).
        const jsonl = asstLine('claude-haiku-4-5', { input_tokens: 42 });
        const r = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')!;
        expect(r.input_tokens).toBe(42);
        expect(r.output_tokens).toBe(0);
    });

    it('sums input + output + cache_read across multiple events (PTU-SUM)', () => {
        const jsonl =
            asstLine('claude-haiku-4-5', {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_input_tokens: 200,
            }) +
            '\n' +
            asstLine('claude-haiku-4-5', {
                input_tokens: 10,
                output_tokens: 5,
                cache_read_input_tokens: 1000,
            });
        const r = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')!;
        expect(r.input_tokens).toBe(110);
        expect(r.output_tokens).toBe(55);
        expect(r.cache_read_tokens).toBe(1200);
    });

    it('splits cache_creation into 5m and 1h when the breakdown is present (PTU-CACHE-SPLIT)', () => {
        // 100k tokens written to 5m cache + 200k written to 1h cache.
        const jsonl = asstLine('claude-haiku-4-5', {
            input_tokens: 10,
            output_tokens: 10,
            cache_creation_input_tokens: 300_000,
            cache_creation: {
                ephemeral_5m_input_tokens: 100_000,
                ephemeral_1h_input_tokens: 200_000,
            },
        });
        const r = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')!;
        // cache_creation_tokens column = sum of both tiers.
        expect(r.cache_creation_tokens).toBe(300_000);
        // Cost breakdown (haiku-4-5: cw5m=$1.25/M, cw1h=$2.00/M):
        //   100_000 * 1.25/M = 0.125
        //   200_000 * 2.00/M = 0.400
        //   plus input 10 * 1.00/M = 0.00001
        //   plus output 10 * 5.00/M = 0.00005
        // Total ≈ 0.52506
        expect(r.total_cost_usd).toBeCloseTo(0.52506, 5);
    });

    it('splits with only the 1h tier present bills 1h and skips the 5m accumulator (PTU-CACHE-SPLIT-1H-ONLY)', () => {
        // has1h=true, has5m=false — covers the `if (has5m)` false branch
        // inside the has5m||has1h block (PTU-CACHE-SPLIT above always sets
        // both, so that false branch was never reached).
        const jsonl = asstLine('claude-haiku-4-5', {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation: {
                ephemeral_1h_input_tokens: 200_000,
            },
        });
        const r = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')!;
        expect(r.cache_creation_tokens).toBe(200_000);
        // 200_000 * $2.00/M (1h rate) = $0.40
        expect(r.total_cost_usd).toBeCloseTo(0.4, 5);
    });

    it('splits with only the 5m tier present bills 5m and skips the 1h accumulator (PTU-CACHE-SPLIT-5M-ONLY)', () => {
        // has5m=true, has1h=false — covers the `if (has1h)` false branch.
        const jsonl = asstLine('claude-haiku-4-5', {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation: {
                ephemeral_5m_input_tokens: 100_000,
            },
        });
        const r = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')!;
        expect(r.cache_creation_tokens).toBe(100_000);
        // 100_000 * $1.25/M (5m rate) = $0.125
        expect(r.total_cost_usd).toBeCloseTo(0.125, 5);
    });

    it('falls back to the rolled-up cache_creation_input_tokens when the split is missing (PTU-CACHE-NO-SPLIT)', () => {
        // No `cache_creation.{ephemeral_5m,ephemeral_1h}` field -> bill
        // the whole amount at the 5m rate.
        const jsonl = asstLine('claude-haiku-4-5', {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 100_000,
        });
        const r = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')!;
        expect(r.cache_creation_tokens).toBe(100_000);
        // 100_000 * $1.25/M = $0.125
        expect(r.total_cost_usd).toBeCloseTo(0.125, 5);
    });

    it('uses each event\'s own message.model for per-turn pricing (PTU-MULTI-MODEL)', () => {
        // First turn on cheap haiku, second on expensive opus-4-7.
        // Output 1_000_000 each so the cost gap is easy to inspect.
        const jsonl =
            asstLine('claude-haiku-4-5', { output_tokens: 1_000_000 }) +
            '\n' +
            asstLine('claude-opus-4-7', { output_tokens: 1_000_000 });
        const r = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')!;
        expect(r.output_tokens).toBe(2_000_000);
        // haiku output $5/M + opus-4-7 output $25/M = $30 total
        expect(r.total_cost_usd).toBeCloseTo(30.0, 4);
    });

    it('falls back to `fallbackModel` when message.model is missing (PTU-FALLBACK-MODEL)', () => {
        const jsonl = JSON.stringify({
            type: 'assistant',
            message: { usage: { output_tokens: 1_000_000 } },
        });
        const r = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')!;
        // Output 1M * $5/M = $5.00
        expect(r.total_cost_usd).toBeCloseTo(5.0, 4);
    });

    it('returns tokens but null cost for unknown models (PTU-UNKNOWN-MODEL)', () => {
        // A future Anthropic model we haven\'t added to the table yet.
        const jsonl = asstLine('claude-fictional-100', { input_tokens: 100, output_tokens: 50 });
        const r = parseClaudePtyUsage(jsonl, 'claude-fictional-100')!;
        // Token counts still accumulate so the UI shows real numbers.
        expect(r.input_tokens).toBe(100);
        expect(r.output_tokens).toBe(50);
        // Cost is null — we didn\'t guess a rate.
        expect(r.total_cost_usd).toBeNull();
    });

    it('resolves dated suffix variants via lookupClaudePrices (PTU-DATED-MODEL)', () => {
        // Real model id observed in a live atlas PTY session.
        const jsonl = asstLine('claude-haiku-4-5-20251001', {
            input_tokens: 100,
            output_tokens: 50,
        });
        const r = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')!;
        // 100 * $1/M + 50 * $5/M = 0.0001 + 0.00025 = 0.00035
        expect(r.total_cost_usd).toBeCloseTo(0.00035, 6);
    });

    // Dedup fix tests — see comment in parseClaudePtyUsage for the bug:
    // Claude Code writes each assistant message TWICE to the JSONL
    // (streaming-start + streaming-end), each carrying the SAME usage.
    // Without dedup, summing doubles cost — matched user observation of
    // $0.03 live vs $0.06 after Stop.

    it('deduplicates assistant events sharing the same message.id (PTU-DEDUP-MSGID)', () => {
        // Two assistant lines, SAME msg_id, IDENTICAL usage — real-world
        // shape from Claude Code's PTY mode (one stream-start, one
        // stream-end write per turn).
        const usage = {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 1000,
            cache_read_input_tokens: 0,
        };
        const jsonl =
            asstLine('claude-haiku-4-5', usage, 'msg_01ABC') +
            '\n' +
            asstLine('claude-haiku-4-5', usage, 'msg_01ABC');
        const r = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')!;
        // Should count the turn ONCE, not twice.
        expect(r.input_tokens).toBe(100);
        expect(r.output_tokens).toBe(50);
        expect(r.cache_creation_tokens).toBe(1000);
        // Cost = 100*1/M + 50*5/M + 1000*1.25/M (5m default since no split)
        //      = 0.0001 + 0.00025 + 0.00125 = 0.0016
        expect(r.total_cost_usd).toBeCloseTo(0.0016, 6);
    });

    it('first occurrence wins when duplicates have different usage (PTU-DEDUP-FIRST-WINS)', () => {
        // Defensive — shouldn't happen in real Anthropic output (one
        // message.id == one API response == one usage block), but if it
        // ever does, the documented behavior is FIRST-event-wins (the
        // Set.has check rejects subsequent occurrences before they
        // contribute to totals).
        const jsonl =
            asstLine('claude-haiku-4-5', { output_tokens: 100 }, 'msg_X') +
            '\n' +
            asstLine('claude-haiku-4-5', { output_tokens: 999_999 }, 'msg_X');
        const r = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')!;
        expect(r.output_tokens).toBe(100); // not 999_999, not 1_000_099
    });

    it('events without message.id are NOT deduplicated against each other (PTU-DEDUP-NO-MSGID)', () => {
        // Two assistant events with no `message.id`. Each contributes
        // independently. Worst case we slightly over-count, but that's
        // safer than silently dropping legitimate usage when a future
        // Claude version omits the id field.
        const line = JSON.stringify({
            type: 'assistant',
            message: {
                // no `id` field
                model: 'claude-haiku-4-5',
                usage: { output_tokens: 100 },
            },
        });
        const jsonl = `${line}\n${line}`;
        const r = parseClaudePtyUsage(jsonl, 'claude-haiku-4-5')!;
        expect(r.output_tokens).toBe(200); // both events counted
    });
});

describe('parseClaudeSubagentUsage', () => {
    let sessionDir: string;

    beforeEach(async () => {
        sessionDir = await fs.mkdtemp(path.join(tmpdir(), 'claude-subagents-'));
    });
    afterEach(async () => {
        await fs.rm(sessionDir, { recursive: true, force: true });
    });

    it('returns [] when the subagents/ dir does not exist (PCS-NO-DIR)', async () => {
        const rows = await parseClaudeSubagentUsage(sessionDir, 'claude-haiku-4-5');
        expect(rows).toEqual([]);
    });

    it('sums per-subagent usage and pulls display fields from meta.json (PCS-TWO-SUBS)', async () => {
        const subagentsDir = path.join(sessionDir, 'subagents');
        await fs.mkdir(subagentsDir, { recursive: true });
        // Subagent A — a Plan agent with two turns; ISO timestamps let us
        // verify started/ended.
        await fs.writeFile(
            path.join(subagentsDir, 'agent-aaa.jsonl'),
            [
                JSON.stringify({
                    type: 'assistant',
                    timestamp: '2026-07-03T10:00:00.000Z',
                    message: {
                        id: 'msg_a1',
                        model: 'claude-haiku-4-5',
                        usage: { input_tokens: 500, output_tokens: 200 },
                    },
                }),
                JSON.stringify({
                    type: 'assistant',
                    timestamp: '2026-07-03T10:00:30.000Z',
                    message: {
                        id: 'msg_a2',
                        model: 'claude-haiku-4-5',
                        usage: { input_tokens: 100, output_tokens: 40 },
                    },
                }),
            ].join('\n'),
        );
        await fs.writeFile(
            path.join(subagentsDir, 'agent-aaa.meta.json'),
            JSON.stringify({
                agentType: 'Plan',
                description: 'Design CLI session-id capture fix',
                toolUseId: 'toolu_1',
                spawnDepth: 1,
            }),
        );
        // Subagent B — an Explore agent with one turn and no timestamp.
        await fs.writeFile(
            path.join(subagentsDir, 'agent-bbb.jsonl'),
            JSON.stringify({
                type: 'assistant',
                message: {
                    id: 'msg_b1',
                    model: 'claude-haiku-4-5',
                    usage: { input_tokens: 300, output_tokens: 100 },
                },
            }),
        );
        await fs.writeFile(
            path.join(subagentsDir, 'agent-bbb.meta.json'),
            JSON.stringify({ agentType: 'Explore', description: 'Grep for usages', spawnDepth: 2 }),
        );

        const rows = await parseClaudeSubagentUsage(sessionDir, 'claude-haiku-4-5');
        expect(rows).toHaveLength(2);
        const byKey = Object.fromEntries(rows.map((r) => [r.subagentKey, r]));
        expect(byKey['agent-aaa']).toBeDefined();
        expect(byKey['agent-aaa'].agentType).toBe('Plan');
        expect(byKey['agent-aaa'].description).toBe('Design CLI session-id capture fix');
        expect(byKey['agent-aaa'].spawnDepth).toBe(1);
        expect(byKey['agent-aaa'].tokens.input_tokens).toBe(600);
        expect(byKey['agent-aaa'].tokens.output_tokens).toBe(240);
        expect(byKey['agent-aaa'].startedAt).toBe('2026-07-03T10:00:00.000Z');
        expect(byKey['agent-aaa'].endedAt).toBe('2026-07-03T10:00:30.000Z');
        expect(byKey['agent-bbb'].agentType).toBe('Explore');
        expect(byKey['agent-bbb'].tokens.input_tokens).toBe(300);
    });

    it('tolerates missing meta.json by leaving display fields null (PCS-NO-META)', async () => {
        const subagentsDir = path.join(sessionDir, 'subagents');
        await fs.mkdir(subagentsDir, { recursive: true });
        await fs.writeFile(
            path.join(subagentsDir, 'agent-orphan.jsonl'),
            JSON.stringify({
                type: 'assistant',
                message: {
                    id: 'msg_orphan',
                    model: 'claude-haiku-4-5',
                    usage: { input_tokens: 50, output_tokens: 25 },
                },
            }),
        );
        // No paired .meta.json intentionally.
        const rows = await parseClaudeSubagentUsage(sessionDir, 'claude-haiku-4-5');
        expect(rows).toHaveLength(1);
        expect(rows[0]!.agentType).toBeNull();
        expect(rows[0]!.description).toBeNull();
        expect(rows[0]!.spawnDepth).toBeNull();
        expect(rows[0]!.tokens.input_tokens).toBe(50);
    });

    it('skips JSONL files that contribute zero assistant events (PCS-EMPTY-JSONL)', async () => {
        const subagentsDir = path.join(sessionDir, 'subagents');
        await fs.mkdir(subagentsDir, { recursive: true });
        // File exists but is empty (nothing to sum).
        await fs.writeFile(path.join(subagentsDir, 'agent-nothing.jsonl'), '');
        await fs.writeFile(
            path.join(subagentsDir, 'agent-nothing.meta.json'),
            JSON.stringify({ agentType: 'Plan', description: 'x' }),
        );
        const rows = await parseClaudeSubagentUsage(sessionDir, 'claude-haiku-4-5');
        expect(rows).toEqual([]);
    });
});
