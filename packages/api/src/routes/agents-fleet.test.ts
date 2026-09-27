import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({ eventsRoutes: async () => undefined, broadcastSSE: vi.fn() }));

import { sql } from 'kysely';
import { buildApp } from '../server.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';
import type { FleetPerformance, ProjectHealth } from '../services/agent-scorecard.js';

// GET /api/agents/performance — the fleet comparison and what it delivered.
//
// The intervention counts only cover runs that started after migration 024
// began recording parks. This test DB may have been migrated seconds ago, so
// the recording start is moved a day back once, and runs are seeded relative
// to now rather than on a fixed date.

let app: FastifyInstance;
let seq = 0;
// One clock for the whole file, so durations between seeded rows are exact.
const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

async function run(over: {
    id: string;
    item?: string | null;
    project?: string;
    parent?: string;
    prs?: string[];
    startedMinAgo?: number;
    finishedMinAgo?: number;
}): Promise<void> {
    await testDb
        .insertInto('workflow_runs')
        .values({
            id: over.id,
            workflow_id: 'wf-1',
            project_id: over.project ?? 'p1',
            item_id: over.item ?? null,
            status: 'completed',
            graph_snapshot: JSON.stringify({ nodes: [], edges: [] }),
            started_at: minutesAgo(over.startedMinAgo ?? 60),
            ...(over.finishedMinAgo !== undefined ? { finished_at: minutesAgo(over.finishedMinAgo) } : {}),
            ...(over.parent ? { parent_workflow_run_id: over.parent } : {}),
            ...(over.prs ? { pr_urls: JSON.stringify(over.prs), pr_url: over.prs[0] ?? null } : {}),
        } as never)
        .execute();
}

async function step(over: {
    run: string;
    agent?: string;
    node?: string;
    status?: string;
    outcome?: 'done' | 'rejected' | 'asked_question';
    cost?: number;
}): Promise<void> {
    const started = new Date(NOW - 30 * 60_000);
    await testDb
        .insertInto('agent_runs')
        .values({
            id: `ar-${++seq}`,
            agent_id: over.agent ?? 'agent-coder',
            project_id: 'p1',
            status: over.status ?? 'completed',
            workflow_run_id: over.run,
            node_id: over.node ?? `n${seq}`,
            outcome_kind: over.outcome ?? 'done',
            total_cost_usd: over.cost ?? 1,
            started_at: started.toISOString(),
            completed_at: new Date(started.getTime() + 60_000).toISOString(),
        } as never)
        .execute();
}

async function prLink(item: string, url: string, state: 'open' | 'merged' | 'closed' | null, minAgo = 40): Promise<void> {
    await testDb
        .insertInto('item_external_links')
        .values({ item_id: item, link_kind: 'pull_request', url, pr_state: state, created_at: minutesAgo(minAgo) } as never)
        .execute();
}

async function parkedEvent(runId: string, item: string | null): Promise<void> {
    await testDb
        .insertInto('workflow_run_events')
        .values({ id: `ev-${++seq}`, workflow_run_id: runId, item_id: item, kind: 'parked', reason: 'asked' })
        .execute();
}

async function fleet(query = ''): Promise<FleetPerformance> {
    const res = await app.inject({ method: 'GET', url: `/api/agents/performance${query}` });
    expect(res.statusCode).toBe(200);
    return res.json<FleetPerformance>();
}

beforeAll(async () => {
    await sql`UPDATE _knex_migrations SET migration_time = now() - interval '1 day' WHERE name LIKE '024\_%'`.execute(testDb);
});

