import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

const startWorkflowRun = vi.hoisted(() => vi.fn(async () => 'wr-eval'));
vi.mock('./workflow-engine.js', () => ({ startWorkflowRun, onStepFinished: vi.fn() }));
const spawnAgentRun = vi.hoisted(() => vi.fn(async () => 'ar-1'));
vi.mock('./agent-runner.js', () => ({ spawnAgentRun }));

import { agentTestsService } from './agent-tests.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertProject } from '../../tests/_items.js';

// Workflow evals (ADR 0023 phase 3, ATL-173). One primitive: the same fixture,
// run through a whole workflow instead of one agent.

async function makeWorkflow(id = 'wf-1'): Promise<void> {
    await testDb
        .insertInto('workflows')
        .values({
            id,
            project_id: 'p1',
            name: 'Delivery',
            graph: JSON.stringify({ nodes: [], edges: [] }),
            input_kind: 'item',
            trigger: 'manual',
        } as never)
        .execute();
}

async function makeEval(over: Record<string, unknown> = {}) {
    return agentTestsService.create({
        workflow_id: 'wf-1',
        project_id: 'p1',
        name: 'ambiguous must escalate',
        suite: 'golden',
        item_template: { issue_type: 'task', title: 'Make the thing better' },
        expectations: { terminal_status: ['completed'], requires_pr: true },
        ...over,
    } as never);
}

/**
 * The real `startWorkflowRun` INSERTs the `workflow_runs` row, and
 * `agent_test_runs.workflow_run_id` has a foreign key to it — a mock that only
 * returned an id would pass a constraint the product relies on, and every
 * sample would silently come back `errored`.
 */
async function insertWorkflowRun(id: string, itemId: string | null): Promise<void> {
    await testDb
        .insertInto('workflow_runs')
        .values({
            id,
            workflow_id: 'wf-1',
            project_id: 'p1',
            item_id: itemId,
            status: 'running',
            graph_snapshot: JSON.stringify({ nodes: [], edges: [] }),
            started_at: new Date(Date.UTC(2026, 8, 25, 10, 0, 0)).toISOString(),
        } as never)
        .execute();
}

/** Put the workflow run into a terminal state so the eval gets judged. */
async function finishWorkflowRun(over: Record<string, unknown> = {}): Promise<void> {
    await testDb
        .updateTable('workflow_runs')
        .set({
            status: 'completed',
            finished_at: new Date(Date.UTC(2026, 8, 25, 11, 0, 0)).toISOString(),
            pr_urls: JSON.stringify(['https://github.com/x/y/pull/1']),
            ...over,
        } as never)
        .where('id', '=', 'wr-eval')
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
    await makeWorkflow();
    startWorkflowRun.mockReset();
    startWorkflowRun.mockImplementation(async (_wf: string, itemId: string | null) => {
        await insertWorkflowRun('wr-eval', itemId);
        return 'wr-eval';
    });
    spawnAgentRun.mockReset();
    spawnAgentRun.mockResolvedValue('ar-1');
});

afterAll(closeTestDb);

describe('a fixture pointed at a workflow', () => {
    it('runs the whole chain instead of one agent', async () => {
        const fixture = await makeEval();
        const batch = await agentTestsService.run(fixture.id);

        expect(startWorkflowRun).toHaveBeenCalledWith('wf-1', expect.any(String));
        expect(spawnAgentRun).not.toHaveBeenCalled();
        expect(batch.runs[0]?.workflow_run_id).toBe('wr-eval');
        expect(batch.runs[0]?.agent_run_id).toBeNull();
    });

    // Both nullable, exactly one set, enforced by the database rather than by
    // a discriminator column that could disagree with them.
    it('refuses a fixture that names both an agent and a workflow', async () => {
        await expect(makeEval({ agent_id: 'agent-coder' })).rejects.toThrow();
    });

    it('refuses a fixture that names neither', async () => {
        await expect(makeEval({ workflow_id: null })).rejects.toThrow();
    });

    // `startWorkflowRun` provisions a worktree under the project git lock, so
    // samples cannot be taken side by side the way an agent test's are.
    it('takes its samples one at a time', async () => {
        let live = 0;
        let mostAtOnce = 0;
        startWorkflowRun.mockImplementation(async (_wf: string, itemId: string | null) => {
            live += 1;
            mostAtOnce = Math.max(mostAtOnce, live);
            await new Promise((r) => setTimeout(r, 5));
            live -= 1;
            const id = `wr-${Math.random().toString(36).slice(2, 8)}`;
            await insertWorkflowRun(id, itemId);
            return id;
        });
        const batch = await agentTestsService.run((await makeEval()).id, { n_runs: 3 });
        expect(batch.n_runs).toBe(3);
        expect(mostAtOnce).toBe(1);
    });
});

