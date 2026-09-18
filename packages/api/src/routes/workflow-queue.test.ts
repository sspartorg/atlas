import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { IWorkflowQueue } from '@atlas/shared';

vi.mock('../routes/events.js', () => ({ eventsRoutes: async () => undefined, broadcastSSE: vi.fn() }));

import { buildApp } from '../server.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertItem, insertProject } from '../../tests/_items.js';

let app: FastifyInstance;

const EMPTY_GRAPH = JSON.stringify({ nodes: [], edges: [] });

async function workflow(id: string, project_id: string, input_kind: 'item' | 'none' | 'sub_task' = 'item') {
    await testDb.insertInto('workflows').values({ id, project_id, name: id, input_kind }).execute();
}

async function run(id: string, workflow_id: string, item_id: string | null, status: string, extra: Record<string, unknown> = {}) {
    await testDb
        .insertInto('workflow_runs')
        .values({ id, workflow_id, item_id, project_id: 'p1', status: status as never, graph_snapshot: EMPTY_GRAPH, ...extra })
        .execute();
}

async function queueFor(workflowId: string, ...itemIds: string[]) {
    await testDb.updateTable('items').set({ workflow_id: workflowId }).where('id', 'in', itemIds).execute();
}

async function getQueue(query = ''): Promise<IWorkflowQueue> {
    const res = await app.inject({ method: 'GET', url: `/api/workflow-queue${query}` });
    expect(res.statusCode).toBe(200);
    return res.json();
}

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertProject('p2', 'OTH');
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('GET /api/workflow-queue', () => {
    it('groups live Task runs and queued Tasks under their workflow, in dispatch order', async () => {
        await workflow('wf-dev', 'p1');
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Running one', status: 'in_progress' });
        await insertItem({ id: 'ATL-2', type: 'task', project_id: 'p1', title: 'Parked one', status: 'waiting_for_info' });
        await insertItem({ id: 'ATL-3', type: 'task', project_id: 'p1', title: 'Newer', status: 'ready' });
        await insertItem({ id: 'ATL-4', type: 'task', project_id: 'p1', title: 'Older', status: 'ready' });
        await insertItem({ id: 'ATL-5', type: 'sub_task', project_id: 'p1', parent_id: 'ATL-1', parent_type: 'task', status: 'in_progress' });
        await queueFor('wf-dev', 'ATL-1', 'ATL-2', 'ATL-3', 'ATL-4');
        // The updated_at trigger stamps every write; touching ATL-3 makes it the newer one.
        await testDb.updateTable('items').set({ title: 'Newer' }).where('id', '=', 'ATL-3').execute();
        await run('r-1', 'wf-dev', 'ATL-1', 'running', { current_node_id: 'subtasks' });
        await run('r-2', 'wf-dev', 'ATL-2', 'waiting_for_owner', { park_reason: 'Which API?' });
        // A sub-task's run lives inside its Task's run, never on the queue.
        await run('r-child', 'wf-dev', 'ATL-5', 'running', { parent_workflow_run_id: 'r-1' });
        await run('r-done', 'wf-dev', null, 'completed');

        const { workflows, unassigned } = await getQueue();
        expect(workflows).toHaveLength(1);
        const [entry] = workflows;
        expect(entry?.workflow).toMatchObject({ id: 'wf-dev', max_parallel_runs: 1 });
        expect(entry?.running.map((r) => [r.id, r.item_title, r.current_node_id])).toEqual([['r-1', 'Running one', 'subtasks']]);
        expect(entry?.waiting.map((r) => [r.id, r.park_reason])).toEqual([['r-2', 'Which API?']]);
        expect(entry?.queued.map((t) => t.id)).toEqual(['ATL-4', 'ATL-3']);
        expect(entry?.queued[0]).toMatchObject({ title: 'Older', workflow_id: 'wf-dev', status: 'ready' });
        expect(unassigned).toEqual([]);
    });

    it('lists paused workflows and ready Tasks no workflow will pick up', async () => {
        await workflow('wf-dev', 'p1');
        await testDb.updateTable('workflows').set({ status: 'inactive' }).where('id', '=', 'wf-dev').execute();
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Loose', status: 'ready' });
        await insertItem({ id: 'ATL-2', type: 'task', project_id: 'p1', title: 'Draft', status: 'draft' });

        const { workflows, unassigned } = await getQueue();
        expect(workflows.map((e) => [e.workflow.id, e.workflow.status])).toEqual([['wf-dev', 'inactive']]);
        expect(unassigned.map((t) => t.id)).toEqual(['ATL-1']);
    });

    it('skips sub-task workflows, and project-run workflows unless one of their runs is live', async () => {
        await workflow('wf-build', 'p1', 'sub_task');
        await workflow('wf-news', 'p1', 'none');
        await workflow('wf-idle', 'p1', 'none');
        await run('r-news', 'wf-news', null, 'running');

        const { workflows } = await getQueue();
        expect(workflows.map((e) => e.workflow.id)).toEqual(['wf-news']);
        expect(workflows[0]?.running.map((r) => r.id)).toEqual(['r-news']);
    });

    it('scopes workflows and Tasks to project_id', async () => {
        await workflow('wf-a', 'p1');
        await workflow('wf-b', 'p2');
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', status: 'ready' });
        await insertItem({ id: 'OTH-1', type: 'task', project_id: 'p2', status: 'ready' });

        const scoped = await getQueue('?project_id=p2');
        expect(scoped.workflows.map((e) => e.workflow.id)).toEqual(['wf-b']);
        expect(scoped.unassigned.map((t) => t.id)).toEqual(['OTH-1']);
        expect((await getQueue()).unassigned.map((t) => t.id).sort()).toEqual(['ATL-1', 'OTH-1']);
    });
});
