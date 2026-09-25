import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { agentPerformance, scoreAgents } from './agent-scorecard.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertProject } from '../../tests/_items.js';

// ADR 0023 phase 2 (ATL-140). The maths is `eval-score.ts`'s, moved — these
// cover the per-agent reshaping the page needs and the promises the ADR makes
// about how the numbers may be presented.

let seq = 0;

async function step(over: {
    agent?: string;
    run?: string;
    node?: string;
    outcome?: 'done' | 'rejected' | 'asked_question' | null;
    cost?: number;
    model?: string;
    effort?: string;
    seconds?: number;
    trace?: unknown;
}): Promise<string> {
    const id = `ar-${++seq}`;
    const started = new Date(Date.UTC(2026, 8, 21, 10, 0, 0));
    const finished = new Date(started.getTime() + (over.seconds ?? 60) * 1000);
    await testDb
        .insertInto('agent_runs')
        .values({
            id,
            agent_id: over.agent ?? 'agent-coder',
            project_id: 'p1',
            status: 'completed',
            workflow_run_id: over.run ?? 'wr-1',
            node_id: over.node ?? 'n1',
            outcome_kind: over.outcome === null ? null : (over.outcome ?? 'done'),
            total_cost_usd: over.cost ?? 1,
            model: over.model ?? 'claude-opus-5',
            effort: over.effort ?? 'high',
            started_at: started.toISOString(),
            completed_at: finished.toISOString(),
            ...(over.trace ? { trace_summary: JSON.stringify(over.trace) } : {}),
        } as never)
        .execute();
    return id;
}

async function workflowRun(id = 'wr-1', parent: string | null = null): Promise<void> {
    await testDb
        .insertInto('workflow_runs')
        .values({
            id,
            workflow_id: 'wf-1',
            project_id: 'p1',
            status: 'completed',
            graph_snapshot: JSON.stringify({ nodes: [], edges: [] }),
            started_at: new Date(Date.UTC(2026, 8, 21, 9, 0, 0)).toISOString(),
            ...(parent ? { parent_workflow_run_id: parent } : {}),
        } as never)
        .execute();
}

/** A deterministic gate verdict recorded against a run. */
async function gate(over: { run?: string; verdict?: string; at?: Date; script?: string }): Promise<void> {
    await testDb
        .insertInto('run_gate_results')
        .values({
            id: `g-${++seq}`,
            workflow_run_id: over.run ?? 'wr-1',
            script_id: over.script ?? 'gate-hygiene',
            verdict: over.verdict ?? 'fail',
            created_at: (over.at ?? new Date(Date.UTC(2026, 8, 21, 12, 0, 0))).toISOString(),
        } as never)
        .execute();
}

beforeEach(async () => {
    seq = 0;
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', status: 'active' });
    await insertAgent({ id: 'agent-release-reviewer', status: 'active' });
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
});

afterAll(closeTestDb);

describe('scoreAgents', () => {
    // A brand-new install has no runs, and the page has to render that rather
    // than 500. The CLI exits 1 here; a service must not exit a process.
    it('returns an empty scorecard rather than throwing when nothing is in scope', async () => {
        const card = await scoreAgents({ since: '2020-01-01T00:00:00Z' });
        expect(card.agents).toEqual([]);
        expect(card.routed).toEqual([]);
    });
});

