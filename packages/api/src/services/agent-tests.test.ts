import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

// The dispatch itself is out of scope here: what this file proves is that a
// test materialises an item, records the run, and judges it once the dispatch
// finishes. Spawning a real CLI would test the runner, not this.
const spawnAgentRun = vi.hoisted(() => vi.fn(async () => 'run-1'));
vi.mock('./agent-runner.js', () => ({ spawnAgentRun }));
// The judge spawns a CLI; what matters here is how its answer lands on a run.
const judgeAgentTestRun = vi.hoisted(() => vi.fn(async () => null));
vi.mock('./agent-tests-judge.js', () => ({ judgeAgentTestRun }));

import { agentTestsService } from './agent-tests.js';
import { tasksService } from './tasks.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertProject } from '../../tests/_items.js';

async function makeTest(over: Record<string, unknown> = {}) {
    return agentTestsService.create({
        agent_id: 'agent-coder',
        project_id: 'p1',
        name: 'scopes a task',
        item_template: { issue_type: 'task', title: 'Add a stats endpoint', description: 'body' },
        ...over,
    } as never);
}

/** Put the dispatch into a terminal state so the lazy evaluator will judge it. */
async function finishRun(over: Record<string, unknown> = {}): Promise<void> {
    await testDb
        .updateTable('agent_runs')
        .set({
            status: 'completed',
            outcome_kind: 'done',
            outcome_summary: 'created the sub-tasks',
            total_cost_usd: 0.25,
            started_at: new Date('2026-01-01T00:00:00Z').toISOString(),
            completed_at: new Date('2026-01-01T00:00:30Z').toISOString(),
            ...over,
        } as never)
        .where('id', '=', 'run-1')
        .execute();
}

/**
 * Distinct run ids, each with its own `agent_runs` row — same reason the
 * default mock inserts one: `agent_test_runs.agent_run_id` is a foreign key,
 * so a mock that only returns an id would pass a constraint the product
 * relies on.
 */
function mockDistinctSpawns(): void {
    let n = 0;
    spawnAgentRun.mockImplementation(async () => {
        const id = `run-${++n}`;
        await testDb
            .insertInto('agent_runs')
            .values({ id, agent_id: 'agent-coder', status: 'queued' } as never)
            .execute();
        return id;
    });
}

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
    spawnAgentRun.mockReset();
    judgeAgentTestRun.mockReset();
    judgeAgentTestRun.mockResolvedValue(null);
    // The real `spawnAgentRun` INSERTs the `agent_runs` row; `agent_test_runs`
    // has a foreign key to it, so a mock that only returns an id would pass a
    // constraint the product relies on.
    spawnAgentRun.mockImplementation(async () => {
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'run-1', agent_id: 'agent-coder', status: 'queued' } as never)
            .execute();
        return 'run-1';
    });
});

afterAll(async () => {
    await closeTestDb();
});

