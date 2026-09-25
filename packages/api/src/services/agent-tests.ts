import { randomUUID } from 'node:crypto';

import type { IRunOutcome, IssueType } from '@atlas/shared';

import { db } from '../db/kysely-client.js';
import type { AgentTestVerdict } from '../db/types.js';
import { evaluateAgentTest, type AgentTestExpectations } from './agent-tests-evaluate.js';
import { spawnAgentRun } from './agent-runner.js';
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
// Evaluation is lazy. The dispatch is asynchronous and there is no completion
// hook to attach to, so a run is judged the first time it is read after the
// agent finished. That keeps the write path to "create item, spawn, record" and
// means a crashed API never leaves a test permanently unjudged.

/** Statuses an `agent_runs` row can no longer move out of. */
const TERMINAL = new Set(['completed', 'error', 'cancelled', 'setup_failed']);

interface AgentTestItemTemplate {
    issue_type: IssueType;
    title: string;
    // `| undefined` throughout: these arrive parsed by zod, which produces an
    // explicit undefined for an absent optional, and the repo runs with
    // `exactOptionalPropertyTypes`.
    description?: string | undefined;
    acceptance_criteria?: string | undefined;
    labels?: string[] | undefined;
}

export interface AgentTestRow {
    id: string;
    agent_id: string;
    project_id: string;
    repo_id: string | null;
    name: string;
    item_template: AgentTestItemTemplate;
    expectations: AgentTestExpectations;
    created_at: string;
    updated_at: string;
}

export interface AgentTestRunRow {
    id: string;
    agent_test_id: string;
    agent_run_id: string | null;
    item_id: string | null;
    verdict: AgentTestVerdict;
    failures: string[];
    cost_usd: number | null;
    duration_s: number | null;
    created_at: string;
}

function iso(v: unknown): string {
    return v instanceof Date ? v.toISOString() : String(v ?? '');
}

function asTest(r: Record<string, unknown>): AgentTestRow {
    return {
        id: r['id'] as string,
        agent_id: r['agent_id'] as string,
        project_id: r['project_id'] as string,
        repo_id: (r['repo_id'] as string) ?? null,
        name: r['name'] as string,
        item_template: r['item_template'] as AgentTestItemTemplate,
        expectations: (r['expectations'] as AgentTestExpectations) ?? {},
        created_at: iso(r['created_at']),
        updated_at: iso(r['updated_at']),
    };
}

function asRun(r: Record<string, unknown>): AgentTestRunRow {
    return {
        id: r['id'] as string,
        agent_test_id: r['agent_test_id'] as string,
        agent_run_id: (r['agent_run_id'] as string) ?? null,
        item_id: (r['item_id'] as string) ?? null,
        verdict: r['verdict'] as AgentTestVerdict,
        failures: (r['failures'] as string[]) ?? [],
        cost_usd: r['cost_usd'] == null ? null : Number(r['cost_usd']),
        duration_s: r['duration_s'] == null ? null : Number(r['duration_s']),
        created_at: iso(r['created_at']),
    };
}

export interface CreateAgentTestInput {
    agent_id: string;
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
                agent_id: input.agent_id,
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
    async run(testId: string): Promise<AgentTestRunRow> {
        const test = await this.get(testId);
        if (!test) throw new Error(`Agent test ${testId} not found`);

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
            .values({ id, agent_test_id: testId, item_id: itemId } as never)
            .execute();

        try {
            const runId = await spawnAgentRun({
                agentId: test.agent_id,
                issueType: t.issue_type,
                issueId: itemId,
                projectId: test.project_id,
            });
            await db.updateTable('agent_test_runs').set({ agent_run_id: runId } as never).where('id', '=', id).execute();
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
                r.verdict === 'running' && test ? await evaluatePending(asRun(r as never), test) : asRun(r as never),
            );
        }
        return out;
    },
};

/**
 * Judge one pending run, if its dispatch has finished.
 *
 * Lazy on purpose: there is no completion hook on `agent_runs`, and polling for
 * one would be a second scheduler. Reading is when someone cares about the
 * answer, which is exactly when it is worth computing.
 */
async function evaluatePending(run: AgentTestRunRow, test: AgentTestRow): Promise<AgentTestRunRow> {
    if (!run.agent_run_id) return run;
    const ar = await db
        .selectFrom('agent_runs')
        .select([
            'status',
            'outcome_kind',
            'outcome_summary',
            'outcome_reason',
            'outcome_checklist',
            'total_cost_usd',
            'started_at',
            'completed_at',
        ])
        .where('id', '=', run.agent_run_id)
        .executeTakeFirst();
    if (!ar || !TERMINAL.has(ar.status as string)) return run;

    const outcome: IRunOutcome | null = ar.outcome_kind
        ? ({
              kind: ar.outcome_kind,
              summary: ar.outcome_summary ?? '',
              reason: ar.outcome_reason ?? undefined,
              checklist: ar.outcome_checklist ?? undefined,
          } as IRunOutcome)
        : null;

    const requiredChecklist = await db
        .selectFrom('agent_checklists')
        .select(['id', 'label'])
        .where('agent_id', '=', test.agent_id)
        .where('required', '=', true)
        .execute();

    const startedAt = ar.started_at ? new Date(iso(ar.started_at)).getTime() : null;
    const completedAt = ar.completed_at ? new Date(iso(ar.completed_at)).getTime() : null;
    const duration = startedAt && completedAt ? Math.round((completedAt - startedAt) / 1000) : null;
    const cost = ar.total_cost_usd == null ? null : Number(ar.total_cost_usd);

    const evaluation = evaluateAgentTest(test.expectations, {
        outcome,
        requiredChecklist: requiredChecklist.map((c) => ({ id: Number(c.id), label: c.label })),
        cost_usd: cost,
        duration_s: duration,
        ran: ar.status === 'completed',
    });

    await db
        .updateTable('agent_test_runs')
        .set({
            verdict: evaluation.verdict,
            failures: JSON.stringify(evaluation.failures),
            cost_usd: cost,
            duration_s: duration,
            evaluated_at: new Date().toISOString(),
        } as never)
        .where('id', '=', run.id)
        .execute();

    return { ...run, verdict: evaluation.verdict, failures: evaluation.failures, cost_usd: cost, duration_s: duration };
}
