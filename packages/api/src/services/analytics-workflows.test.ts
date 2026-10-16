import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import type { WorkflowParkKind } from '@atlas/shared';
import { workflowAnalytics } from './analytics-workflows.js';
import { fleetPerformance } from './agent-scorecard.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';

// Workflow analytics over hand-built runs. Clock pinned to 2026-10-16 06:30Z;
// window 7d in UTC = Oct 10 00:00Z → now, previous = Oct 3 → Oct 10.

const NOW = new Date('2026-10-16T06:30:00Z');
let seq = 0;

async function workflow(id: string, name: string): Promise<void> {
    await testDb
        .insertInto('workflows')
        .values({ id, project_id: 'p1', name, graph: JSON.stringify({ nodes: [], edges: [] }), input_kind: 'item', trigger: 'manual' } as never)
        .execute();
}

async function run(
    id: string,
    over: {
        wf?: string;
        status: string;
        started: string;
        finished?: string;
        item?: string;
        parent?: string;
        loops?: number;
        gateRounds?: number;
    },
): Promise<void> {
    await testDb
        .insertInto('workflow_runs')
        .values({
            id,
            workflow_id: over.wf ?? 'wf-d',
            project_id: 'p1',
            item_id: over.item ?? null,
            status: over.status,
            graph_snapshot: JSON.stringify({ nodes: [], edges: [] }),
            started_at: over.started,
            finished_at: over.finished ?? null,
            loop_count: over.loops ?? 0,
            gate_rounds: over.gateRounds ?? 0,
            ...(over.parent ? { parent_workflow_run_id: over.parent } : {}),
        } as never)
        .execute();
}

async function step(run: string, over: { agent?: string; cost: number; at: string; parent?: string; item?: string }): Promise<string> {
    const id = `ar-${++seq}`;
    await testDb
        .insertInto('agent_runs')
        .values({
            id,
            agent_id: over.agent ?? 'agent-coder',
            project_id: 'p1',
            item_id: over.item ?? null,
            status: 'completed',
            workflow_run_id: run,
            node_id: `n${seq}`,
            outcome_kind: 'done',
            total_cost_usd: over.cost,
            created_at: over.at,
            started_at: over.at,
            completed_at: over.at,
            ...(over.parent ? { parent_run_id: over.parent } : {}),
        } as never)
        .execute();
    return id;
}

async function gate(run: string, verdict: string, at = '2026-10-12T00:30:00Z', script = 's'): Promise<void> {
    await testDb
        .insertInto('run_gate_results')
        .values({ id: `g-${++seq}`, workflow_run_id: run, script_id: script, verdict, created_at: at } as never)
        .execute();
}

async function parked(run: string, kind: WorkflowParkKind, reason = 'prose', at = '2026-10-12T00:20:00Z'): Promise<void> {
    await testDb
        .insertInto('workflow_run_events')
        .values({ id: `ev-${++seq}`, workflow_run_id: run, kind: 'parked', park_kind: kind, reason, created_at: at } as never)
        .execute();
}

beforeEach(async () => {
    seq = 0;
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', name: 'Coder', status: 'active' });
    await insertAgent({ id: 'agent-reviewer', name: 'Anna Reviewer', status: 'active' });
    await insertAgent({ id: 'agent-tester', name: 'Tester', status: 'active' });
    await workflow('wf-d', 'Delivery');
    await workflow('wf-b', 'Build');
});

afterAll(async () => {
    await closeTestDb();
});

