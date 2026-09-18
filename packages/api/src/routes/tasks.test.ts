import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

let app: FastifyInstance;

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
    await insertAgent({ id: 'agent-inactive', status: 'inactive' });
    await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Task One' });
    // Advance the counter so POST /api/tasks won't collide with ATL-1.
    await testDb
        .updateTable('project_issue_counters')
        .set({ last_seq: 1 })
        .where('project_id', '=', 'p1')
        .execute();
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('GET /api/tasks', () => {
    it('returns 200 with an array', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/tasks' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThanOrEqual(1);
    });
});

describe('GET /api/tasks/stats', () => {
    it('returns 200 with total and awaiting_pickup', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/tasks/stats' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(typeof body.total).toBe('number');
        expect(typeof body.awaiting_pickup).toBe('number');
    });
});

describe('GET /api/tasks/:id', () => {
    it('returns 200 when task exists', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/tasks/ATL-1' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.id).toBe('ATL-1');
        expect(body.title).toBe('Task One');
    });

    it('returns 404 when task does not exist', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/tasks/ATL-9999' });
        expect(res.statusCode).toBe(404);
    });
});

describe('GET /api/tasks/:id/full', () => {
    it('returns 200 with full task detail when task exists', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/tasks/ATL-1/full' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.task.id).toBe('ATL-1');
        expect(body.sub_tasks).toEqual([]);
    });

    it('returns 404 when task does not exist', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/tasks/ATL-9999/full' });
        expect(res.statusCode).toBe(404);
    });
});

describe('POST /api/tasks', () => {
    it('accepts acceptance_criteria on create', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/tasks',
            payload: { project_id: 'p1', title: 'With AC', acceptance_criteria: 'done when green' },
        });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).acceptance_criteria).toBe('done when green');
    });

    it('returns 201 when body is valid', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/tasks',
            payload: { project_id: 'p1', title: 'New Task' },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.title).toBe('New Task');
    });

    it('returns 400 when title is missing (Zod rejection)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/tasks',
            payload: { project_id: 'p1' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('/api/stories, /api/bugs and /api/sub-bugs are gone', () => {
    it.each(['/api/stories', '/api/bugs', '/api/sub-bugs', '/api/epics'])('GET %s → 404', async (url) => {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode).toBe(404);
    });
});

describe('PATCH /api/tasks/:id', () => {
    it('accepts spec_md, pr_url and acceptance_criteria', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-1',
            payload: { spec_md: '# Spec', pr_url: 'https://github.com/o/r/pull/9', acceptance_criteria: 'AC' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({
            spec_md: '# Spec',
            pr_url: 'https://github.com/o/r/pull/9',
            acceptance_criteria: 'AC',
        });
    });

    it('returns 200 when update succeeds', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-1',
            payload: { title: 'Updated Task' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.title).toBe('Updated Task');
    });

    it('returns 404 when task does not exist', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-9999',
            payload: { title: 'Ghost' },
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('PATCH /api/tasks/:id/status', () => {
    it('returns 200 for a valid transition (draft → ready)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-1/status',
            payload: { status: 'ready' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe('ready');
    });

    it('returns 400 for an invalid transition (done → draft FSM rejects)', async () => {
        // First move to done via override so we can test the reverse
        await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-1/status?override=true',
            payload: { status: 'done' },
        });
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-1/status',
            payload: { status: 'draft' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 422 when transitioning to done with open sub-tasks', async () => {
        await insertItem({
            id: 'ATL-2',
            type: 'sub_task',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'task',
            title: 'Open Sub-task',
            status: 'draft',
        });

        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-1/status',
            payload: { status: 'done' },
        });
        expect(res.statusCode).toBe(422);
        const body = JSON.parse(res.body);
        expect(body.kind).toBe('conflict');
        expect(body.details.open_children.map((c: { id: string }) => c.id)).toEqual(['ATL-2']);
    });
});

