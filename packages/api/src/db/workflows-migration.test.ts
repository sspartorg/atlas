import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Insertable } from 'kysely';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';
import type { WorkflowRunsTable, WorkflowsTable } from './types.js';

const EMPTY_GRAPH = JSON.stringify({ nodes: [], edges: [] });

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Epic' });
});

afterAll(async () => {
    await closeTestDb();
});

async function insertWorkflow(overrides: Partial<Insertable<WorkflowsTable>> = {}): Promise<void> {
    await testDb
        .insertInto('workflows')
        .values({ id: 'wf-dev', project_id: 'p1', name: 'Dev', ...overrides })
        .execute();
}

function runRow(overrides: Partial<Insertable<WorkflowRunsTable>> = {}): Insertable<WorkflowRunsTable> {
    return { id: 'wr-1', workflow_id: 'wf-dev', item_id: 'ATL-1', project_id: 'p1', graph_snapshot: EMPTY_GRAPH, ...overrides };
}

describe('migration 035 — workflows', () => {
    it('lets only one live workflow run hold an item, counting parked runs as live', async () => {
        await insertWorkflow();
        await testDb.insertInto('workflow_runs').values(runRow({ status: 'waiting_for_owner' })).execute();

        await expect(
            testDb.insertInto('workflow_runs').values(runRow({ id: 'wr-2' })).execute(),
        ).rejects.toMatchObject({ code: '23505' });

        await testDb.updateTable('workflow_runs').set({ status: 'completed' }).where('id', '=', 'wr-1').execute();
        await testDb.insertInto('workflow_runs').values(runRow({ id: 'wr-2' })).execute();
    });

    it('requires a project unless the workflow takes no input and uses no worktree', async () => {
        await expect(insertWorkflow({ project_id: null })).rejects.toMatchObject({ code: '23514' });
        await insertWorkflow({ id: 'wf-news', project_id: null, input_kind: 'none', use_worktree: false });
    });

    it('defaults a new workflow to an active, manual, item-driven, PR-raising flow', async () => {
        await insertWorkflow();
        const row = await testDb.selectFrom('workflows').selectAll().where('id', '=', 'wf-dev').executeTakeFirstOrThrow();
        expect(row).toMatchObject({
            status: 'active',
            trigger: 'manual',
            input_kind: 'item',
            use_worktree: true,
            push_code: true,
            raises_pr: true,
            max_loops: 3,
            graph: { nodes: [], edges: [] },
        });
    });

    it('keeps agent step rows and items when a workflow is deleted', async () => {
        await insertAgent({ id: 'agent-coder' });
        await insertWorkflow();
        await testDb.insertInto('workflow_runs').values(runRow()).execute();
        await testDb
            .updateTable('items')
            .set({ workflow_id: 'wf-dev', created_by_workflow_run_id: 'wr-1' })
            .where('id', '=', 'ATL-1')
            .execute();
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'run-1',
                agent_id: 'agent-coder',
                item_id: 'ATL-1',
                status: 'completed',
                workflow_run_id: 'wr-1',
                node_id: 'coder',
                cli: 'claude',
                model: 'claude-opus-4-7',
                effort: 'high',
                prompt_version: 2,
            })
            .execute();

        await testDb.deleteFrom('workflows').where('id', '=', 'wf-dev').execute();

        const step = await testDb.selectFrom('agent_runs').selectAll().where('id', '=', 'run-1').executeTakeFirstOrThrow();
        expect(step).toMatchObject({
            workflow_run_id: null,
            node_id: 'coder',
            cli: 'claude',
            model: 'claude-opus-4-7',
            effort: 'high',
            prompt_version: 2,
        });
        const item = await testDb
            .selectFrom('items')
            .select(['workflow_id', 'created_by_workflow_run_id'])
            .where('id', '=', 'ATL-1')
            .executeTakeFirstOrThrow();
        expect(item).toEqual({ workflow_id: null, created_by_workflow_run_id: null });
    });
});