describe('agentTestsService', () => {
    // `agent_test_runs.item_id` is ON DELETE SET NULL, so the cascade that takes
    // the run rows would leave every throwaway item behind with nothing pointing
    // at it — invisible since migration 016, and therefore never collectable by
    // hand either.
    it('takes the items its runs created with it when deleted', async () => {
        const test = await makeTest({
            name: 'builds it',
            item_template: { issue_type: 'sub_task', title: 'Build the endpoint' },
        });
        await agentTestsService.run(test.id);
        expect(await testDb.selectFrom('items').select('id').execute()).toHaveLength(2);

        await agentTestsService.remove(test.id);
        // The sub-task AND the parent Task only `parent_id` knew about.
        expect(await testDb.selectFrom('items').select('id').execute()).toEqual([]);
    });

    it('leaves items it did not create alone', async () => {
        const keep = await tasksService.create({ project_id: 'p1', title: 'real work' });
        const test = await makeTest();
        await agentTestsService.run(test.id);
        await agentTestsService.remove(test.id);
        expect((await testDb.selectFrom('items').select('id').execute()).map((r) => r.id)).toEqual([keep.id]);
    });

    it('creates, lists, updates and deletes a test', async () => {
        const created = await makeTest();
        expect(created.name).toBe('scopes a task');
        expect((await agentTestsService.list('agent-coder')).map((t) => t.id)).toEqual([created.id]);

        const updated = await agentTestsService.update(created.id, { name: 'renamed' });
        expect(updated?.name).toBe('renamed');

        await agentTestsService.remove(created.id);
        expect(await agentTestsService.list('agent-coder')).toEqual([]);
    });

    describe('run', () => {
        it('materialises a Task from the template and dispatches the agent at it', async () => {
            const test = await makeTest();
            const batch = await agentTestsService.run(test.id);
            // One press is a batch; an un-sampled press is a batch of one.
            expect(batch.n_runs).toBe(1);
            const run = batch.runs[0]!;

            expect(run.item_id).toBeTruthy();
            expect(run.agent_run_id).toBe('run-1');
            expect(run.verdict).toBe('running');

            const item = await testDb
                .selectFrom('items')
                .select(['type', 'title'])
                .where('id', '=', run.item_id!)
                .executeTakeFirst();
            expect(item?.type).toBe('task');
            // The name is in the title so a throwaway item found later can be
            // traced back to the test that made it.
            expect(item?.title).toContain('[test] scopes a task');
            expect(spawnAgentRun).toHaveBeenCalledWith(
                expect.objectContaining({ agentId: 'agent-coder', issueType: 'task', issueId: run.item_id }),
            );
        });

        // A sub-task with no parent is a shape no agent ever sees in production,
        // so a test that produced one would not be testing the real thing.
        it('gives a sub_task template a parent Task', async () => {
            const test = await makeTest({
                item_template: { issue_type: 'sub_task', title: 'Build the endpoint' },
            });
            const run = (await agentTestsService.run(test.id)).runs[0]!;
            const sub = await testDb
                .selectFrom('items')
                .select(['type', 'parent_id'])
                .where('id', '=', run.item_id!)
                .executeTakeFirst();
            expect(sub?.type).toBe('sub_task');
            expect(sub?.parent_id).toBeTruthy();
        });

        // Migration 016. The item is real so the agent behaves as it would in
        // production; `is_test` is what keeps it out of the Owner's Task list,
        // search, queue, counts, labels and analytics.
        it('marks the items it creates as test items', async () => {
            const task = (await agentTestsService.run((await makeTest()).id)).runs[0]!;
            const sub = (await agentTestsService.run(
                (await makeTest({ name: 'builds it', item_template: { issue_type: 'sub_task', title: 'Build the endpoint' } })).id,
            )).runs[0]!;

            const flags = await testDb.selectFrom('items').select(['id', 'is_test']).execute();
            // Three rows: the Task, the sub-task, and the sub-task's throwaway
            // parent — all of them invisible, including the parent nothing
            // records a reference to.
            expect(flags).toHaveLength(3);
            expect(flags.every((f) => f.is_test)).toBe(true);
            expect(await testDb.selectFrom('items_live').select('id').execute()).toEqual([]);
            expect([task.item_id, sub.item_id]).not.toContain(null);
        });

        // Sampling (migration 018). An agent is stochastic, so one dispatch
        // decided a verdict that a second press could have reversed.
        it('takes n independent samples, each with its own throwaway item', async () => {
            mockDistinctSpawns();
            const batch = await agentTestsService.run((await makeTest()).id, { n_runs: 4, label: 'before-diet' });

            expect(batch.n_runs).toBe(4);
            expect(batch.runs.map((r) => r.sample_index)).toEqual([0, 1, 2, 3]);
            expect(new Set(batch.runs.map((r) => r.batch_id)).size).toBe(1);
            expect(batch.label).toBe('before-diet');
            // Four items, not one reused: a second dispatch against an item
            // the first already changed is measuring something else.
            expect(new Set(batch.runs.map((r) => r.item_id)).size).toBe(4);
            expect(spawnAgentRun).toHaveBeenCalledTimes(4);
            // Four real dispatches, not four rows that failed their FK.
            expect(batch.runs.every((r) => r.verdict === 'running')).toBe(true);
            expect(new Set(batch.runs.map((r) => r.agent_run_id)).size).toBe(4);
        });

        it('refuses to spend more than the cap however many samples are asked for', async () => {
            mockDistinctSpawns();
            const batch = await agentTestsService.run((await makeTest()).id, { n_runs: 99 });
            expect(batch.n_runs).toBe(10);
        });

        it('treats an unsampled press as a batch of one', async () => {
            const batch = await agentTestsService.run((await makeTest()).id);
            expect(batch.n_runs).toBe(1);
            expect(batch.runs[0]?.sample_index).toBe(0);
        });

        // A dispatch that never started is a broken environment, not a failing
        // agent — the same distinction ADR 0020 draws for a gate that could not run.
        it('records a dispatch that could not start as errored, not failed', async () => {
            spawnAgentRun.mockRejectedValueOnce(new Error('claude: command not found'));
            const test = await makeTest();
            const run = (await agentTestsService.run(test.id)).runs[0]!;
            expect(run.verdict).toBe('errored');
            expect(run.failures[0]).toContain('command not found');
        });
    });

    // Custom LLM-as-a-Judge (ADR 0023). The only non-deterministic piece in
    // the evaluation path, so how it fails matters more than how it passes.
    describe('the judge', () => {
        async function runJudged(judge: unknown, expectations: Record<string, unknown> = {}) {
            judgeAgentTestRun.mockResolvedValue(judge as never);
            const test = await makeTest({
                expectations: { outcome_kind: 'done', judge_criteria: ['did it say why?'], ...expectations },
            });
            await agentTestsService.run(test.id);
            await finishRun();
            const [run] = await agentTestsService.listRuns(test.id);
            return run!;
        }

        it('passes a run the judge agreed with, and records what it said', async () => {
            const run = await runJudged({ verdict: 'pass', reason: 'it named the row', cost_usd: 0.004 });
            expect(run.verdict).toBe('passed');
            expect(run.judge_verdict).toBe('pass');
            expect(run.judge_reason).toBe('it named the row');
        });

        // Every judge-authored failure is prefixed, so a reader can always
        // tell which assertion was machine-graded.
        it('fails a run the judge rejected, and says the judge said so', async () => {
            const run = await runJudged({ verdict: 'fail', reason: 'it never said which row', cost_usd: 0.004 });
            expect(run.verdict).toBe('failed');
            expect(run.failures[0]).toBe('judge: it never said which row');
            expect(run.judge_verdict).toBe('fail');
        });

        // A judge that would not commit has not found anything about the
        // agent. Calling that a pass would be inventing a verdict.
        it('errors rather than passing when the judge abstained', async () => {
            const run = await runJudged({ verdict: 'abstained', reason: 'the judge timed out', cost_usd: null });
            expect(run.verdict).toBe('errored');
            expect(run.failures[0]).toContain('could not decide');
        });

        // The question was never asked, so it certainly was not answered yes.
        it('errors when there are criteria to grade but no AI to grade them', async () => {
            const run = await runJudged(null);
            expect(run.verdict).toBe('errored');
            expect(run.failures[0]).toContain('AI is not enabled');
        });

        // An expensive judge must never be able to fail a `max_cost_usd`
        // ceiling that is about the AGENT.
        it('keeps the judge’s spend apart from the agent’s', async () => {
            const run = await runJudged({ verdict: 'pass', reason: 'ok', cost_usd: 0.9 }, { max_cost_usd: 0.5 });
            expect(run.judge_cost_usd).toBe(0.9);
            expect(run.cost_usd).toBe(0.25);
            expect(run.verdict).toBe('passed');
        });

        it('does not call the judge at all when a test asked for none', async () => {
            const test = await makeTest({ expectations: { outcome_kind: 'done' } });
            await agentTestsService.run(test.id);
            await finishRun();
            await agentTestsService.listRuns(test.id);
            expect(judgeAgentTestRun).not.toHaveBeenCalled();
        });
    });

    describe('listBatches', () => {
        // The verdict the Owner reads is about the batch, not about whichever
        // sample they happen to be looking at.
        it('reports how many of a batch’s samples passed, and which expectation was unstable', async () => {
            mockDistinctSpawns();
            const test = await makeTest({ expectations: { outcome_kind: 'done' } });
            const batch = await agentTestsService.run(test.id, { n_runs: 3 });

            // Two agree, one disagrees — the shape a single run cannot express.
            for (const [i, r] of batch.runs.entries()) {
                await testDb
                    .updateTable('agent_runs')
                    .set({
                        status: 'completed',
                        outcome_kind: i === 1 ? 'rejected' : 'done',
                        outcome_summary: 's',
                    } as never)
                    .where('id', '=', r.agent_run_id!)
                    .execute();
            }

            const [summary] = await agentTestsService.listBatches(test.id);
            expect(summary?.n_runs).toBe(3);
            expect(summary?.passed).toBe(2);
            expect(summary?.failed).toBe(1);
            expect(summary?.flaky).toBe(true);
            expect(summary?.consistency).toBeCloseTo(2 / 3);
            expect(summary?.failure_histogram).toEqual([
                { failure: 'expected outcome `done`, got `rejected`', count: 1 },
            ]);
        });
    });

    describe('listRuns judges a finished dispatch', () => {
        it('passes a run that met its expectations', async () => {
            const test = await makeTest({ expectations: { outcome_kind: 'done', summary_contains: ['sub-tasks'] } });
            await agentTestsService.run(test.id);
            await finishRun();

            const [judged] = await agentTestsService.listRuns(test.id);
            expect(judged!.verdict).toBe('passed');
            expect(judged!.failures).toEqual([]);
            expect(judged!.cost_usd).toBe(0.25);
            expect(judged!.duration_s).toBe(30);
        });

        it('fails a run that did not, and says which expectation', async () => {
            const test = await makeTest({ expectations: { outcome_kind: 'asked_question' } });
            await agentTestsService.run(test.id);
            await finishRun();

            const [judged] = await agentTestsService.listRuns(test.id);
            expect(judged!.verdict).toBe('failed');
            expect(judged!.failures[0]).toContain('expected outcome `asked_question`');
        });

        it('leaves a dispatch that has not finished as running', async () => {
            const test = await makeTest();
            await agentTestsService.run(test.id);
            await finishRun({ status: 'in_progress' });
            expect((await agentTestsService.listRuns(test.id))[0]!.verdict).toBe('running');
        });

        // Judging is lazy, so it must also be idempotent: a second read must
        // not re-open a verdict that was already reached.
        it('does not re-judge a run it has already decided', async () => {
            const test = await makeTest({ expectations: { outcome_kind: 'done' } });
            await agentTestsService.run(test.id);
            await finishRun();

            expect((await agentTestsService.listRuns(test.id))[0]!.verdict).toBe('passed');
            await testDb.updateTable('agent_runs').set({ outcome_kind: 'rejected' } as never).where('id', '=', 'run-1').execute();
            expect((await agentTestsService.listRuns(test.id))[0]!.verdict).toBe('passed');
        });
    });
});

