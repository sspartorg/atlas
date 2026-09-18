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
    // Advance counter past the seed item so POST routes don't collide.
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

async function createSubTask(title = 'Sub-task', extra: Record<string, unknown> = {}): Promise<{ id: string }> {
    const res = await app.inject({
        method: 'POST',
        url: '/api/tasks/ATL-1/sub-tasks',
        payload: { title, ...extra },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body) as { id: string };
}

describe('POST /api/tasks/:id/sub-tasks', () => {
    it('returns 201 and parents the sub-task to the path task', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/tasks/ATL-1/sub-tasks',
            payload: { title: 'New Sub-task', acceptance_criteria: 'AC', labels: ['qa'] },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ title: 'New Sub-task', task_id: 'ATL-1', acceptance_criteria: 'AC', labels: ['qa'] });
        expect(body).not.toHaveProperty('workflow_id');
    });

    it('the path wins over a body task_id', async () => {
        await insertItem({ id: 'ATL-50', type: 'task', project_id: 'p1', title: 'Other' });
        const res = await app.inject({
            method: 'POST',
            url: '/api/tasks/ATL-1/sub-tasks',
            payload: { title: 'x', task_id: 'ATL-50' },
        });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).task_id).toBe('ATL-1');
    });

    it('returns 404 when the task does not exist (or is a sub-task)', async () => {
        const sub = await createSubTask();
        for (const id of ['ATL-9999', sub.id]) {
            const res = await app.inject({
                method: 'POST',
                url: `/api/tasks/${id}/sub-tasks`,
                payload: { title: 'orphan' },
            });
            expect(res.statusCode).toBe(404);
        }
    });

    it('returns 400 when title is missing (Zod rejection)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/tasks/ATL-1/sub-tasks',
            payload: {},
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('GET sub-task lists', () => {
    it('GET /api/tasks/:id/sub-tasks lists only that task’s sub-tasks', async () => {
        await insertItem({ id: 'ATL-50', type: 'task', project_id: 'p1', title: 'Other' });
        await insertItem({ id: 'ATL-51', type: 'sub_task', project_id: 'p1', parent_id: 'ATL-50', title: 'other sub' });
        const mine = await createSubTask('mine');
        const res = await app.inject({ method: 'GET', url: '/api/tasks/ATL-1/sub-tasks' });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).map((s: { id: string }) => s.id)).toEqual([mine.id]);
    });

    it('GET /api/sub-tasks returns every sub-task', async () => {
        await createSubTask('a');
        await createSubTask('b');
        const res = await app.inject({ method: 'GET', url: '/api/sub-tasks' });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toHaveLength(2);
    });
});

describe('GET /api/sub-tasks/:id', () => {
    it('returns the sub-task', async () => {
        const sub = await createSubTask('one');
        const res = await app.inject({ method: 'GET', url: `/api/sub-tasks/${sub.id}` });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ id: sub.id, task_id: 'ATL-1', title: 'one' });
    });

    it('returns 404 for a missing id or a task id', async () => {
        for (const id of ['ATL-9999', 'ATL-1']) {
            const res = await app.inject({ method: 'GET', url: `/api/sub-tasks/${id}` });
            expect(res.statusCode).toBe(404);
        }
    });
});

describe('GET /api/sub-tasks/:id/full', () => {
    it('returns the sub-task with its parent task and project', async () => {
        const sub = await createSubTask('Sub-task for full');
        const res = await app.inject({ method: 'GET', url: `/api/sub-tasks/${sub.id}/full` });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.sub_task).toMatchObject({ id: sub.id });
        expect(body.task).toMatchObject({ id: 'ATL-1', title: 'Task One' });
        expect(body.project).toMatchObject({ id: 'p1' });
    });

    it('returns 404 for missing sub-task', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/sub-tasks/ATL-9999/full' });
        expect(res.statusCode).toBe(404);
    });
});

