import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { cacheSavings, spendInsight } from './analytics-spend.js';
import { resolveWindow } from './analytics-window.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';

// The Spend tab's trends and cost efficiency over hand-built runs. Clock
// pinned to 2026-10-16 06:30Z; 7d in UTC = Oct 10 00:00Z → now, previous =
// Oct 3 → Oct 10. Prices: claude-opus-5-5 saves $3.80 per 1M cached tokens
// ($4 input − $0.20 cache read), claude-sonnet-5-5 $1.80; gpt-5 has no price.

const NOW = new Date('2026-10-16T06:30:00Z');
const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
let seq = 0;

async function workflow(id: string, name: string): Promise<void> {
    await testDb
        .insertInto('workflows')
        .values({ id, project_id: 'p1', name, graph: JSON.stringify({ nodes: [], edges: [] }), input_kind: 'item', trigger: 'manual' } as never)
        .execute();
}

async function run(id: string, wf: string, item: string, started: string, prs: { urls?: string[]; legacy?: string; parent?: string } = {}) {
    await testDb
        .insertInto('workflow_runs')
        .values({
            id, workflow_id: wf, project_id: 'p1', item_id: item, status: 'completed',
            graph_snapshot: JSON.stringify({ nodes: [], edges: [] }), started_at: started,
            pr_urls: JSON.stringify(prs.urls ?? []), pr_url: prs.legacy ?? null,
            ...(prs.parent ? { parent_workflow_run_id: prs.parent } : {}),
        } as never)
        .execute();
}

async function step(over: { run: string | null; item: string | null; model: string; cost: number; at: string; input: number; cached: number }) {
    await testDb
        .insertInto('agent_runs')
        .values({
            id: `ar-${++seq}`, agent_id: 'agent-coder', project_id: 'p1', item_id: over.item, status: 'completed',
            workflow_run_id: over.run, node_id: `n${seq}`, outcome_kind: 'done', model: over.model, cli: 'claude',
            total_cost_usd: over.cost, input_tokens: over.input, cache_read_tokens: over.cached,
            created_at: over.at, started_at: over.at, completed_at: over.at,
        } as never)
        .execute();
}

beforeEach(async () => {
    seq = 0;
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', status: 'active' });
    await workflow('wf-d', 'Delivery');
    await workflow('wf-b', 'Build');
});

afterAll(async () => {
    await closeTestDb();
});

describe('cacheSavings', () => {
    it('prices cached tokens per model and leaves unpriced models out', () => {
        const s = cacheSavings([
            { model: OPUS, cache_read_tokens: 1_000_000 },
            { model: 'gpt-5', cache_read_tokens: 500 },
            { model: null, cache_read_tokens: 7 },
        ]);
        expect(s.usd).toBeCloseTo(3.8, 12);
        expect(s.unpriced).toBe(507);
    });
});

