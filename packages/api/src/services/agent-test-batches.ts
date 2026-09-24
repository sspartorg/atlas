import type { AgentTestRunRow } from './agent-tests-evaluate-run.js';

// What `n` samples of one test add up to.
//
// Computed, never stored. A stored batch verdict goes stale the moment one
// sample is re-judged, and everything below is a fold over rows that already
// exist — which is also why there is no `agent_test_batches` table.

export interface AgentTestBatch {
    batch_id: string;
    label: string | null;
    created_at: string;
    n_runs: number;
    passed: number;
    failed: number;
    errored: number;
    running: number;
    /**
     * The first sample's verdict. Comparable with a single un-sampled run and
     * with everything in `agent_runs` history, which is all pass@1.
     */
    pass_at_1: boolean | null;
    /** Any sample passed — "can it do this at all", as opposed to "reliably". */
    pass_at_k: boolean | null;
    /**
     * `passed / (n_runs - errored)`. Null while a sample is still running.
     *
     * **`errored` never enters the denominator.** A CLI that was not installed
     * is not an agent that got it wrong — the same distinction
     * `agent-tests-evaluate.ts` already draws for a single dispatch, kept at
     * the batch level rather than quietly lost in an average.
     */
    consistency: number | null;
    /** It passed sometimes. The single most useful thing a batch can say. */
    flaky: boolean;
    /** Which expectation was unstable, and in how many samples. */
    failure_histogram: Array<{ failure: string; count: number }>;
    cost_usd: number;
    judge_cost_usd: number;
    duration_s_p50: number | null;
    duration_s_p95: number | null;
    runs: AgentTestRunRow[];
}

/** Nearest-rank percentile. `p` in [0,1]. */
function percentile(sorted: number[], p: number): number | null {
    if (sorted.length === 0) return null;
    const rank = Math.ceil(p * sorted.length);
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? null;
}

/**
 * Fold one batch's samples, which must already be ordered by `sample_index`.
 */
export function summariseBatch(batchId: string, samples: AgentTestRunRow[]): AgentTestBatch {
    const passed = samples.filter((r) => r.verdict === 'passed').length;
    const failed = samples.filter((r) => r.verdict === 'failed').length;
    const errored = samples.filter((r) => r.verdict === 'errored').length;
    const running = samples.filter((r) => r.verdict === 'running').length;
    const judged = samples.length - errored;

    const counts = new Map<string, number>();
    for (const r of samples) {
        for (const f of r.failures) counts.set(f, (counts.get(f) ?? 0) + 1);
    }

    const durations = samples
        .map((r) => r.duration_s)
        .filter((d): d is number => d !== null)
        .sort((a, b) => a - b);

    const first = samples[0];
    return {
        batch_id: batchId,
        label: first?.label ?? null,
        created_at: first?.created_at ?? '',
        n_runs: samples.length,
        passed,
        failed,
        errored,
        running,
        pass_at_1: first && first.verdict !== 'running' ? first.verdict === 'passed' : null,
        pass_at_k: running > 0 && passed === 0 ? null : passed > 0,
        consistency: running > 0 || judged === 0 ? null : passed / judged,
        flaky: running === 0 && passed > 0 && passed < judged,
        failure_histogram: [...counts.entries()]
            .map(([failure, count]) => ({ failure, count }))
            .sort((a, b) => b.count - a.count || a.failure.localeCompare(b.failure)),
        cost_usd: samples.reduce((n, r) => n + (r.cost_usd ?? 0), 0),
        judge_cost_usd: samples.reduce((n, r) => n + (r.judge_cost_usd ?? 0), 0),
        duration_s_p50: percentile(durations, 0.5),
        duration_s_p95: percentile(durations, 0.95),
        runs: samples,
    };
}

/** Group flat rows (newest batch first) into batches. */
export function toBatches(rows: AgentTestRunRow[]): AgentTestBatch[] {
    const byBatch = new Map<string, AgentTestRunRow[]>();
    for (const r of rows) {
        byBatch.set(r.batch_id, [...(byBatch.get(r.batch_id) ?? []), r]);
    }
    return [...byBatch.entries()].map(([id, rs]) =>
        summariseBatch(id, [...rs].sort((a, b) => a.sample_index - b.sample_index)),
    );
}
