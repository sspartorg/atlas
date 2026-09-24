import { randomUUID } from 'node:crypto';

import type { IssueType } from '@atlas/shared';

import { db } from '../db/kysely-client.js';
import type { AgentTestExpectations } from './agent-tests-evaluate.js';
import {
    asRun,
    asTest,
    judgePendingRun,
    type AgentTestItemTemplate,
    type AgentTestRow,
    type AgentTestRunRow,
} from './agent-tests-evaluate-run.js';
import { spawnAgentRun } from './agent-runner.js';
import { startWorkflowRun } from './workflow-engine.js';
import { summariseBatch, toBatches, type AgentTestBatch } from './agent-test-batches.js';
import { subTasksService } from './sub-tasks.js';
import { tasksService } from './tasks.js';

// Agent tests as product data (ADR 0023).
//
// The items a run materialises carry `is_test` (migration 016): real to the
// agent in every way it can observe, invisible to every list, count, search and
// aggregate the Owner looks at.
//
// A test owns the item it wants the agent to act on, because a bare prompt
// cannot exercise the agents Atlas ships — PO Writer refuses anything that is
// not a Task, Coder needs a sub-task with a repo. Each run materialises a fresh
// throwaway item from the template, so the same test asks the same question
// every time; pointing at a live item would give a different answer whenever
// the repo moved under it.
//
// Judging happens at completion (`agent-tests-evaluate-run.ts`, called by the
// runner), with a fallback on read for a run the API missed by crashing between
// the dispatch finishing and the hook firing.

export type { AgentTestRow, AgentTestRunRow };

/**
 * Ten is the cap because the dialog shows the estimated total before the
 * click, and past ten the number stops being a decision anybody makes lightly.
 */
const MAX_SAMPLES = 10;

export interface RunTestOptions {
    /** Samples to take. 1 keeps the old behaviour exactly. */
    n_runs?: number | undefined;
    /** Free-text tag, e.g. `before-prompt-diet`, for comparing two batches. */
    label?: string | undefined;
}

export interface CreateAgentTestInput {
    /** Exactly one of these, by CHECK (migration 019). */
    agent_id?: string | null | undefined;
    workflow_id?: string | null | undefined;
    suite?: string | null | undefined;
    project_id: string;
    repo_id?: string | null | undefined;
    name: string;
    item_template: AgentTestItemTemplate;
    expectations?: AgentTestExpectations | undefined;
}

/** `Partial<CreateAgentTestInput>` will not do: under `exactOptionalPropertyTypes`
 *  it forbids the explicit `undefined` a zod-parsed patch body carries. */
export interface UpdateAgentTestInput {
    repo_id?: string | null | undefined;
    suite?: string | null | undefined;
    name?: string | undefined;
    item_template?: AgentTestItemTemplate | undefined;
    expectations?: AgentTestExpectations | undefined;
}