describe('gate_catch', () => {
    // The one quality signal an agent cannot author about itself (ADR 0020,
    // finding F-012): a machine check going red AFTER the agent said done.
    it('blames the agent that last reported the work was fine', async () => {
        await workflowRun();
        await step({ node: 'n1', agent: 'agent-coder', outcome: 'done', seconds: 60 });
        await gate({ verdict: 'fail', at: new Date(Date.UTC(2026, 8, 21, 11, 0, 0)) });

        const perf = await agentPerformance('agent-coder');
        expect(perf.quality.gate_catch).toBe(1);
    });

    // ADR 0024 — the gate's own checker reports `done` moments before the
    // command it named runs, so it is always the most recent "the work is
    // fine". Blaming it would make the one signal an agent cannot author about
    // itself into one that every checker authors about itself, every time.
    it('does not blame the checker for the gate it just named the command for', async () => {
        await insertAgent({ id: 'agent-tests-check', status: 'active' });
        await workflowRun();
        await step({ node: 'n1', agent: 'agent-coder', outcome: 'done', seconds: 60 });
        await step({ node: 'cov', agent: 'agent-tests-check', outcome: 'done', seconds: 10 });
        await gate({ verdict: 'fail', script: 'agent-tests-check', at: new Date(Date.UTC(2026, 8, 21, 13, 0, 0)) });

        expect((await agentPerformance('agent-tests-check')).quality.gate_catch).toBe(0);
        expect((await agentPerformance('agent-coder')).quality.gate_catch).toBe(1);
    });

    // A gate that went red before the agent ran cannot be its doing.
    it('does not blame an agent that had not finished when the gate ran', async () => {
        await workflowRun();
        await step({ node: 'n1', agent: 'agent-coder', outcome: 'done', seconds: 60 });
        await gate({ verdict: 'fail', at: new Date(Date.UTC(2026, 8, 21, 9, 30, 0)) });
        expect((await agentPerformance('agent-coder')).quality.gate_catch).toBe(0);
    });

    // A skip is not a pass (migration 013), but it is not a catch either.
    it('counts only red verdicts', async () => {
        await workflowRun();
        await step({ node: 'n1', agent: 'agent-coder', outcome: 'done' });
        await gate({ verdict: 'pass' });
        await gate({ verdict: 'skipped' });
        expect((await agentPerformance('agent-coder')).quality.gate_catch).toBe(0);
    });

    // ADR 0015: a Task's sub-task runs are children. A gate that went red on a
    // child belongs to the same delivery as the parent's steps.
    it('attributes a gate on a sub-task run to the agent in the parent tree', async () => {
        await workflowRun('wr-1');
        await workflowRun('wr-child', 'wr-1');
        await step({ run: 'wr-1', node: 'n1', agent: 'agent-coder', outcome: 'done', seconds: 60 });
        await gate({ run: 'wr-child', verdict: 'fail', at: new Date(Date.UTC(2026, 8, 21, 11, 0, 0)) });
        expect((await agentPerformance('agent-coder')).quality.gate_catch).toBe(1);
    });
});

describe('the shapes real rows come in', () => {
    // `(unset)` rather than a crash: `cli`, `model` and `effort` were added by
    // migration 035 and every run before it has none.
    it('scores a run whose config was never snapshotted', async () => {
        await workflowRun();
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'ar-bare',
                agent_id: 'agent-coder',
                project_id: 'p1',
                status: 'completed',
                workflow_run_id: 'wr-1',
                node_id: 'n1',
                outcome_kind: 'done',
            } as never)
            .execute();

        const perf = await agentPerformance('agent-coder');
        expect(perf.quality.steps).toBe(1);
        expect(perf.cost.total_usd).toBe(0);
        // Neither start nor finish recorded, so there is no duration to report.
        expect(perf.latency.p50_s).toBeNull();
        expect(perf.by_config[0]).toMatchObject({ model: null, effort: null });
    });

    // F-012 again, from the other side: a `done` with every required row
    // ticked IS a pass, and the replay has to say so.
    it('passes a `done` that ticked its required checklist', async () => {
        await workflowRun();
        await testDb
            .insertInto('agent_checklists')
            .values({ agent_id: 'agent-coder', label: 'tests pass', required: true, sort_order: 0 } as never)
            .execute();
        const row = await testDb
            .selectFrom('agent_checklists')
            .select('id')
            .where('agent_id', '=', 'agent-coder')
            .executeTakeFirstOrThrow();
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'ar-ok',
                agent_id: 'agent-coder',
                project_id: 'p1',
                status: 'completed',
                workflow_run_id: 'wr-1',
                node_id: 'n1',
                outcome_kind: 'done',
                outcome_checklist: JSON.stringify([{ id: Number(row.id), passed: true }]),
            } as never)
            .execute();

        expect((await agentPerformance('agent-coder')).quality.first_pass).toEqual({
            applied: 1,
            rejected: 0,
            parked: 0,
        });
    });

    // A red gate in someone else's delivery is not this agent's catch.
    it('does not blame an agent for a gate in another run', async () => {
        await workflowRun('wr-1');
        await workflowRun('wr-2');
        await step({ run: 'wr-1', node: 'n1', agent: 'agent-coder', outcome: 'done', seconds: 60 });
        await gate({ run: 'wr-2', verdict: 'fail', at: new Date(Date.UTC(2026, 8, 21, 11, 0, 0)) });
        expect((await agentPerformance('agent-coder')).quality.gate_catch).toBe(0);
    });

    // A gate that went red before ANY agent reported done has nobody to blame.
    it('blames nobody when no agent had passed yet', async () => {
        await workflowRun();
        await step({ node: 'n1', agent: 'agent-coder', outcome: 'rejected', seconds: 60 });
        await gate({ verdict: 'fail', at: new Date(Date.UTC(2026, 8, 21, 11, 0, 0)) });
        expect((await agentPerformance('agent-coder')).quality.gate_catch).toBe(0);
    });
});