describe('spendInsight', () => {
    it('answers an empty workspace with zero spend and no unit costs', async () => {
        const s = await spendInsight(await resolveWindow('UTC', '7d', NOW));
        expect(s.buckets).toHaveLength(7);
        expect(s.trends.spend).toEqual({ cur: 0, prev: 0, series: Array(7).fill(0) });
        expect(s.trends.cost_per_task).toEqual({ cur: null, prev: null, series: Array(7).fill(null) });
        expect(s.trends.cache_hit_rate.cur).toBeNull();
        expect(s.cost_efficiency).toEqual({ by_workflow: [], by_model: [] });
    });

    it('trends spend, unit cost and cache, and breaks run cost down per PR and per shipped Task', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', status: 'done' });
        await insertItem({ id: 'ATL-2', type: 'task', project_id: 'p1' });
        await insertItem({ id: 'TST-1', type: 'task', project_id: 'p1' });
        await testDb.updateTable('items').set({ is_test: true } as never).where('id', '=', 'TST-1').execute();
        await testDb
            .insertInto('issue_events')
            .values({ item_id: 'ATL-1', event_type: 'status_changed', field: 'status', from_value: 'draft', to_value: 'done', created_at: '2026-10-12T00:00:00Z' } as never)
            .execute();

        // Delivery: r1 (ATL-1, two PRs, a sub-task run c1), r2 (ATL-2, one legacy PR).
        // Build: r3 (no steps, no PR). rt is an agent test's run.
        await run('r1', 'wf-d', 'ATL-1', '2026-10-11T00:00:00Z', { urls: ['u1', 'u2'] });
        await run('c1', 'wf-d', 'ATL-1', '2026-10-11T00:30:00Z', { parent: 'r1' });
        await run('r2', 'wf-d', 'ATL-2', '2026-10-13T00:00:00Z', { legacy: 'u3' });
        await run('r3', 'wf-b', 'ATL-2', '2026-10-14T00:00:00Z');
        await run('rt', 'wf-d', 'TST-1', '2026-10-11T00:00:00Z', { urls: ['u9'] });

        await step({ run: 'r1', item: 'ATL-1', model: OPUS, cost: 2, at: '2026-10-11T01:00:00Z', input: 1000, cached: 1_000_000 });
        await step({ run: 'c1', item: 'ATL-1', model: SONNET, cost: 1, at: '2026-10-11T02:00:00Z', input: 1000, cached: 1_000_000 });
        await step({ run: 'r2', item: 'ATL-2', model: SONNET, cost: 0.5, at: '2026-10-13T01:00:00Z', input: 2000, cached: 0 });
        await step({ run: 'rt', item: 'TST-1', model: OPUS, cost: 9, at: '2026-10-11T01:00:00Z', input: 1, cached: 1 });
        // Last week: a standalone run (no item) is real spend.
        await step({ run: null, item: null, model: SONNET, cost: 4, at: '2026-10-05T01:00:00Z', input: 1000, cached: 0 });
        await testDb
            .insertInto('cli_sessions')
            .values({
                id: 'cs-1', project_id: 'p1', title: 'S', status: 'closed', model: 'gpt-5', cli: 'copilot',
                closed_at: '2026-10-12T05:00:00Z', total_cost_usd: 1.5, cache_read_tokens: 500,
            } as never)
            .execute();

        const s = await spendInsight(await resolveWindow('UTC', '7d', NOW));

        // $2 + $1 + $0.50 agent runs + $1.50 terminal; last week $4.
        expect(s.trends.spend).toEqual({ cur: 5, prev: 4, series: [0, 3, 1.5, 0.5, 0, 0, 0] });
        // One Task shipped (ATL-1, Oct 12); none last week.
        expect(s.trends.cost_per_task).toEqual({ cur: 5, prev: null, series: [null, null, 1.5, null, null, null, null] });
        // 1M opus × $3.80 + 1M sonnet × $1.80; the gpt-5 session is unpriced.
        expect(s.trends.cache_savings.cur).toBeCloseTo(5.6, 12);
        expect(s.trends.cache_savings.prev).toBe(0);
        expect(s.trends.cache_savings.series.map((v) => Number((v ?? NaN).toFixed(6)))).toEqual([0, 5.6, 0, 0, 0, 0, 0]);
        // Agent runs only: 2M cached of 2M + 4000 fresh input.
        expect(s.trends.cache_hit_rate.cur).toBeCloseTo(2_000_000 / 2_004_000, 12);
        expect(s.trends.cache_hit_rate.prev).toBe(0);
        expect(s.trends.cache_hit_rate.series).toEqual([null, 2_000_000 / 2_002_000, null, 0, null, null, null]);

        expect(s.cost_efficiency.by_workflow).toEqual([
            { workflow_id: 'wf-b', name: 'Build', runs: 1, cost_usd: 0, prs: 0, shipped_tasks: 0, per_pr_usd: null, per_task_usd: null },
            // r1 tree $3 + r2 $0.50 over 3 PRs and one shipped Task.
            { workflow_id: 'wf-d', name: 'Delivery', runs: 2, cost_usd: 3.5, prs: 3, shipped_tasks: 1, per_pr_usd: 3.5 / 3, per_task_usd: 3.5 },
        ]);
        // Most spend first. Sonnet worked in r1 (2 PRs, shipped) and r2 (1 PR).
        expect(s.cost_efficiency.by_model).toEqual([
            { model: OPUS, cli: 'claude', runs: 1, cost_usd: 2, prs: 2, shipped_tasks: 1, per_pr_usd: 1, per_task_usd: 2 },
            { model: SONNET, cli: 'claude', runs: 2, cost_usd: 1.5, prs: 3, shipped_tasks: 1, per_pr_usd: 0.5, per_task_usd: 1.5 },
        ]);
    });
});