export const agentTestsService = {
    async list(agentId: string): Promise<AgentTestRow[]> {
        const rows = await db
            .selectFrom('agent_tests')
            .selectAll()
            .where('agent_id', '=', agentId)
            .orderBy('created_at', 'desc')
            .execute();
        return rows.map((r) => asTest(r as never));
    },

    async get(id: string): Promise<AgentTestRow | null> {
        const row = await db.selectFrom('agent_tests').selectAll().where('id', '=', id).executeTakeFirst();
        return row ? asTest(row as never) : null;
    },

    async create(input: CreateAgentTestInput): Promise<AgentTestRow> {
        const id = randomUUID();
        await db
            .insertInto('agent_tests')
            .values({
                id,
                agent_id: input.agent_id ?? null,
                workflow_id: input.workflow_id ?? null,
                suite: input.suite ?? null,
                project_id: input.project_id,
                repo_id: input.repo_id ?? null,
                name: input.name,
                item_template: JSON.stringify(input.item_template) as never,
                expectations: JSON.stringify(input.expectations ?? {}) as never,
            } as never)
            .execute();
        return (await this.get(id))!;
    },

    async update(id: string, patch: UpdateAgentTestInput): Promise<AgentTestRow | null> {
        const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.name !== undefined) set['name'] = patch.name;
        if (patch.repo_id !== undefined) set['repo_id'] = patch.repo_id;
        if (patch.suite !== undefined) set['suite'] = patch.suite;
        if (patch.item_template !== undefined) set['item_template'] = JSON.stringify(patch.item_template);
        if (patch.expectations !== undefined) set['expectations'] = JSON.stringify(patch.expectations);
        await db.updateTable('agent_tests').set(set as never).where('id', '=', id).execute();
        return this.get(id);
    },

    /**
     * Delete a test, and the throwaway items its runs made.
     *
     * `agent_test_runs.item_id` is `ON DELETE SET NULL`, so the cascade that
     * takes the run rows would otherwise leave every item behind with nothing
     * pointing at it — invisible now (migration 016), but never collectable.
     *
     * For a sub-task template, `item_id` is the sub-task; its throwaway parent
     * Task is only reachable through `parent_id`, so both are collected here
     * and the parent's delete cascades to the child.
     */
    async remove(id: string): Promise<void> {
        const rows = await db
            .selectFrom('agent_test_runs as r')
            .innerJoin('items as i', 'i.id', 'r.item_id')
            .select(['i.id as id', 'i.parent_id as parent_id'])
            .where('r.agent_test_id', '=', id)
            .execute();
        const itemIds = [...new Set(rows.flatMap((r) => [r.id, r.parent_id]))].filter(
            (v): v is string => v !== null,
        );
        await db.deleteFrom('agent_tests').where('id', '=', id).execute();
        if (itemIds.length > 0) {
            // Belt and braces: only ever delete rows this flagged as its own.
            await db.deleteFrom('items').where('id', 'in', itemIds).where('is_test', '=', true).execute();
        }
    },

    /**
     * Materialise the test's item and dispatch the agent at it.
     *
     * Returns as soon as the run is queued — the verdict lands when the run is
     * next read. The throwaway item is created through the normal item services
     * so it carries the project's repo wiring and issue key, exactly as a real
     * one would; an agent that behaved differently against a synthetic item
     * would make the test worthless.
     */
    /**
     * Run a test `n` times and return the batch.
     *
     * One sample is a coin flip: the agent is stochastic, so a test that passes
     * three times in five reported whichever of the two the Owner happened to
     * press the button on. The samples are independent — each materialises its
     * own throwaway item, because a second dispatch against an item the first
     * one already changed is measuring something else.
     *
     * They run in parallel, which is safe here specifically: an agent test
     * calls `spawnAgentRun` with no workflow run, so each one gets its own
     * `mkdtemp` directory and never takes the project git lock. A workflow-level
     * eval would have to serialise.
     */
    async run(testId: string, opts: RunTestOptions = {}): Promise<AgentTestBatch> {
        const test = await this.get(testId);
        if (!test) throw new Error(`Agent test ${testId} not found`);
        const samples = Math.min(MAX_SAMPLES, Math.max(1, Math.trunc(opts.n_runs ?? 1)));
        const batchId = randomUUID();
        const label = opts.label?.trim() || null;

        // Agent tests run in parallel because each gets its own `mkdtemp`
        // directory. A workflow eval calls `startWorkflowRun`, which provisions
        // a worktree under the project git lock — running those side by side
        // would have them fighting over it.
        const rows: AgentTestRunRow[] = [];
        if (test.workflow_id) {
            for (let i = 0; i < samples; i++) rows.push(await runOneSample(test, batchId, i, label));
        } else {
            rows.push(
                ...(await Promise.all(
                    Array.from({ length: samples }, (_, i) => runOneSample(test, batchId, i, label)),
                )),
            );
        }
        return summariseBatch(batchId, rows);
    },

    /**
     * A test's runs, newest first, judging any that finished since last read.
     */
    async listRuns(testId: string): Promise<AgentTestRunRow[]> {
        const rows = await db
            .selectFrom('agent_test_runs')
            .selectAll()
            .where('agent_test_id', '=', testId)
            .orderBy('created_at', 'desc')
            .execute();
        const test = await this.get(testId);
        const out: AgentTestRunRow[] = [];
        for (const r of rows) {
            out.push(
                r.verdict === 'running' && test ? await judgePendingRun(asRun(r as never), test) : asRun(r as never),
            );
        }
        return out;
    },

    /** The same runs, folded into the batches the Owner actually pressed. */
    async listBatches(testId: string): Promise<AgentTestBatch[]> {
        return toBatches(await this.listRuns(testId));
    },

    /** The fixtures pointed at one workflow (ADR 0023 phase 3). */
    async listForWorkflow(workflowId: string): Promise<AgentTestRow[]> {
        const rows = await db
            .selectFrom('agent_tests')
            .selectAll()
            .where('workflow_id', '=', workflowId)
            .orderBy('created_at', 'desc')
            .execute();
        return rows.map((r) => asTest(r as never));
    },

    /**
     * Every fixture in a suite, with its history.
     *
     * A "suite" is a tag: running the golden set means running each of its
     * fixtures, and comparing two fleet versions is reading the same suite
     * filtered by the `label` each run carried.
     */
    async suite(name: string): Promise<Array<{ test: AgentTestRow; batches: AgentTestBatch[] }>> {
        const rows = await db
            .selectFrom('agent_tests')
            .selectAll()
            .where('suite', '=', name)
            .orderBy('name', 'asc')
            .execute();
        const out: Array<{ test: AgentTestRow; batches: AgentTestBatch[] }> = [];
        for (const r of rows) {
            const test = asTest(r as never);
            out.push({ test, batches: await this.listBatches(test.id) });
        }
        return out;
    },

    /**
     * Runs of this test that are parked, waiting on the Owner.
     *
     * ATL-173: every fixture parks once at PO Writer's brainstorm by design,
     * and across a set that is ~12 substantive answers — the slowest part of
     * the whole exercise, and the Owner is the bottleneck, not the agents. If
     * those parks are not something to answer in the UI, a set run from the UI
     * is worse than the CLI, not better.
     */
    async parked(testIds: string[]): Promise<ParkedFixture[]> {
        if (testIds.length === 0) return [];
        const runs = await db
            .selectFrom('agent_test_runs')
            .select(['id', 'agent_test_id', 'workflow_run_id'])
            .where('agent_test_id', 'in', testIds)
            .where('workflow_run_id', 'is not', null)
            .execute();
        const runIds = runs.flatMap((r) => (r.workflow_run_id ? [r.workflow_run_id] : []));
        if (runIds.length === 0) return [];

        // Two reads rather than one join: `workflow_run_id` is nullable, and
        // Kysely will not join from the nullable side.
        const [parkedRuns, tests] = await Promise.all([
            db
                .selectFrom('workflow_runs')
                .select(['id', 'item_id', 'parked_node_id', 'park_reason', 'started_at'])
                .where('id', 'in', runIds)
                .where('status', '=', 'waiting_for_owner')
                .execute(),
            db.selectFrom('agent_tests').select(['id', 'name']).where('id', 'in', testIds).execute(),
        ]);
        const nameOf = new Map(tests.map((t) => [t.id, t.name]));
        const byWorkflowRun = new Map(parkedRuns.map((w) => [w.id, w]));

        return runs
            .flatMap((r) => {
                const wf = r.workflow_run_id ? byWorkflowRun.get(r.workflow_run_id) : undefined;
                if (!wf) return [];
                return [
                    {
                        run_id: r.id,
                        agent_test_id: r.agent_test_id,
                        test_name: nameOf.get(r.agent_test_id) ?? r.agent_test_id,
                        workflow_run_id: wf.id,
                        item_id: wf.item_id ?? null,
                        parked_node_id: wf.parked_node_id ?? null,
                        park_reason: wf.park_reason ?? null,
                        // `timestamptz` arrives as a Date whatever Kysely says.
                        started_at: String(wf.started_at ?? ''),
                    },
                ];
            })
            .sort((x, y) => x.started_at.localeCompare(y.started_at));
    },
};