describe('judging a workflow eval', () => {
    async function runAndJudge(expectations: Record<string, unknown>, runOver: Record<string, unknown> = {}) {
        const fixture = await makeEval({ expectations });
        await agentTestsService.run(fixture.id);
        await finishWorkflowRun(runOver);
        const [batch] = await agentTestsService.listBatches(fixture.id);
        return batch!.runs[0]!;
    }

    it('passes a run that ended as the fixture expected, with a PR', async () => {
        const run = await runAndJudge({ terminal_status: ['completed'], requires_pr: true });
        expect(run.verdict).toBe('passed');
    });

    it('fails a run that ended in the wrong state', async () => {
        const run = await runAndJudge({ terminal_status: ['waiting_for_owner'] });
        expect(run.verdict).toBe('failed');
        expect(run.failures[0]).toContain('expected the run to end waiting_for_owner');
    });

    // `ambiguous-must-escalate` exists because a PO Writer that invents a
    // feature from an unanswerable Task has FAILED, and opening a PR is how
    // that failure shows up. `requires_pr: false` is a real assertion.
    it('fails a run that opened a pull request it was told not to', async () => {
        const run = await runAndJudge({ requires_pr: false });
        expect(run.verdict).toBe('failed');
        expect(run.failures[0]).toContain('expected no pull request');
    });

    // ATL-173 / the golden set: every fixture parks once at PO Writer's
    // brainstorm by design, and the verdict has to wait for the answer.
    it('leaves a parked run unjudged', async () => {
        const fixture = await makeEval();
        await agentTestsService.run(fixture.id);
        await finishWorkflowRun({ status: 'waiting_for_owner', finished_at: null });
        const [batch] = await agentTestsService.listBatches(fixture.id);
        expect(batch?.runs[0]?.verdict).toBe('running');
    });

    it('records the whole delivery’s cost, not one dispatch’s', async () => {
        const fixture = await makeEval({ expectations: { terminal_status: ['completed'] } });
        await agentTestsService.run(fixture.id);
        await finishWorkflowRun();
        for (const [i, cost] of [1.5, 2.25].entries()) {
            await testDb
                .insertInto('agent_runs')
                .values({
                    id: `step-${i}`,
                    agent_id: 'agent-coder',
                    status: 'completed',
                    workflow_run_id: 'wr-eval',
                    total_cost_usd: cost,
                } as never)
                .execute();
        }
        const [batch] = await agentTestsService.listBatches(fixture.id);
        expect(batch?.runs[0]?.cost_usd).toBeCloseTo(3.75);
        // One hour of wall clock, from the run's own timestamps.
        expect(batch?.runs[0]?.duration_s).toBe(3600);
    });

    // A skip is not a pass (migration 013). A set where every gate skipped
    // verified nothing, and calling that green is how a red suite reached the
    // end of a run behind four green rows.
    it('errors rather than passing when every gate skipped', async () => {
        const fixture = await makeEval({ expectations: { gate_verdicts_all_pass: true } });
        await agentTestsService.run(fixture.id);
        await finishWorkflowRun();
        for (const [i, verdict] of ['skipped', 'skipped'].entries()) {
            await testDb
                .insertInto('run_gate_results')
                .values({ id: `g${i}`, workflow_run_id: 'wr-eval', script_id: 'gate-coverage', verdict } as never)
                .execute();
        }
        const [batch] = await agentTestsService.listBatches(fixture.id);
        expect(batch?.runs[0]?.verdict).toBe('errored');
        expect(batch?.runs[0]?.failures[0]).toContain('nothing was actually checked');
    });

    it('fails when a gate went red', async () => {
        const fixture = await makeEval({ expectations: { gate_verdicts_all_pass: true } });
        await agentTestsService.run(fixture.id);
        await finishWorkflowRun();
        await testDb
            .insertInto('run_gate_results')
            .values({ id: 'g1', workflow_run_id: 'wr-eval', script_id: 'gate-hygiene', verdict: 'fail' } as never)
            .execute();
        const [batch] = await agentTestsService.listBatches(fixture.id);
        expect(batch?.runs[0]?.verdict).toBe('failed');
        expect(batch?.runs[0]?.failures[0]).toContain('1 gate verdict(s) went red');
    });
});

