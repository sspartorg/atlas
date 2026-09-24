import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { listGateResultsForRun, recordGateResult } from './run-gate-results.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';

const EMPTY_GRAPH = JSON.stringify({ nodes: [], edges: [] });

async function seedRun(id: string): Promise<void> {
    await testDb.insertInto('workflows').values({ id: 'w1', project_id: 'p1', name: 'w1', input_kind: 'item' }).execute();
    await testDb
        .insertInto('workflow_runs')
        .values({ id, workflow_id: 'w1', item_id: null, project_id: 'p1', status: 'running', graph_snapshot: EMPTY_GRAPH })
        .execute();
}

async function seedRun2(id: string): Promise<void> {
    await testDb
        .insertInto('workflow_runs')
        .values({ id, workflow_id: 'w1', item_id: null, project_id: 'p1', status: 'running', graph_snapshot: EMPTY_GRAPH })
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
});

afterAll(async () => {
    await closeTestDb();
});

describe('recordGateResult', () => {
    it('stores the verdict, exit code and output tail', async () => {
        await seedRun('r1');
        await recordGateResult({
            workflow_run_id: 'r1',
            repo_id: 'repo-a',
            script_id: 'coder-tests-green',
            verdict: 'fail',
            exit_code: 1,
            output_tail: '2 tests failed',
        });

        const rows = await testDb.selectFrom('run_gate_results').selectAll().execute();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            workflow_run_id: 'r1',
            node_id: null,
            repo_id: 'repo-a',
            script_id: 'coder-tests-green',
            verdict: 'fail',
            exit_code: 1,
            output_tail: '2 tests failed',
        });
    });

    it('defaults the optional columns to null', async () => {
        await seedRun('r2');
        await recordGateResult({ workflow_run_id: 'r2', script_id: 'gate-hygiene', verdict: 'pass' });

        const row = await testDb.selectFrom('run_gate_results').selectAll().executeTakeFirstOrThrow();
        expect(row).toMatchObject({ node_id: null, repo_id: null, exit_code: null, output_tail: null });
    });

    it('records a node_id when the gate is a workflow step', async () => {
        await seedRun('r3');
        await recordGateResult({
            workflow_run_id: 'r3',
            node_id: 'gate-coverage',
            script_id: 'gate-coverage',
            verdict: 'needs_review',
        });

        const row = await testDb.selectFrom('run_gate_results').selectAll().executeTakeFirstOrThrow();
        expect(row.node_id).toBe('gate-coverage');
        expect(row.verdict).toBe('needs_review');
    });

    it('swallows a write failure rather than failing the run', async () => {
        // No such workflow run — the FK rejects the insert. A broken audit trail
        // must never turn a green gate into a parked run (see the service header).
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await expect(
            recordGateResult({ workflow_run_id: 'nope', script_id: 'coder-tests-green', verdict: 'pass' }),
        ).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();

        const rows = await testDb.selectFrom('run_gate_results').selectAll().execute();
        expect(rows).toHaveLength(0);
    });
});

describe('listGateResultsForRun', () => {
    it('returns a run\'s verdicts oldest first, with ISO timestamps', async () => {
        await seedRun('r1');
        await recordGateResult({ workflow_run_id: 'r1', node_id: 'gate-hygiene', script_id: 'gate-hygiene', verdict: 'pass' });
        await recordGateResult({
            workflow_run_id: 'r1',
            node_id: 'gate-coverage',
            script_id: 'gate-coverage',
            verdict: 'skipped',
            output_tail: 'gate-coverage: skipped - no coverage script declared',
        });
        const rows = await listGateResultsForRun('r1');
        expect(rows.map((r) => [r.script_id, r.verdict])).toEqual([
            ['gate-hygiene', 'pass'],
            ['gate-coverage', 'skipped'],
        ]);
        // pg hands back a Date for timestamptz; the API speaks ISO strings.
        expect(rows[0]!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    // The whole point of surfacing this: on the golden set `gate-visual`
    // reported a pass on the one fixture built to exercise it, because the row
    // said `skipped` in its output and `pass` in its verdict.
    it('keeps a skip distinguishable from a pass', async () => {
        await seedRun('r1');
        await recordGateResult({
            workflow_run_id: 'r1',
            script_id: 'gate-visual',
            verdict: 'skipped',
            output_tail: 'gate-visual: skipped - no UI files changed and no markup added',
        });
        const [row] = await listGateResultsForRun('r1');
        expect(row!.verdict).toBe('skipped');
        expect(row!.verdict).not.toBe('pass');
        expect(row!.output_tail).toContain('no UI files changed');
    });

    it('does not leak another run\'s verdicts', async () => {
        await seedRun('r1');
        await seedRun2('r2');
        await recordGateResult({ workflow_run_id: 'r1', script_id: 'gate-hygiene', verdict: 'pass' });
        await recordGateResult({ workflow_run_id: 'r2', script_id: 'gate-perf', verdict: 'fail' });
        expect((await listGateResultsForRun('r1')).map((r) => r.script_id)).toEqual(['gate-hygiene']);
    });

    it('returns an empty list for a run that ran no gates', async () => {
        await seedRun('r1');
        expect(await listGateResultsForRun('r1')).toEqual([]);
    });
});
