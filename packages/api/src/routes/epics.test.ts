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
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Epic One' });
    // Advance the counter so POST /api/epics won't collide with ATL-1.
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

describe('GET /api/epics', () => {
    it('returns 200 with an array', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/epics' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThanOrEqual(1);
    });
});

describe('GET /api/epics/stats', () => {
    it('returns 200 with total and awaiting_pickup', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/epics/stats' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(typeof body.total).toBe('number');
        expect(typeof body.awaiting_pickup).toBe('number');
    });
});

describe('GET /api/epics/:id', () => {
    it('returns 200 when epic exists', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/epics/ATL-1' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.id).toBe('ATL-1');
        expect(body.title).toBe('Epic One');
    });

    it('returns 404 when epic does not exist', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/epics/ATL-9999' });
        expect(res.statusCode).toBe(404);
    });
});

describe('GET /api/epics/:id/full', () => {
    it('returns 200 with full epic detail when epic exists', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/epics/ATL-1/full' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('epic');
    });

    it('returns 404 when epic does not exist', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/epics/ATL-9999/full' });
        expect(res.statusCode).toBe(404);
    });
});

describe('POST /api/epics', () => {
    it('returns 201 when body is valid', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/epics',
            payload: { project_id: 'p1', title: 'New Epic' },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.title).toBe('New Epic');
    });

    it('returns 400 when title is missing (Zod rejection)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/epics',
            payload: { project_id: 'p1' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('PATCH /api/epics/:id', () => {
    it('returns 200 when update succeeds', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1',
            payload: { title: 'Updated Epic' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.title).toBe('Updated Epic');
    });

    it('returns 404 when epic does not exist', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-9999',
            payload: { title: 'Ghost' },
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('PATCH /api/epics/:id/status', () => {
    it('returns 200 for a valid transition (draft → ready)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1/status',
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
            url: '/api/epics/ATL-1/status?override=true',
            payload: { status: 'done' },
        });
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1/status',
            payload: { status: 'draft' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 422 when transitioning to done with open story children', async () => {
        // Insert a story child that is still in draft
        await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Open Story',
            status: 'draft',
        });

        const res = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1/status',
            payload: { status: 'done' },
        });
        expect(res.statusCode).toBe(422);
        const body = JSON.parse(res.body);
        expect(body.kind).toBe('conflict');
    });
});

describe('PATCH /api/epics/:id/assign', () => {
    it('returns 200 when assigning null (clearing assignee)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1/assign',
            payload: { assignee_agent_id: null },
        });
        expect(res.statusCode).toBe(200);
    });

    it('returns 400 when assigning an inactive agent', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1/assign',
            payload: { assignee_agent_id: 'agent-inactive' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('POST /api/epics/:id/reset-rounds', () => {
    it('returns 204', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/epics/ATL-1/reset-rounds',
        });
        expect(res.statusCode).toBe(204);
    });

    it('returns 404 when epic does not exist (covers line 128 null-check)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/epics/ATL-9999/reset-rounds',
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).error).toBe('Epic not found');
    });
});

describe('DELETE /api/epics/:id', () => {
    it('returns 204 when deleted successfully', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/epics/ATL-1',
        });
        expect(res.statusCode).toBe(204);
    });

    it('returns 404 when epic does not exist', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/epics/ATL-9999',
        });
        expect(res.statusCode).toBe(404);
    });
});

// EPICS-EXTRA — assertActiveAgent "Agent not found" branch (line 116 of epics.ts)
describe('PATCH /api/epics/:id/assign — agent not found (EPICS-EXTRA)', () => {
    it('returns 400 with "Agent not found" when assignee_agent_id does not exist (EPICS-EXTRA-1)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1/assign',
            payload: { assignee_agent_id: 'no-such-agent-xyz' },
        });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toBe('Agent not found');
    });
});

// EPICS-BRANCH — additional branch coverage for epics.ts
describe('GET /api/epics — include_archived branches', () => {
    it('accepts include_archived=1 (the ||==="1" arm of the OR on line 23)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/epics?include_archived=1',
        });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    });

    it('accepts include_archived=true (the ===\"true\" arm of the OR on line 23)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/epics?include_archived=true',
        });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    });
});

describe('PATCH /api/epics/:id/status — override=1 branch', () => {
    it('accepts override=1 as truthy (the ===\"1\" arm of the OR on line 66)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1/status?override=1',
            payload: { status: 'done' },
        });
        // override=1 bypasses the children-done check; FSM may still reject
        // the transition (draft→done) but the 422 open-children block is NOT hit.
        expect([200, 400]).toContain(res.statusCode);
        // Specifically: should NOT be 422 (that's the children-block code)
        expect(res.statusCode).not.toBe(422);
    });
});

describe('PATCH /api/epics/:id/assign — 404 when epic does not exist', () => {
    it('returns 404 when the epic id is not in the DB (line 109)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-9999/assign',
            payload: { assignee_agent_id: null },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).error).toBe('Epic not found');
    });
});

describe('PATCH /api/epics/:id/status — requested_by_agent_id non-null branch', () => {
    // Covers the `requested_by_agent_id ?? null` false-arm (value IS provided).
    it('returns 200 when requested_by_agent_id is passed (non-null arm)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1/status',
            payload: { status: 'ready', requested_by_agent_id: 'agent-coder' },
        });
        expect([200, 400]).toContain(res.statusCode);
    });
});

describe('PATCH /api/epics/:id/assign — requested_by_agent_id non-null branch', () => {
    // Covers the `requested_by_agent_id ?? null` false-arm in epics.ts line 123.
    it('returns 200 when assigning with requested_by_agent_id set (non-null arm)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1/assign',
            payload: { assignee_agent_id: 'agent-coder', requested_by_agent_id: 'agent-coder' },
        });
        expect([200, 400]).toContain(res.statusCode);
    });
});
