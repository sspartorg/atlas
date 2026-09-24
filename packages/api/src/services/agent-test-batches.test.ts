import { describe, expect, it } from 'vitest';
import { summariseBatch, toBatches } from './agent-test-batches.js';
import type { AgentTestRunRow } from './agent-tests-evaluate-run.js';

function sample(over: Partial<AgentTestRunRow> = {}): AgentTestRunRow {
    return {
        id: 'r',
        agent_test_id: 't1',
        agent_run_id: 'ar',
        item_id: 'ATL-1',
        verdict: 'passed',
        failures: [],
        cost_usd: 0.1,
        duration_s: 10,
        created_at: '2026-09-25T10:00:00.000Z',
        batch_id: 'b1',
        sample_index: 0,
        label: null,
        judge_verdict: null,
        judge_reason: null,
        judge_cost_usd: null,
        ...over,
    };
}

const batch = (verdicts: Array<AgentTestRunRow['verdict']>, over: Array<Partial<AgentTestRunRow>> = []) =>
    summariseBatch(
        'b1',
        verdicts.map((v, i) => sample({ id: `r${i}`, sample_index: i, verdict: v, ...(over[i] ?? {}) })),
    );

describe('summariseBatch', () => {
    it('reports a clean sweep as consistent and not flaky', () => {
        const b = batch(['passed', 'passed', 'passed']);
        expect(b.consistency).toBe(1);
        expect(b.flaky).toBe(false);
        expect(b.pass_at_1).toBe(true);
        expect(b.pass_at_k).toBe(true);
    });

    // The whole point of sampling. Three of five is neither "passed" nor
    // "failed", and before this the tab printed whichever one the Owner
    // happened to press the button on.
    it('reports a test that passes sometimes as flaky', () => {
        const b = batch(['passed', 'failed', 'passed', 'failed', 'passed']);
        expect(b.consistency).toBe(0.6);
        expect(b.flaky).toBe(true);
        expect(b.pass_at_1).toBe(true);
        expect(b.pass_at_k).toBe(true);
    });

    // A CLI that was not installed is not an agent that got it wrong — the
    // distinction `agent-tests-evaluate.ts` draws for one dispatch, kept here
    // instead of being averaged away.
    it('keeps a broken environment out of the denominator', () => {
        const b = batch(['passed', 'errored', 'passed', 'errored']);
        expect(b.errored).toBe(2);
        expect(b.consistency).toBe(1);
        expect(b.flaky).toBe(false);
    });

    it('says nothing about consistency while a sample is still running', () => {
        const b = batch(['passed', 'running', 'passed']);
        expect(b.consistency).toBeNull();
        expect(b.flaky).toBe(false);
        expect(b.running).toBe(1);
    });

    // "Can it do this at all" is unanswerable while one sample might still
    // come back green.
    it('withholds pass@k while a sample could still pass', () => {
        expect(batch(['failed', 'running']).pass_at_k).toBeNull();
        // Already answered: one passed, so the rest cannot change it.
        expect(batch(['passed', 'running']).pass_at_k).toBe(true);
    });

    it('withholds pass@1 while the first sample is unfinished', () => {
        expect(batch(['running', 'passed']).pass_at_1).toBeNull();
        expect(batch(['failed', 'passed']).pass_at_1).toBe(false);
    });

    // A batch that says "3 of 5 failed" is less useful than one that says
    // WHICH expectation was the unstable one.
    it('counts how many samples each expectation failed in', () => {
        const b = batch(['failed', 'failed', 'passed'], [
            { failures: ['summary does not mention "migration"', 'cost $0.9 exceeded the $0.5 ceiling'] },
            { failures: ['summary does not mention "migration"'] },
        ]);
        expect(b.failure_histogram).toEqual([
            { failure: 'summary does not mention "migration"', count: 2 },
            { failure: 'cost $0.9 exceeded the $0.5 ceiling', count: 1 },
        ]);
    });

    it('sums the agent’s cost and the judge’s separately', () => {
        const b = batch(['passed', 'passed'], [
            { cost_usd: 0.2, judge_cost_usd: 0.01 },
            { cost_usd: 0.3, judge_cost_usd: 0.01 },
        ]);
        expect(b.cost_usd).toBeCloseTo(0.5);
        expect(b.judge_cost_usd).toBeCloseTo(0.02);
    });

    it('reports duration percentiles over the samples that finished', () => {
        const b = batch(['passed', 'passed', 'passed', 'passed'], [
            { duration_s: 10 },
            { duration_s: 20 },
            { duration_s: 30 },
            { duration_s: null },
        ]);
        expect(b.duration_s_p50).toBe(20);
        expect(b.duration_s_p95).toBe(30);
    });

    it('survives a batch with nothing in it', () => {
        const b = summariseBatch('b0', []);
        expect(b.n_runs).toBe(0);
        expect(b.consistency).toBeNull();
        expect(b.pass_at_1).toBeNull();
        expect(b.flaky).toBe(false);
    });
});

describe('toBatches', () => {
    it('groups runs by the press of the button that made them', () => {
        const rows = [
            sample({ id: 'b', batch_id: 'b2', sample_index: 0, created_at: '2026-09-25T11:00:00.000Z' }),
            sample({ id: 'a1', batch_id: 'b1', sample_index: 1, verdict: 'failed' }),
            sample({ id: 'a0', batch_id: 'b1', sample_index: 0 }),
        ];
        const batches = toBatches(rows);
        expect(batches.map((b) => b.batch_id)).toEqual(['b2', 'b1']);
        expect(batches[1]?.n_runs).toBe(2);
        // Ordered by sample_index whatever order they arrived in, so pass@1
        // means the first sample rather than whichever row sorted first.
        expect(batches[1]?.runs.map((r) => r.id)).toEqual(['a0', 'a1']);
        expect(batches[1]?.pass_at_1).toBe(true);
    });

    // Every run from before sampling shipped was backfilled to its own batch.
    it('treats a pre-sampling run as a batch of one', () => {
        expect(toBatches([sample({ id: 'old', batch_id: 'old' })])[0]).toMatchObject({
            n_runs: 1,
            consistency: 1,
            flaky: false,
        });
    });
});