describe('workflowAnalytics', () => {
    it('answers no runs with zeros and nulls', async () => {
        const w = await workflowAnalytics({ tz: 'UTC', window: '7d', now: NOW });
        expect(w.runs).toEqual({ total: 0, completed: 0, cancelled: 0, error: 0, waiting_for_owner: 0, running: 0, success_rate: null });
        expect(w.by_workflow).toEqual([]);
        expect(w.gates.pass_rate).toBeNull();
        expect(w.park_reasons).toEqual([]);
        expect(w.retries).toEqual({ retries: 0, dispatches: 0, rate: null });
        expect(w.agents).toEqual([]);
        expect(w.previous).toEqual({ runs: 0, success_rate: null });
        expect(w.retries_per_task).toEqual({ retries: 0, tasks: 0, rate: null });
        expect(w.gate_failures).toEqual([]);
        expect(w.buckets).toHaveLength(7);
        expect(w.trends.success_rate).toEqual({ cur: null, prev: null, series: Array(7).fill(null) });
        expect(w.trends.runs).toEqual({ cur: 0, prev: 0, series: Array(7).fill(0) });
    });

    it('measures retries per Task, the red checks by script, and every tile trend', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1' });
        await insertItem({ id: 'ATL-2', type: 'sub_task', project_id: 'p1', parent_id: 'ATL-1', parent_type: 'task' });
        await insertItem({ id: 'ATL-3', type: 'task', project_id: 'p1' });
        await run('r1', { status: 'completed', started: '2026-10-12T00:00:00Z', item: 'ATL-1' });
        await run('r2', { status: 'error', started: '2026-10-13T00:00:00Z', item: 'ATL-3' });
        await run('p1', { status: 'completed', started: '2026-10-05T00:00:00Z' });

        // ATL-1 is worked twice (once through its sub-task, a retry); ATL-3 retried once.
        const s1 = await step('r1', { cost: 1, at: '2026-10-12T00:05:00Z', item: 'ATL-1' });
        await step('r1', { cost: 1, at: '2026-10-12T00:10:00Z', item: 'ATL-2', parent: s1 });
        const s3 = await step('r2', { cost: 1, at: '2026-10-13T00:05:00Z', item: 'ATL-3' });
        await step('r2', { cost: 1, at: '2026-10-13T00:10:00Z', item: 'ATL-3', parent: s3 });
        await step('p1', { cost: 1, at: '2026-10-05T00:05:00Z' });

        await gate('r1', 'fail', '2026-10-12T00:30:00Z', 'tests');
        await gate('r1', 'fail', '2026-10-12T01:00:00Z', 'tests');
        await gate('r1', 'pass', '2026-10-12T01:30:00Z', 'tests');
        await gate('r1', 'fail', '2026-10-13T01:00:00Z', 'lint');
        await gate('r2', 'fail', '2026-10-13T02:00:00Z', 'tests');
        await gate('p1', 'fail', '2026-10-05T02:00:00Z', 'tests');

        const w = await workflowAnalytics({ tz: 'UTC', window: '7d', now: NOW });

        expect(w.retries_per_task).toEqual({ retries: 2, tasks: 2, rate: 1 });
        // Most failures first; `runs` counts the run trees that went red.
        expect(w.gate_failures).toEqual([
            { script_id: 'tests', name: 'tests', failures: 3, runs: 2, last_at: '2026-10-13T02:00:00.000Z' },
            { script_id: 'lint', name: 'lint', failures: 1, runs: 1, last_at: '2026-10-13T01:00:00.000Z' },
        ]);

        // Buckets Oct 10 … Oct 16 (UTC days). Previous window: p1 (completed), one red check, no retry.
        expect(w.buckets).toEqual(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
        expect(w.trends.runs).toEqual({ cur: 2, prev: 1, series: [0, 0, 1, 1, 0, 0, 0] });
        expect(w.trends.success_rate).toEqual({ cur: 0.5, prev: 1, series: [null, null, 1, 0, null, null, null] });
        // Oct 12: 1 pass of 3; Oct 13: 0 of 2.
        expect(w.trends.gate_pass_rate).toEqual({ cur: 0.2, prev: 0, series: [null, null, 1 / 3, 0, null, null, null] });
        expect(w.trends.retries).toEqual({ cur: 2, prev: 0, series: [0, 0, 1, 1, 0, 0, 0] });
        expect(w.trends.retries_per_task).toEqual({ cur: 1, prev: null, series: [null, null, 1, 1, null, null, null] });
    });

    it('computes outcomes, per-workflow rows, gates, parks, retries and agent rows', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1' });
        await insertItem({ id: 'TST-1', type: 'task', project_id: 'p1' });
        await testDb.updateTable('items').set({ is_test: true } as never).where('id', '=', 'TST-1').execute();

        // Delivery: r1 completed in 1h with one loop and a sub-task run c1;
        // r2 error, r3 cancelled, r4 waiting for you.
        await run('r1', { status: 'completed', started: '2026-10-12T00:00:00Z', finished: '2026-10-12T01:00:00Z', loops: 1, item: 'ATL-1' });
        await run('c1', { status: 'completed', started: '2026-10-12T00:10:00Z', parent: 'r1' });
        await run('r2', { status: 'error', started: '2026-10-13T00:00:00Z' });
        await run('r3', { status: 'cancelled', started: '2026-10-13T01:00:00Z' });
        await run('r4', { status: 'waiting_for_owner', started: '2026-10-14T00:00:00Z' });
        // Build: one 30-minute run, two gate rounds, no steps.
        await run('r5', { wf: 'wf-b', status: 'completed', started: '2026-10-14T00:00:00Z', finished: '2026-10-14T00:30:00Z', gateRounds: 2 });
        // An agent test's run, and two previous-window runs.
        await run('rt', { status: 'completed', started: '2026-10-12T00:00:00Z', finished: '2026-10-12T00:05:00Z', item: 'TST-1' });
        await run('p1', { status: 'completed', started: '2026-10-05T00:00:00Z', finished: '2026-10-05T01:00:00Z' });
        await run('p2', { status: 'error', started: '2026-10-06T00:00:00Z' });

        // Cost: r1 $1 + its sub-task run $2, r2 $0.5. c1's step retried r1's.
        const a1 = await step('r1', { cost: 1, at: '2026-10-12T00:05:00Z' });
        await step('c1', { agent: 'agent-reviewer', cost: 2, at: '2026-10-12T00:15:00Z', parent: a1 });
        await step('r2', { cost: 0.5, at: '2026-10-13T00:05:00Z' });

        await gate('r1', 'pass');
        await gate('r1', 'fail');
        await gate('c1', 'pass');
        await gate('r5', 'unavailable');
        await gate('rt', 'fail');
        await gate('r1', 'fail', '2026-10-05T00:00:00Z');

        // A sub-task's park (c1) and the Task run's copy of it (r1); the copy
        // is skipped. A project-level run (r4, no item) counts; the test's doesn't.
        await parked('r4', 'checklist_failed');
        await parked('r1', 'loop_limit');
        await parked('c1', 'question', 'What colour?');
        await parked('r1', 'subtask_waiting', 'Sub-task ATL-9 is waiting for you: What colour?');
        await parked('r4', 'question', 'Should README.md stay in this change?');
        await parked('rt', 'checklist_failed');
        await parked('r2', 'delivery_failed', 'x', '2026-10-05T00:00:00Z');
        // The agent test's own step: out of the analytics agent rows, still on the fleet page.
        await step('rt', { agent: 'agent-tester', cost: 9, at: '2026-10-12T00:01:00Z', item: 'TST-1' });

        const w = await workflowAnalytics({ tz: 'UTC', window: '7d', now: NOW });

        // r1..r5: 2 completed of 4 finished (r4 is still waiting).
        expect(w.runs).toEqual({ total: 5, completed: 2, cancelled: 1, error: 1, waiting_for_owner: 1, running: 0, success_rate: 0.5 });
        expect(w.previous).toEqual({ runs: 2, success_rate: 0.5 });

        // Name order. Delivery: 1 of 3 finished; loops 1/4; ($1 + $2 + $0.5) / 4 runs.
        expect(w.by_workflow).toEqual([
            {
                workflow_id: 'wf-b', name: 'Build', runs: 1, completed: 1, success_rate: 1,
                median_duration_s: 1800, avg_loops: 0, avg_gate_rounds: 2, cost_per_run_usd: null,
            },
            {
                workflow_id: 'wf-d', name: 'Delivery', runs: 4, completed: 1, success_rate: 1 / 3,
                median_duration_s: 3600, avg_loops: 0.25, avg_gate_rounds: 0, cost_per_run_usd: 0.875,
            },
        ]);

        // r1 pass + fail, c1 pass, r5 unavailable; the test run and last week's are out.
        expect(w.gates).toEqual({ pass: 2, fail: 1, unavailable: 1, needs_review: 0, pass_rate: 2 / 3 });

        // c1's own park is the child's copy; the Task run's carries it behind a prefix.
        expect(w.park_reasons).toEqual([
            { kind: 'question', reason: 'Agent asked you', count: 2 },
            { kind: 'checklist_failed', reason: 'Required checklist failed', count: 1 },
            { kind: 'loop_limit', reason: 'Loop limit reached', count: 1 },
        ]);

        expect(w.retries).toEqual({ retries: 1, dispatches: 3, rate: 1 / 3 });

        // Name order, not volume: Anna Reviewer (1 step) before Coder (2).
        expect(w.agents.map((a) => [a.name, a.steps])).toEqual([
            ['Anna Reviewer', 1],
            ['Coder', 2],
        ]);
        expect(w.agents[1]).toMatchObject({ cost_usd: 1.5, per_step_usd: 0.75, first_pass: { applied: 2, rejected: 0, parked: 0 } });

        // The Fleet performance page keeps agent-test runs (its documented default).
        const fleet = await fleetPerformance({ since: w.period.start, until: w.period.end });
        expect(fleet.agents.map((a) => a.name)).toEqual(['Anna Reviewer', 'Coder', 'Tester']);
    });
});