describe('PATCH /api/sub-tasks/:id', () => {
    it('returns 200 when update succeeds', async () => {
        const sub = await createSubTask('Sub-task to Update');
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/sub-tasks/${sub.id}`,
            payload: { title: 'Updated Sub-task', acceptance_criteria: 'AC', labels: ['x'] },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ title: 'Updated Sub-task', acceptance_criteria: 'AC', labels: ['x'] });
    });

    it('returns 404 when sub-task does not exist', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/sub-tasks/ATL-9999',
            payload: { title: 'Ghost' },
        });
        expect(res.statusCode).toBe(404);
    });

    it('returns 400 for task-only fields and invalid values (Zod rejection)', async () => {
        const sub = await createSubTask();
        for (const payload of [{ priority: 'invalid-priority-value' }, { spec_md: 'no' }]) {
            const res = await app.inject({ method: 'PATCH', url: `/api/sub-tasks/${sub.id}`, payload });
            expect(res.statusCode).toBe(400);
        }
    });
});

describe('PATCH /api/sub-tasks/:id/status', () => {
    it('returns 200 for a valid transition (draft → ready)', async () => {
        const sub = await createSubTask();
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/sub-tasks/${sub.id}/status`,
            payload: { status: 'ready', requested_by_agent_id: 'agent-coder' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).status).toBe('ready');
    });

    it('returns 400 for an invalid transition (done → draft FSM rejects)', async () => {
        const sub = await createSubTask();
        await app.inject({
            method: 'PATCH',
            url: `/api/sub-tasks/${sub.id}/status?override=true`,
            payload: { status: 'done' },
        });
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/sub-tasks/${sub.id}/status`,
            payload: { status: 'draft' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('accepts override=1 as truthy', async () => {
        const sub = await createSubTask();
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/sub-tasks/${sub.id}/status?override=1`,
            payload: { status: 'done' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).status).toBe('done');
    });

    it('returns 400 when status value is invalid (Zod rejection)', async () => {
        const sub = await createSubTask();
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/sub-tasks/${sub.id}/status`,
            payload: { status: 'not-a-valid-status' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('PATCH /api/sub-tasks/:id/assign', () => {
    it('assigns an active agent and clears with null', async () => {
        const sub = await createSubTask();
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/sub-tasks/${sub.id}/assign`,
            payload: { assignee_agent_id: 'agent-coder', requested_by_agent_id: 'agent-coder' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).assignee_agent_id).toBe('agent-coder');
        const cleared = await app.inject({
            method: 'PATCH',
            url: `/api/sub-tasks/${sub.id}/assign`,
            payload: { assignee_agent_id: null },
        });
        expect(JSON.parse(cleared.body).assignee_agent_id).toBeNull();
    });

    it('returns 400 for an inactive or unknown agent', async () => {
        const sub = await createSubTask();
        for (const [agent, error] of [
            ['agent-inactive', 'Agent is not active'],
            ['no-such-agent', 'Agent not found'],
        ] as const) {
            const res = await app.inject({
                method: 'PATCH',
                url: `/api/sub-tasks/${sub.id}/assign`,
                payload: { assignee_agent_id: agent },
            });
            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.body).error).toBe(error);
        }
    });

    it('returns 404 when the sub-task does not exist', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/sub-tasks/ATL-9999/assign',
            payload: { assignee_agent_id: null },
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('DELETE /api/sub-tasks/:id', () => {
    it('returns 204 when deleted, 404 after', async () => {
        const sub = await createSubTask();
        const res = await app.inject({ method: 'DELETE', url: `/api/sub-tasks/${sub.id}` });
        expect(res.statusCode).toBe(204);
        const again = await app.inject({ method: 'DELETE', url: `/api/sub-tasks/${sub.id}` });
        expect(again.statusCode).toBe(404);
    });
});

describe('PATCH routes — x-atlas-agent-id attribution on field_updated', () => {
    it.each([
        { url: 'SUB', payload: { title: 'Renamed sub-task' } },
        { url: '/api/tasks/ATL-1', payload: { title: 'Renamed task' } },
    ])('PATCH $url credits the header agent on field_updated', async (c) => {
        const url = c.url === 'SUB' ? `/api/sub-tasks/${(await createSubTask()).id}` : c.url;
        const res = await app.inject({
            method: 'PATCH',
            url,
            headers: { 'x-atlas-agent-id': 'agent-coder' },
            payload: c.payload,
        });
        expect(res.statusCode).toBe(200);
        const events = await testDb
            .selectFrom('issue_events')
            .select('actor_agent_id')
            .where('event_type', '=', 'field_updated')
            .execute();
        expect(events.map((e) => e.actor_agent_id)).toEqual(['agent-coder']);
    });
});

describe('create routes — x-atlas-agent-id attribution', () => {
    async function createdEvent(itemId: string) {
        return testDb
            .selectFrom('issue_events')
            .select('actor_agent_id')
            .where('item_id', '=', itemId)
            .where('event_type', '=', 'created')
            .executeTakeFirstOrThrow();
    }

    it.each([
        { url: '/api/tasks', payload: { project_id: 'p1', title: 'T' } },
        { url: '/api/tasks/ATL-1/sub-tasks', payload: { title: 'S' } },
    ])('POST $url credits the header agent as actor + default reporter', async (c) => {
        const res = await app.inject({
            method: 'POST',
            url: c.url,
            headers: { 'x-atlas-agent-id': 'agent-coder' },
            payload: c.payload,
        });
        expect(res.statusCode).toBe(201);
        const item = JSON.parse(res.body) as { id: string; reporter_agent_id: string | null };
        expect(item.reporter_agent_id).toBe('agent-coder');
        expect((await createdEvent(item.id)).actor_agent_id).toBe('agent-coder');
    });

    it('keeps an explicit body reporter but still credits the header agent as actor', async () => {
        await insertAgent({ id: 'agent-po-writer' });
        const res = await app.inject({
            method: 'POST',
            url: '/api/tasks/ATL-1/sub-tasks',
            headers: { 'x-atlas-agent-id': 'agent-po-writer' },
            payload: { title: 'S', reporter_agent_id: 'agent-coder' },
        });
        const item = JSON.parse(res.body) as { id: string; reporter_agent_id: string | null };
        expect(item.reporter_agent_id).toBe('agent-coder');
        expect((await createdEvent(item.id)).actor_agent_id).toBe('agent-po-writer');
    });

    it('ignores a header naming an unknown agent (Owner attribution, no FK 500)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/tasks/ATL-1/sub-tasks',
            headers: { 'x-atlas-agent-id': 'agent-nope' },
            payload: { title: 'S' },
        });
        expect(res.statusCode).toBe(201);
        const item = JSON.parse(res.body) as { id: string; reporter_agent_id: string | null };
        expect(item.reporter_agent_id).toBeNull();
        expect((await createdEvent(item.id)).actor_agent_id).toBeNull();
    });
});