describe('scoping', () => {
    it('scores only the runs it was given', async () => {
        await workflowRun('wr-1');
        await workflowRun('wr-2');
        await step({ run: 'wr-1', node: 'n1', cost: 1 });
        await step({ run: 'wr-2', node: 'n1', cost: 9 });

        const only = await scoreAgents({ run_ids: ['wr-1'] });
        expect(only.agents[0]?.cost_usd).toBe(1);
    });

    it('honours the end of the window as well as the start', async () => {
        await workflowRun('wr-1');
        await step({ node: 'n1' });
        const after = await scoreAgents({ until: '2026-08-01T00:00:00Z' });
        expect(after.agents).toEqual([]);
    });

    // A sub-task run's dispatches belong to the delivery, not to a run of
    // their own — selecting them directly would double-count.
    it('rolls a sub-task run’s dispatches into its parent', async () => {
        await workflowRun('wr-1');
        await workflowRun('wr-child', 'wr-1');
        await step({ run: 'wr-1', node: 'n1', cost: 1 });
        await step({ run: 'wr-child', node: 'n2', cost: 2 });

        const card = await scoreAgents({});
        expect(card.roots).toHaveLength(1);
        expect(card.routed).toHaveLength(2);
        expect(card.rootOf.get('wr-child')).toBe('wr-1');
        expect(card.agents[0]?.cost_usd).toBe(3);
    });
});

describe('checklist replay', () => {
    // F-012: an agent that reports `done` while leaving a REQUIRED checklist
    // row unticked did not pass, and the engine routes it as a fail. A score
    // that trusted `outcome_kind` alone would call it a pass.
    it('fails a `done` that left a required checklist row unticked', async () => {
        await workflowRun();
        await testDb
            .insertInto('agent_checklists')
            .values({ agent_id: 'agent-coder', label: 'tests pass', required: true, sort_order: 0 } as never)
            .execute();
        const row = await testDb
            .selectFrom('agent_checklists')
            .select('id')
            .where('agent_id', '=', 'agent-coder')
            .executeTakeFirstOrThrow();

        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'ar-checklist',
                agent_id: 'agent-coder',
                project_id: 'p1',
                status: 'completed',
                workflow_run_id: 'wr-1',
                node_id: 'n1',
                outcome_kind: 'done',
                outcome_checklist: JSON.stringify([{ id: Number(row.id), passed: false }]),
                total_cost_usd: 1,
            } as never)
            .execute();

        const perf = await agentPerformance('agent-coder');
        expect(perf.quality.first_pass).toEqual({ applied: 0, rejected: 1, parked: 0 });
    });
});

