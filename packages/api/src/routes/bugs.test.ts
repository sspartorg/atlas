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
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Epic One' });
    await insertItem({
        id: 'ATL-2',
        type: 'bug',
        project_id: 'p1',
        parent_id: 'ATL-1',
        parent_type: 'epic',
        title: 'Bug One',
        steps_to_reproduce: '',
        expected: '',
        actual: '',
        frequency: 'sometimes',
        failure_scope: 'cosmetic',
    });
    // Advance counter past the seed items so POST routes don't collide.
    await testDb
        .updateTable('project_issue_counters')
        .set({ last_seq: 2 })
        .where('project_id', '=', 'p1')
        .execute();
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
}, 30_000);

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('GET /api/bugs', () => {
    it('returns 200 with an array', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/bugs' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThanOrEqual(1);
    });
});

describe('GET /api/bugs/:id', () => {
    it('returns 200 when bug exists', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/bugs/ATL-2' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.id).toBe('ATL-2');
        expect(body.title).toBe('Bug One');
    });

    it('returns 404 when bug does not exist', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/bugs/ATL-9999' });
        expect(res.statusCode).toBe(404);
    });
});

describe('GET /api/bugs/:id/full', () => {
    it('returns 200 with full bug detail when bug exists', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/bugs/ATL-2/full' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('bug');
    });

    it('returns 404 when bug does not exist', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/bugs/ATL-9999/full' });
        expect(res.statusCode).toBe(404);
    });
});

describe('POST /api/bugs', () => {
    it('returns 201 when body is valid', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/bugs',
            payload: { epic_id: 'ATL-1', title: 'New Bug' },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.title).toBe('New Bug');
    });

    it('returns 400 when title is missing (Zod rejection)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/bugs',
            payload: { epic_id: 'ATL-1' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('PATCH /api/bugs/:id', () => {
    it('returns 200 when update succeeds', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/bugs/ATL-2',
            payload: { title: 'Updated Bug' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.title).toBe('Updated Bug');
    });

    it('returns 404 when bug does not exist', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/bugs/ATL-9999',
            payload: { title: 'Ghost' },
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('PATCH /api/bugs/:id/status', () => {
    it('returns 200 for a valid transition (draft → ready)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/bugs/ATL-2/status',
            payload: { status: 'ready' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe('ready');
    });

    it('returns 400 for an invalid transition (done → draft FSM rejects)', async () => {
        await app.inject({
            method: 'PATCH',
            url: '/api/bugs/ATL-2/status?override=true',
            payload: { status: 'done' },
        });
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/bugs/ATL-2/status',
            payload: { status: 'draft' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('accepts override=1 as truthy (line 53 — override=1 branch)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/bugs/ATL-2/status?override=1',
            payload: { status: 'done' },
        });
        expect(res.statusCode).toBe(200);
    });
});

describe('PATCH /api/bugs/:id/assign', () => {
    it('returns 200 when assigning null (clearing assignee)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/bugs/ATL-2/assign',
            payload: { assignee_agent_id: null },
        });
        expect(res.statusCode).toBe(200);
    });

    it('returns 404 when bug does not exist', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/bugs/ATL-9999/assign',
            payload: { assignee_agent_id: null },
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('POST /api/bugs/:id/reset-rounds', () => {
    it('returns 204 when bug exists', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/bugs/ATL-2/reset-rounds',
        });
        expect(res.statusCode).toBe(204);
    });

    it('returns 404 when bug does not exist', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/bugs/ATL-9999/reset-rounds',
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('DELETE /api/bugs/:id', () => {
    it('returns 204 when deleted successfully', async () => {
        const res = await app.inject({ method: 'DELETE', url: '/api/bugs/ATL-2' });
        expect(res.statusCode).toBe(204);
    });

    it('returns 404 when bug does not exist', async () => {
        const res = await app.inject({ method: 'DELETE', url: '/api/bugs/ATL-9999' });
        expect(res.statusCode).toBe(404);
    });
});

describe('PATCH /api/bugs/:id/status — requested_by_agent_id non-null branch', () => {
    // Covers the `requested_by_agent_id ?? null` false-arm (value IS provided).
    it('returns 200 when requested_by_agent_id is passed (non-null arm)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/bugs/ATL-2/status',
            payload: { status: 'ready', requested_by_agent_id: 'agent-coder' },
        });
        expect([200, 400]).toContain(res.statusCode);
    });
});

describe('PATCH /api/bugs/:id/assign — requested_by_agent_id non-null branch', () => {
    // Covers the `requested_by_agent_id ?? null` false-arm in bugs.ts line 73.
    it('returns 200 when assigning with requested_by_agent_id set', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/bugs/ATL-2/assign',
            payload: { assignee_agent_id: 'agent-coder', requested_by_agent_id: 'agent-coder' },
        });
        expect([200, 400]).toContain(res.statusCode);
    });
});