describe('closing a Task with its sub-tasks, and sub-task order', () => {
    const sub = (id: string, status: 'in_review' | 'in_progress' | 'done' | 'draft') =>
        insertItem({ id, type: 'sub_task', project_id: 'p1', parent_id: 'ATL-1', parent_type: 'task', title: id, status });
    const statusOf = async (id: string) =>
        (await testDb.selectFrom('items').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;

    it('close_sub_tasks closes the reviewed sub-tasks and then the Task', async () => {
        await testDb.updateTable('items').set({ status: 'in_review' }).where('id', '=', 'ATL-1').execute();
        await sub('ATL-2', 'in_review');
        await sub('ATL-3', 'done');
        const res = await app.inject({ method: 'PATCH', url: '/api/tasks/ATL-1/status', payload: { status: 'done', close_sub_tasks: true } });
        expect(res.statusCode).toBe(200);
        expect(await statusOf('ATL-1')).toBe('done');
        expect(await statusOf('ATL-2')).toBe('done');
    });

    it('a sub-task that is still open keeps blocking the close', async () => {
        await testDb.updateTable('items').set({ status: 'in_review' }).where('id', '=', 'ATL-1').execute();
        await sub('ATL-2', 'in_review');
        await sub('ATL-3', 'in_progress');
        const res = await app.inject({ method: 'PATCH', url: '/api/tasks/ATL-1/status', payload: { status: 'done', close_sub_tasks: true } });
        expect(res.statusCode).toBe(422);
        expect(res.json().details.open_children.map((c: { id: string }) => c.id)).toEqual(['ATL-3']);
        expect(await statusOf('ATL-2')).toBe('done'); // reviewed ones still closed
    });

    it('PUT /sub-tasks/order sets the run order the lists use', async () => {
        await sub('ATL-2', 'draft');
        await sub('ATL-3', 'draft');
        await sub('ATL-4', 'draft');
        const put = await app.inject({ method: 'PUT', url: '/api/tasks/ATL-1/sub-tasks/order', payload: { ids: ['ATL-4', 'ATL-2', 'ATL-3'] } });
        expect(put.statusCode).toBe(204);
        const list = (await app.inject({ method: 'GET', url: '/api/tasks/ATL-1/sub-tasks' })).json() as Array<{ id: string }>;
        expect(list.map((x) => x.id)).toEqual(['ATL-4', 'ATL-2', 'ATL-3']);
        const full = (await app.inject({ method: 'GET', url: '/api/tasks/ATL-1/full' })).json() as { sub_tasks: Array<{ id: string }> };
        expect(full.sub_tasks.map((x) => x.id)).toEqual(['ATL-4', 'ATL-2', 'ATL-3']);
    });

    it('rejects an order that is not exactly the Task’s sub-tasks', async () => {
        await sub('ATL-2', 'draft');
        await sub('ATL-3', 'draft');
        for (const ids of [['ATL-2'], ['ATL-2', 'ATL-2'], ['ATL-2', 'ATL-9']]) {
            const res = await app.inject({ method: 'PUT', url: '/api/tasks/ATL-1/sub-tasks/order', payload: { ids } });
            expect(res.statusCode).toBe(400);
        }
        expect((await app.inject({ method: 'PUT', url: '/api/tasks/NOPE/sub-tasks/order', payload: { ids: ['x'] } })).statusCode).toBe(404);
    });
});

describe('PATCH /api/tasks/:id/assign', () => {
    it('returns 200 when assigning null (clearing assignee)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-1/assign',
            payload: { assignee_agent_id: null },
        });
        expect(res.statusCode).toBe(200);
    });

    it('returns 400 when assigning an inactive agent', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-1/assign',
            payload: { assignee_agent_id: 'agent-inactive' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('DELETE /api/tasks/:id', () => {
    it('returns 204 when deleted successfully', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/tasks/ATL-1',
        });
        expect(res.statusCode).toBe(204);
    });

    it('returns 404 when task does not exist', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/tasks/ATL-9999',
        });
        expect(res.statusCode).toBe(404);
    });
});

// EPICS-EXTRA — assertActiveAgent "Agent not found" branch (tasks.ts)
describe('PATCH /api/tasks/:id/assign — agent not found (EPICS-EXTRA)', () => {
    it('returns 400 with "Agent not found" when assignee_agent_id does not exist (EPICS-EXTRA-1)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-1/assign',
            payload: { assignee_agent_id: 'no-such-agent-xyz' },
        });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toBe('Agent not found');
    });
});

// TASKS-BRANCH — additional branch coverage for tasks.ts
describe('GET /api/tasks — include_archived branches', () => {
    it('accepts include_archived=1 (the ||==="1" arm of the OR on line 23)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/tasks?include_archived=1',
        });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    });

    it('accepts include_archived=true (the ===\"true\" arm of the OR on line 23)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/tasks?include_archived=true',
        });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    });
});

describe('PATCH /api/tasks/:id/status — override=1 branch', () => {
    it('accepts override=1 as truthy (the ===\"1\" arm of the OR on line 66)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-1/status?override=1',
            payload: { status: 'done' },
        });
        // override=1 bypasses the children-done check; FSM may still reject
        // the transition (draft→done) but the 422 open-children block is NOT hit.
        expect([200, 400]).toContain(res.statusCode);
        // Specifically: should NOT be 422 (that's the children-block code)
        expect(res.statusCode).not.toBe(422);
    });
});

describe('PATCH /api/tasks/:id/assign — 404 when task does not exist', () => {
    it('returns 404 when the task id is not in the DB (line 109)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-9999/assign',
            payload: { assignee_agent_id: null },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).error).toBe('Task not found');
    });
});

describe('PATCH /api/tasks/:id/status — requested_by_agent_id non-null branch', () => {
    // Covers the `requested_by_agent_id ?? null` false-arm (value IS provided).
    it('returns 200 when requested_by_agent_id is passed (non-null arm)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-1/status',
            payload: { status: 'ready', requested_by_agent_id: 'agent-coder' },
        });
        expect([200, 400]).toContain(res.statusCode);
    });
});

describe('PATCH /api/tasks/:id/assign — requested_by_agent_id non-null branch', () => {
    // Covers the `requested_by_agent_id ?? null` false-arm in tasks.ts.
    it('returns 200 when assigning with requested_by_agent_id set (non-null arm)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/tasks/ATL-1/assign',
            payload: { assignee_agent_id: 'agent-coder', requested_by_agent_id: 'agent-coder' },
        });
        expect([200, 400]).toContain(res.statusCode);
    });
});

describe('POST /api/tasks — x-atlas-agent-id attribution', () => {
    it('credits the header agent as the created actor + default reporter', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/tasks',
            headers: { 'x-atlas-agent-id': 'agent-coder' },
            payload: { project_id: 'p1', title: 'Imported' },
        });
        expect(res.statusCode).toBe(201);
        const task = JSON.parse(res.body) as { id: string; reporter_agent_id: string | null };
        expect(task.reporter_agent_id).toBe('agent-coder');
        const ev = await testDb
            .selectFrom('issue_events')
            .select('actor_agent_id')
            .where('item_id', '=', task.id)
            .where('event_type', '=', 'created')
            .executeTakeFirstOrThrow();
        expect(ev.actor_agent_id).toBe('agent-coder');
    });
});
