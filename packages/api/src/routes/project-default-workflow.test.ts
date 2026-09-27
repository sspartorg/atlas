import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';

vi.mock('../routes/events.js', () => ({ eventsRoutes: async () => undefined, broadcastSSE: vi.fn() }));

import { buildApp } from '../server.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertProject } from '../../tests/_items.js';

// Migration 022 — a project's default workflow, and `workflow_id` on Task
// create. The default is only ever preselected by /tasks/new; the server never
// applies it on its own, so a Jira import (or any create without a
// `workflow_id`) still lands as an unqueued draft (ADR 0016).

let app: FastifyInstance;

const graph = {
    nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
        { id: 'coder', type: 'agent', agent_id: 'agent-coder', position: { x: 200, y: 0 } },
        { id: 'end', type: 'end', position: { x: 400, y: 0 } },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'coder', kind: 'pass' },
        { id: 'e2', source: 'coder', target: 'end', kind: 'pass' },
    ],
};

async function createWorkflow(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await app.inject({
        method: 'POST',
        url: '/api/workflows',
        payload: { name: 'Quick', project_id: 'p1', graph, ...overrides },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
}

const patchProject = (id: string, payload: unknown) =>
    app.inject({ method: 'PATCH', url: `/api/projects/${id}`, payload: payload as object });

const createTask = (payload: Record<string, unknown>) =>
    app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { project_id: 'p1', title: 'Small fix', ...payload },
    });

const taskCount = async () =>
    Number(
        (
            await testDb
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('type', '=', 'task')
                .executeTakeFirstOrThrow()
        ).n,
    );

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertProject('p2', 'OTH');
    await insertAgent({ id: 'agent-coder', status: 'active' });
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('migration 022 — projects.default_workflow_id', () => {
    it('is a nullable column that deleting the workflow clears', async () => {
        const col = await sql<{ is_nullable: string }>`
            SELECT is_nullable FROM information_schema.columns
             WHERE table_name = 'projects' AND column_name = 'default_workflow_id'
        `.execute(testDb);
        expect(col.rows).toEqual([{ is_nullable: 'YES' }]);

        const wf = await createWorkflow();
        expect((await patchProject('p1', { default_workflow_id: wf })).statusCode).toBe(200);
        expect((await app.inject({ method: 'DELETE', url: `/api/workflows/${wf}` })).statusCode).toBe(204);
        // ON DELETE SET NULL: the project survives with no preselection.
        const project = await app.inject({ method: 'GET', url: '/api/projects/p1' });
        expect(project.json()).toMatchObject({ id: 'p1', default_workflow_id: null });
    });
});

describe('PATCH /api/projects/:id — default_workflow_id', () => {
    it('starts null, then sets and clears a workflow of this project', async () => {
        expect((await app.inject({ method: 'GET', url: '/api/projects/p1' })).json().default_workflow_id).toBeNull();
        const wf = await createWorkflow();

        const set = await patchProject('p1', { default_workflow_id: wf });
        expect(set.statusCode).toBe(200);
        expect(set.json().default_workflow_id).toBe(wf);
        const listed = (await app.inject({ method: 'GET', url: '/api/projects' })).json() as Array<{ id: string; default_workflow_id: string | null }>;
        expect(listed.find((p) => p.id === 'p1')?.default_workflow_id).toBe(wf);

        const cleared = await patchProject('p1', { default_workflow_id: null });
        expect(cleared.statusCode).toBe(200);
        expect(cleared.json().default_workflow_id).toBeNull();
    });

    it('refuses a workflow that cannot take this project’s Tasks', async () => {
        const other = await createWorkflow({ project_id: 'p2', name: 'Other' });
        const sub = await createWorkflow({ name: 'Sub', input_kind: 'sub_task' });

        expect((await patchProject('p1', { default_workflow_id: other })).statusCode).toBe(400);
        expect((await patchProject('p1', { default_workflow_id: sub })).statusCode).toBe(400);
        expect((await patchProject('p1', { default_workflow_id: 'wf-ghost' })).statusCode).toBe(404);
        // Nothing was written by any of them.
        expect((await app.inject({ method: 'GET', url: '/api/projects/p1' })).json().default_workflow_id).toBeNull();
    });
});

describe('POST /api/tasks — workflow_id', () => {
    it('queues the new Task on the workflow: Ready, workflow set, event logged', async () => {
        const wf = await createWorkflow();
        const res = await createTask({ workflow_id: wf });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({ status: 'ready', workflow_id: wf });

        const events = await testDb
            .selectFrom('issue_events')
            .select(['event_type', 'to_value', 'detail'])
            .where('item_id', '=', res.json().id as string)
            .where('event_type', '=', 'status_changed')
            .execute();
        expect(events).toEqual([{ event_type: 'status_changed', to_value: 'ready', detail: `queued_for_workflow: ${wf}` }]);
    });

    // The Owner's rule for Jira (ADR 0016) generalised: the server never falls
    // back to the project default, so only the form can apply it.
    it('leaves a Task without workflow_id an unqueued draft, even when the project has a default', async () => {
        const wf = await createWorkflow();
        await patchProject('p1', { default_workflow_id: wf });
        const res = await createTask({});
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({ status: 'draft', workflow_id: null });
    });

    it('refuses a bad workflow before creating anything', async () => {
        const other = await createWorkflow({ project_id: 'p2', name: 'Other' });
        const sub = await createWorkflow({ name: 'Sub', input_kind: 'sub_task' });

        expect((await createTask({ workflow_id: 'wf-ghost' })).statusCode).toBe(404);
        expect((await createTask({ workflow_id: other })).statusCode).toBe(400);
        expect((await createTask({ workflow_id: sub })).statusCode).toBe(400);
        expect((await createTask({ workflow_id: '' })).statusCode).toBe(400);
        expect(await taskCount()).toBe(0);
    });

    // A Task can't be created without a repo, so `setItemWorkflow`'s "no
    // repos" 409 is unreachable from create: the repo check refuses first,
    // and still before any row is written.
    it('refuses a project with no repos before queueing or creating', async () => {
        await insertProject('p3', 'NOR', { no_repo: true });
        const wf = await createWorkflow({ project_id: 'p3', name: 'NoRepo' });
        const res = await app.inject({
            method: 'POST',
            url: '/api/tasks',
            payload: { project_id: 'p3', title: 'Nowhere', workflow_id: wf },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(/no repos/);
        expect(await taskCount()).toBe(0);
    });
});
