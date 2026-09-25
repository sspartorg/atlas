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
                r.verdict === 'running' && test ? await judgePendingRun(asRun(r as never), test) : asRun(r as never),
            );
        }
        return out;
    },
};