describe('agentPerformance', () => {
    it('splits first attempts three ways instead of summing them', async () => {
        await workflowRun();
        await step({ node: 'n1', outcome: 'done' });
        await step({ node: 'n2', outcome: 'rejected' });
        await step({ node: 'n3', outcome: 'asked_question' });

        const perf = await agentPerformance('agent-coder');
        expect(perf.quality.first_pass).toEqual({ applied: 1, rejected: 1, parked: 1 });
        expect(perf.quality.steps).toBe(3);
        // The ADR's warning, enforced by the payload's shape: there is no
        // single number here for a reviewer to be ranked badly by.
        expect(perf).not.toHaveProperty('pass_at_1');
        expect(JSON.stringify(perf)).not.toContain('pass_at_1');
    });

    // A step's retries are `loops`. Counting them as fresh attempts would make
    // an agent that recovered look worse than one that never tried again.
    it('counts only the first dispatch of a step as an attempt', async () => {
        await workflowRun();
        await step({ node: 'n1', outcome: 'rejected' });
        await step({ node: 'n1', outcome: 'done' });

        const perf = await agentPerformance('agent-coder');
        expect(perf.quality.first_pass).toEqual({ applied: 0, rejected: 1, parked: 0 });
        expect(perf.quality.loops).toBe(1);
        expect(perf.quality.dispatches).toBe(2);
    });

    // An agent that produced no readable outcome told the engine nothing, and
    // the engine parks on that. It is not a rejection.
    it('treats a run with no outcome block as having asked', async () => {
        await workflowRun();
        await step({ node: 'n1', outcome: null });
        expect((await agentPerformance('agent-coder')).quality.first_pass).toEqual({
            applied: 0,
            rejected: 0,
            parked: 1,
        });
    });

    it('reports cost per step and latency percentiles', async () => {
        await workflowRun();
        await step({ node: 'n1', cost: 2, seconds: 10 });
        await step({ node: 'n2', cost: 4, seconds: 30 });

        const perf = await agentPerformance('agent-coder');
        expect(perf.cost.total_usd).toBe(6);
        expect(perf.cost.per_step_usd).toBe(3);
        expect(perf.latency.p50_s).toBe(10);
        expect(perf.latency.max_s).toBe(30);
    });

    // ATL-140: "numbers are attributable to the configuration that produced
    // them". A model change has to read as a break in the series.
    it('attributes the numbers to the model and effort that produced them', async () => {
        await workflowRun();
        await step({ node: 'n1', model: 'claude-sonnet-5', effort: 'medium', outcome: 'done', cost: 1 });
        await step({ node: 'n2', model: 'claude-opus-5', effort: 'xhigh', outcome: 'rejected', cost: 5 });

        const perf = await agentPerformance('agent-coder');
        expect(perf.by_config).toHaveLength(2);
        const opus = perf.by_config.find((c) => c.model === 'claude-opus-5');
        expect(opus).toMatchObject({ effort: 'xhigh', steps: 1, cost_usd: 5 });
        expect(opus?.first_pass).toEqual({ applied: 0, rejected: 1, parked: 0 });
    });

    // Traces exist only from migration 017 on, so a tool profile over an
    // unstated denominator would be the dishonest kind of number.
    it('states how many runs the tool profile is actually from', async () => {
        await workflowRun();
        await step({ node: 'n1' });
        await step({
            node: 'n2',
            trace: {
                source: 'claude',
                turns: 10,
                tool_calls: 5,
                tools: { Read: 3, Bash: 2 },
                tool_sequence: [],
                thinking_blocks: 1,
                subagent_turns: 0,
                files_touched: [],
                errors: 0,
                ttft_ms: 2000,
                truncated: false,
            },
        });

        const perf = await agentPerformance('agent-coder');
        expect(perf.tools.runs_total).toBe(2);
        expect(perf.tools.runs_with_trace).toBe(1);
        expect(perf.tools.top[0]).toEqual({ name: 'Read', calls: 3, runs: 1 });
        expect(perf.latency.ttft_p50_ms).toBe(2000);
    });

    it('says nothing about tools when no run has a trace', async () => {
        await workflowRun();
        await step({ node: 'n1' });
        const perf = await agentPerformance('agent-coder');
        expect(perf.tools.runs_with_trace).toBe(0);
        expect(perf.tools.avg_turns).toBeNull();
        expect(perf.tools.top).toEqual([]);
    });

    it('reports an agent that has never taken a step as empty rather than failing', async () => {
        await workflowRun();
        await step({ agent: 'agent-coder' });
        const perf = await agentPerformance('agent-release-reviewer');
        expect(perf.quality.dispatches).toBe(0);
        expect(perf.cost.per_step_usd).toBeNull();
        expect(perf.latency.p50_s).toBeNull();
    });

    // Ad-hoc runs and agent tests have no `workflow_run_id` — a "step" is a
    // position in a graph, and neither has one.
    it('leaves runs that were never workflow steps out', async () => {
        await workflowRun();
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'adhoc',
                agent_id: 'agent-coder',
                project_id: 'p1',
                status: 'completed',
                outcome_kind: 'done',
                total_cost_usd: 99,
            } as never)
            .execute();
        await step({ node: 'n1', cost: 1 });

        const perf = await agentPerformance('agent-coder');
        expect(perf.quality.dispatches).toBe(1);
        expect(perf.cost.total_usd).toBe(1);
    });
});