beforeEach(async () => {
    seq = 0;
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', name: 'Coder', status: 'active' });
    await insertAgent({ id: 'agent-reviewer', name: 'Anna Reviewer', status: 'active' });
    await testDb
        .insertInto('workflows')
        .values({
            id: 'wf-1',
            project_id: 'p1',
            name: 'Delivery',
            graph: JSON.stringify({ nodes: [], edges: [] }),
            input_kind: 'item',
            trigger: 'manual',
        } as never)
        .execute();
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('GET /api/agents/performance', () => {
    it('answers an empty fleet with zeros and nulls, not an error', async () => {
        const body = await fleet();
        expect(body.agents).toEqual([]);
        expect(body.delivery).toMatchObject({
            runs: 0,
            prs_opened: 0,
            prs_merged: 0,
            merge_rate: null,
            cost_per_merged_task_usd: null,
            median_s_to_pr: null,
            interventions: { parked: 0, tasks: 0, per_task: null },
        });
        // The start of the intervention series is stated even with no data.
        expect(body.delivery.interventions.since).not.toBeNull();
    });

    it('refuses a window the page does not offer', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/agents/performance?days=7' });
        expect(res.statusCode).toBe(400);
    });

    it('honours the 30-day window', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1' });
        await run({ id: 'wr-old', item: 'ATL-1', startedMinAgo: 45 * 24 * 60 });
        await step({ run: 'wr-old' });
        expect((await fleet('?days=30')).agents).toEqual([]);
        expect((await fleet('?days=90')).agents).toHaveLength(1);
    });

    // ADR 0023: a comparison, never a ranking. Sorted by name, and the rows
    // carry the three-way split rather than a single success number.
    it('returns one row per agent, sorted by name, with no pass rate in it', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1' });
        await run({ id: 'wr-1', item: 'ATL-1' });
        await step({ run: 'wr-1', agent: 'agent-coder', outcome: 'done', cost: 2 });
        await step({ run: 'wr-1', agent: 'agent-coder', outcome: 'done', cost: 4 });
        await step({ run: 'wr-1', agent: 'agent-reviewer', outcome: 'rejected', cost: 1 });

        const body = await fleet();
        expect(body.agents.map((a) => a.name)).toEqual(['Anna Reviewer', 'Coder']);
        const coder = body.agents.find((a) => a.agent_id === 'agent-coder');
        expect(coder).toMatchObject({
            quality: { steps: 2, first_pass: { applied: 2, rejected: 0, parked: 0 } },
            cost: { total_usd: 6, per_step_usd: 3 },
            latency: { p95_s: 60 },
        });
        expect(coder?.trend).toHaveLength(1);
        expect(body.agents[0]?.quality.first_pass).toEqual({ applied: 0, rejected: 1, parked: 0 });
        expect(JSON.stringify(body)).not.toMatch(/pass_at_1|pass_rate/);
    });

    it('counts PRs opened and merged, and prices each merge with every step of its run tree', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1' });
        await insertItem({ id: 'ATL-2', type: 'task', project_id: 'p1' });
        await insertItem({ id: 'ATL-3', type: 'task', project_id: 'p1' });
        // Merged: $2 on the Task run, a FAILED $3 step, and $5 on a sub-task run.
        await run({ id: 'wr-1', item: 'ATL-1', prs: ['https://github.com/o/r/pull/1'], startedMinAgo: 60 });
        await run({ id: 'wr-1c', item: null, parent: 'wr-1' });
        await step({ run: 'wr-1', cost: 2 });
        await step({ run: 'wr-1', cost: 3, status: 'error' });
        await step({ run: 'wr-1c', cost: 5 });
        await prLink('ATL-1', 'https://github.com/o/r/pull/1', 'merged', 40);
        // Opened, still open: counted as opened, not merged, and not priced in.
        await run({ id: 'wr-2', item: 'ATL-2', prs: ['https://github.com/o/r/pull/2'], startedMinAgo: 60 });
        await step({ run: 'wr-2', cost: 100 });
        await prLink('ATL-2', 'https://github.com/o/r/pull/2', 'open', 20);
        // No PR at all.
        await run({ id: 'wr-3', item: 'ATL-3' });
        await step({ run: 'wr-3', cost: 7 });

        const { delivery } = await fleet();
        expect(delivery.runs).toBe(3);
        expect(delivery.prs_opened).toBe(2);
        expect(delivery.prs_merged).toBe(1);
        expect(delivery.tasks_merged).toBe(1);
        expect(delivery.merge_rate).toBe(0.5);
        expect(delivery.merged_cost_usd).toBe(10);
        expect(delivery.cost_per_merged_task_usd).toBe(10);
        // 20 min to PR 1 and 40 to PR 2; the lower median.
        expect(delivery.median_s_to_pr).toBe(1200);
    });

    // ADR 0017: a multi-repo Task opens one PR per repo, and they only make
    // sense merged together. Dividing by PRs halved the price of every
    // two-repo delivery; the unit is the Task.
    it('prices a multi-repo Task once, and only when every one of its PRs merged', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1' });
        await insertItem({ id: 'ATL-2', type: 'task', project_id: 'p1' });
        const both = ['https://github.com/o/api/pull/1', 'https://github.com/o/web/pull/1'];
        await run({ id: 'wr-1', item: 'ATL-1', prs: both, startedMinAgo: 60 });
        await step({ run: 'wr-1', cost: 12 });
        await prLink('ATL-1', both[0]!, 'merged', 40);
        await prLink('ATL-1', both[1]!, 'merged', 40);
        // Half merged: its merged PR counts, the Task is not delivered yet.
        const half = ['https://github.com/o/api/pull/2', 'https://github.com/o/web/pull/2'];
        await run({ id: 'wr-2', item: 'ATL-2', prs: half, startedMinAgo: 60 });
        await step({ run: 'wr-2', cost: 50 });
        await prLink('ATL-2', half[0]!, 'merged', 40);
        await prLink('ATL-2', half[1]!, 'open', 40);

        const { delivery } = await fleet();
        expect(delivery.prs_opened).toBe(4);
        expect(delivery.prs_merged).toBe(3);
        expect(delivery.tasks_merged).toBe(1);
        expect(delivery.merged_cost_usd).toBe(12);
        expect(delivery.cost_per_merged_task_usd).toBe(12);
    });

    // A run whose link write failed still opened its PR right before finishing.
    it('falls back to the run’s finish time when the PR link is missing', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1' });
        await run({ id: 'wr-1', item: 'ATL-1', prs: ['https://github.com/o/r/pull/9'], startedMinAgo: 60, finishedMinAgo: 50 });
        await step({ run: 'wr-1' });
        const { delivery } = await fleet();
        expect(delivery).toMatchObject({ prs_opened: 1, prs_merged: 0, median_s_to_pr: 600 });
    });

    // Migration 016: an agent test's throwaway Task is not a delivery.
    it('leaves agent-test items out of the delivery numbers', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1' });
        await testDb.updateTable('items').set({ is_test: true }).where('id', '=', 'ATL-1').execute();
        await run({ id: 'wr-1', item: 'ATL-1', prs: ['https://github.com/o/r/pull/1'] });
        await step({ run: 'wr-1', cost: 9 });
        await prLink('ATL-1', 'https://github.com/o/r/pull/1', 'merged');
        await parkedEvent('wr-1', 'ATL-1');

        const { delivery } = await fleet();
        expect(delivery).toMatchObject({
            runs: 0,
            prs_opened: 0,
            prs_merged: 0,
            interventions: { parked: 0, tasks: 0 },
        });
    });

    it('reports Owner interventions per Task from the park history', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1' });
        await insertItem({ id: 'ATL-2', type: 'task', project_id: 'p1' });
        await insertItem({ id: 'ATL-3', type: 'task', project_id: 'p1' });
        await run({ id: 'wr-1', item: 'ATL-1' });
        await run({ id: 'wr-1c', item: null, parent: 'wr-1' });
        await run({ id: 'wr-2', item: 'ATL-2' });
        // Started before recording began: it may have parked unrecorded, so
        // it is in neither count.
        await run({ id: 'wr-3', item: 'ATL-3', startedMinAgo: 3 * 24 * 60 });
        await parkedEvent('wr-3', 'ATL-3');
        await step({ run: 'wr-1' });
        await parkedEvent('wr-1', 'ATL-1');
        await parkedEvent('wr-1', 'ATL-1');
        await parkedEvent('wr-2', 'ATL-2');
        // A sub-task's own park duplicates the one written for its Task run.
        await parkedEvent('wr-1c', null);

        const { delivery } = await fleet();
        expect(delivery.interventions).toMatchObject({ parked: 3, parked_tasks: 2, tasks: 2, per_task: 1.5 });
    });
});