describe('what a workflow run actually produced', () => {
    // A workflow with no item attached — a project-level run — has no
    // sub-tasks to count, and asking for them would be a query about nothing.
    it('counts no sub-tasks for a run with no item', async () => {
        const fixture = await makeEval({ expectations: { min_sub_tasks: 1 } });
        await agentTestsService.run(fixture.id);
        await testDb.updateTable('workflow_runs').set({ item_id: null } as never).where('id', '=', 'wr-eval').execute();
        await finishWorkflowRun();
        const [batch] = await agentTestsService.listBatches(fixture.id);
        expect(batch?.runs[0]?.failures[0]).toContain('expected at least 1 sub-tasks, got 0');
    });

    it('counts the sub-tasks the run actually created', async () => {
        const fixture = await makeEval({ expectations: { min_sub_tasks: 2 } });
        const batch = await agentTestsService.run(fixture.id);
        const itemId = batch.runs[0]!.item_id!;
        await testDb
            .updateTable('workflow_runs')
            .set({ item_id: itemId } as never)
            .where('id', '=', 'wr-eval')
            .execute();
        for (const n of [1, 2]) {
            await testDb
                .insertInto('items')
                .values({
                    id: `SUB-${n}`,
                    project_id: 'p1',
                    type: 'sub_task',
                    parent_id: itemId,
                    title: `sub ${n}`,
                    is_test: true,
                } as never)
                .execute();
        }
        await finishWorkflowRun();
        const [judged] = await agentTestsService.listBatches(fixture.id);
        expect(judged?.runs[0]?.verdict).toBe('passed');
    });

    // `pr_urls` is NOT NULL with a `[]` default, so "opened none" is an
    // empty list rather than an absent one.
    it('fails a fixture that needed a pull request and got none', async () => {
        const fixture = await makeEval({ expectations: { requires_pr: true } });
        await agentTestsService.run(fixture.id);
        await finishWorkflowRun({ pr_urls: JSON.stringify([]) });
        const [batch] = await agentTestsService.listBatches(fixture.id);
        expect(batch?.runs[0]?.failures[0]).toContain('none was opened');
    });

    // An errored run finished; it just finished badly. Its verdict is a
    // failure of the fixture, not a broken environment.
    it('judges a run that ended in error rather than leaving it pending', async () => {
        const fixture = await makeEval({ expectations: { terminal_status: ['completed'] } });
        await agentTestsService.run(fixture.id);
        await finishWorkflowRun({ status: 'error' });
        const [batch] = await agentTestsService.listBatches(fixture.id);
        expect(batch?.runs[0]?.verdict).toBe('failed');
    });

    // A run with no timestamps cannot report a duration, and inventing one
    // would be worse than saying nothing.
    it('reports no duration when the run recorded no finish', async () => {
        const fixture = await makeEval({ expectations: { terminal_status: ['completed'] } });
        await agentTestsService.run(fixture.id);
        await finishWorkflowRun({ finished_at: null });
        const [batch] = await agentTestsService.listBatches(fixture.id);
        expect(batch?.runs[0]?.duration_s).toBeNull();
    });
});

describe('the parked inbox', () => {
    // ATL-173: "if those parks are not an inbox in the UI, a set run from the
    // UI is worse than the CLI, not better."
    it('lists every fixture waiting on an answer, with why', async () => {
        const fixture = await makeEval();
        await agentTestsService.run(fixture.id);
        await finishWorkflowRun({
            status: 'waiting_for_owner',
            parked_node_id: 'po-writer',
            park_reason: 'Which repo owns the health endpoint?',
        });

        const parked = await agentTestsService.parked([fixture.id]);
        expect(parked).toHaveLength(1);
        expect(parked[0]).toMatchObject({
            test_name: 'ambiguous must escalate',
            workflow_run_id: 'wr-eval',
            parked_node_id: 'po-writer',
            // The second thing ATL-173 names: two fixtures once escalated on
            // the same defect and the rulings would have contradicted, because
            // each run only sees its own branch. Carrying the reason across
            // the set is what makes that visible.
            park_reason: 'Which repo owns the health endpoint?',
        });
    });

    it('says nothing about a run that is not parked', async () => {
        const fixture = await makeEval();
        await agentTestsService.run(fixture.id);
        await finishWorkflowRun();
        expect(await agentTestsService.parked([fixture.id])).toEqual([]);
    });

    it('is empty when asked about nothing', async () => {
        expect(await agentTestsService.parked([])).toEqual([]);
    });
});

describe('suites', () => {
    // A suite is a tag. Running the golden set is running its fixtures;
    // comparing two fleet versions is reading the same suite by label.
    it('gathers every fixture that carries the tag, with its history', async () => {
        await makeEval({ name: 'a fixture' });
        await makeEval({ name: 'another', suite: 'golden' });
        await makeEval({ name: 'not in the set', suite: 'other' });

        const suite = await agentTestsService.suite('golden');
        expect(suite.map((s) => s.test.name)).toEqual(['a fixture', 'another']);
        expect(suite[0]?.batches).toEqual([]);
    });
});