// A suite run is N batches under one label (migration 018), not a new row kind
// — and it spends real money, so the guards matter more than the mechanism.
describe('agentTestsService.runSuite', () => {
    it('runs every fixture under one shared label', async () => {
        mockDistinctSpawns();
        await makeTest({ name: 'one' });
        await makeTest({ name: 'two' });

        const batches = await agentTestsService.runSuite('agent-coder', { project_id: 'p1' });
        expect(batches).toHaveLength(2);
        const labels = new Set(batches.map((b) => b.label));
        expect(labels.size, 'one suite run is one label').toBe(1);
        expect([...labels][0]).toMatch(/^suite-/);
    });

    it('refuses a second run while one is in flight', async () => {
        mockDistinctSpawns();
        await makeTest({ name: 'one' });
        await agentTestsService.runSuite('agent-coder', { project_id: 'p1' });
        // The first run's samples are still `running`; pressing again would
        // double a real bill rather than queue.
        await expect(agentTestsService.runSuite('agent-coder', { project_id: 'p1' })).rejects.toThrow(
            /already in flight/,
        );
    });

    it('refuses an agent with nothing to run', async () => {
        await expect(agentTestsService.runSuite('agent-coder', { project_id: 'p1' })).rejects.toThrow(
            /no tests to run/,
        );
    });

    // Migration 021 — a fixture is agent-scoped until something names a
    // project. Guessing one would spend an issue key where nobody asked.
    it('refuses to run a fixture that is bound to no project', async () => {
        mockDistinctSpawns();
        const t = await makeTest({ name: 'unbound', project_id: null });
        await expect(agentTestsService.run(t.id)).rejects.toThrow(/not bound to a project/);
    });

    it('runs an unbound fixture in the project the caller names', async () => {
        mockDistinctSpawns();
        const t = await makeTest({ name: 'unbound', project_id: null });
        const batch = await agentTestsService.run(t.id, { project_id: 'p1' });
        expect(batch.n_runs).toBe(1);
        expect(await testDb.selectFrom('items').select('project_id').executeTakeFirstOrThrow()).toMatchObject({
            project_id: 'p1',
        });
    });
});