// GET /api/projects/:id/health — the Project page's Health card. The delivery
// maths is the fleet's (tested above); these pin the project scoping, the
// 30-day window, and the one number only this card has.
describe('GET /api/projects/:id/health', () => {
    async function health(project = 'p1'): Promise<ProjectHealth> {
        const res = await app.inject({ method: 'GET', url: `/api/projects/${project}/health` });
        expect(res.statusCode).toBe(200);
        return res.json<ProjectHealth>();
    }

    it('404s for an unknown project', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/projects/nope/health' });
        expect(res.statusCode).toBe(404);
    });

    it('answers a quiet project with zeros and nulls', async () => {
        expect(await health()).toMatchObject({
            runs: 0,
            prs_opened: 0,
            prs_merged: 0,
            tasks_merged: 0,
            median_s_to_pr: null,
            specs: { reviewed: 0, accepted_first_try: 0 },
            escalations: { items: 0, pauses: 0 },
        });
    });

    it('counts only this project, inside 30 days', async () => {
        await insertProject('p2', 'OTH');
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1' });
        await insertItem({ id: 'ATL-2', type: 'task', project_id: 'p1' });
        await insertItem({ id: 'OTH-1', type: 'task', project_id: 'p2' });
        await run({ id: 'wr-1', item: 'ATL-1', prs: ['https://github.com/o/r/pull/1'] });
        await prLink('ATL-1', 'https://github.com/o/r/pull/1', 'merged', 30);
        await parkedEvent('wr-1', 'ATL-1');
        await parkedEvent('wr-1', 'ATL-1');
        // Another project's run, and this project's run from 45 days ago.
        await run({ id: 'wr-o', item: 'OTH-1', project: 'p2', prs: ['https://github.com/o/r/pull/9'] });
        await prLink('OTH-1', 'https://github.com/o/r/pull/9', 'merged', 30);
        await run({ id: 'wr-old', item: 'ATL-2', startedMinAgo: 45 * 24 * 60 });

        expect(await health()).toMatchObject({
            runs: 1,
            prs_opened: 1,
            prs_merged: 1,
            tasks_merged: 1,
            median_s_to_pr: 1800,
            escalations: { items: 1, pauses: 2 },
        });
    });

    // A spec is "accepted first try" when the Architect Reviewer's FIRST look
    // at it approves. A later approval after a rejection is not a first try.
    it('counts specs by the Architect Reviewer’s first look, matched on its catalog id too', async () => {
        await insertAgent({ id: 'my-spec-reviewer', name: 'Spec Reviewer', status: 'active' });
        await testDb
            .updateTable('agents')
            .set({ marketplace_source_id: 'agent-architect-reviewer' })
            .where('id', '=', 'my-spec-reviewer')
            .execute();
        for (const id of ['ATL-1', 'ATL-2', 'ATL-3']) await insertItem({ id, type: 'task', project_id: 'p1' });
        await run({ id: 'wr-1', item: 'ATL-1' });
        await step({ run: 'wr-1', agent: 'my-spec-reviewer', node: 'architect-review', outcome: 'done' });
        await run({ id: 'wr-2', item: 'ATL-2' });
        await step({ run: 'wr-2', agent: 'my-spec-reviewer', node: 'architect-review', outcome: 'rejected' });
        await step({ run: 'wr-2', agent: 'my-spec-reviewer', node: 'architect-review', outcome: 'done' });
        // No spec review at all: not in either count.
        await run({ id: 'wr-3', item: 'ATL-3' });
        await step({ run: 'wr-3', agent: 'agent-coder' });

        expect((await health()).specs).toEqual({ reviewed: 2, accepted_first_try: 1 });
    });
});

