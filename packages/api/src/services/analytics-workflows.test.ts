import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { workflowAnalytics } from './analytics-workflows.js';
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

async function step(run: string, over: { agent?: string; cost: number; at: string; parent?: string }): Promise<string> {
    const id = `ar-${++seq}`;
    await testDb
        .insertInto('agent_runs')
        .values({
            id,
            agent_id: over.agent ?? 'agent-coder',
            project_id: 'p1',
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

async function gate(run: string, verdict: string, at = '2026-10-12T00:30:00Z'): Promise<void> {
    await testDb
        .insertInto('run_gate_results')
        .values({ id: `g-${++seq}`, workflow_run_id: run, script_id: 's', verdict, created_at: at } as never)
        .execute();
}

async function parked(run: string, reason: string, at = '2026-10-12T00:20:00Z'): Promise<void> {
    await testDb
        .insertInto('workflow_run_events')
        .values({ id: `ev-${++seq}`, workflow_run_id: run, kind: 'parked', reason, created_at: at } as never)
        .execute();
}

beforeEach(async () => {
    seq = 0;
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', name: 'Coder', status: 'active' });
    await insertAgent({ id: 'agent-reviewer', name: 'Anna Reviewer', status: 'active' });
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

        await parked('r4', 'checklist_failed: tests added');
        await parked('r1', 'Loop limit reached (3): still red');
        await parked('c1', 'What colour?');
        await parked('r1', 'Sub-task ATL-9 is waiting for you: What colour?');
        await parked('r4', 'Should README.md stay in this change?');
        await parked('rt', 'checklist_failed: ignored, a test');

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
            { reason: 'Agent asked you', count: 2 },
            { reason: 'Loop limit reached', count: 1 },
            { reason: 'Required checklist failed', count: 1 },
        ]);

        expect(w.retries).toEqual({ retries: 1, dispatches: 3, rate: 1 / 3 });

        // Name order, not volume: Anna Reviewer (1 step) before Coder (2).
        expect(w.agents.map((a) => [a.name, a.steps])).toEqual([
            ['Anna Reviewer', 1],
            ['Coder', 2],
        ]);
        expect(w.agents[1]).toMatchObject({ cost_usd: 1.5, per_step_usd: 0.75, first_pass: { applied: 2, rejected: 0, parked: 0 } });
    });
});