/**
 * A fixture waiting on an answer.
 *
 * Carrying `park_reason` across the whole set is the second thing ATL-173
 * names: two fixtures once escalated on the same defect and the two Owner
 * rulings would have contradicted each other, because each run only ever sees
 * its own branch.
 */
export interface ParkedFixture {
    run_id: string;
    agent_test_id: string;
    test_name: string;
    workflow_run_id: string;
    item_id: string | null;
    parked_node_id: string | null;
    park_reason: string | null;
    started_at: string;
}

/** One sample: its own throwaway item, its own dispatch, its own row. */
async function runOneSample(
    test: AgentTestRow,
    batchId: string,
    sampleIndex: number,
    label: string | null,
): Promise<AgentTestRunRow> {
    const t = test.item_template;
    const suffix = `[test] ${test.name}`;
    let itemId: string;
    if (t.issue_type === 'sub_task') {
        // A sub-task needs a parent. The test owns a throwaway Task for it
        // so the agent sees the shape it expects rather than an orphan.
        const parent = await tasksService.create({
            project_id: test.project_id,
            title: `${t.title} ${suffix}`,
            description: t.description ?? '',
            is_test: true,
            ...(test.repo_id ? { repo_ids: [test.repo_id] } : {}),
        });
        const sub = await subTasksService.create({
            task_id: parent.id,
            title: `${t.title} ${suffix}`,
            description: t.description ?? '',
            acceptance_criteria: t.acceptance_criteria ?? '',
            labels: t.labels ?? [],
            is_test: true,
        });
        itemId = sub.id;
    } else {
        const task = await tasksService.create({
            project_id: test.project_id,
            title: `${t.title} ${suffix}`,
            description: t.description ?? '',
            acceptance_criteria: t.acceptance_criteria ?? '',
            labels: t.labels ?? [],
            is_test: true,
            ...(test.repo_id ? { repo_ids: [test.repo_id] } : {}),
        });
        itemId = task.id;
    }

    const id = randomUUID();
    await db
        .insertInto('agent_test_runs')
        .values({
            id,
            agent_test_id: test.id,
            item_id: itemId,
            batch_id: batchId,
            sample_index: sampleIndex,
            label,
        } as never)
        .execute();

    try {
        if (test.workflow_id) {
            // The end-to-end eval: the same fixture, through the whole chain.
            const workflowRunId = await startWorkflowRun(test.workflow_id, itemId);
            await db
                .updateTable('agent_test_runs')
                .set({ workflow_run_id: workflowRunId } as never)
                .where('id', '=', id)
                .execute();
        } else {
            const runId = await spawnAgentRun({
                agentId: test.agent_id as string,
                issueType: t.issue_type,
                issueId: itemId,
                projectId: test.project_id,
            });
            await db.updateTable('agent_test_runs').set({ agent_run_id: runId } as never).where('id', '=', id).execute();
        }
    } catch (err) {
        // The dispatch never happened — a missing CLI, a bad model. That is
        // a broken environment, not a failing agent, so it is `errored`.
        await db
            .updateTable('agent_test_runs')
            .set({
                verdict: 'errored',
                failures: JSON.stringify([`could not start the run: ${(err as Error).message}`]),
                evaluated_at: new Date().toISOString(),
            } as never)
            .where('id', '=', id)
            .execute();
    }

    const row = await db.selectFrom('agent_test_runs').selectAll().where('id', '=', id).executeTakeFirst();
    return asRun(row as never);
}
