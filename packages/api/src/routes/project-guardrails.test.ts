import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';

let app: FastifyInstance;

// Build the Fastify app once for the whole file — every test only needs
// a fresh DB state, not a fresh server. Matches the pattern in other
// route test files (e.g. comments.test.ts, schedules.test.ts).
beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

// CreateProjectGuardrailSchema: title (string min1), body_md (string min1),
// icon (string max40, default 'shield'), enabled (0|1, default 1), sort_order (int, default 0)
const VALID_RULE = {
    title: 'No production DB access',
    body_md: 'Agents must not connect to the production database.',
};

describe('GET /api/projects/:projectId/guardrails', () => {
    it('returns 200 with empty array for existing project', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/projects/p1/guardrails',
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns 404 for missing project', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/projects/no-such/guardrails',
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('POST /api/projects/:projectId/guardrails', () => {
    it('creates a project guardrail and returns 201', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/projects/p1/guardrails',
            payload: VALID_RULE,
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ title: VALID_RULE.title });
        expect(body.id).toBeDefined();
    });

    it('returns 400 for missing title', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/projects/p1/guardrails',
            payload: { body_md: 'some rule' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 404 for missing project', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/projects/no-such/guardrails',
            payload: VALID_RULE,
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('PATCH /api/projects/:projectId/guardrails/:id', () => {
    it('updates a project guardrail and returns 200', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/projects/p1/guardrails',
            payload: VALID_RULE,
        });
        expect(created.statusCode).toBe(201);
        const { id } = JSON.parse(created.body) as { id: string };

        const res = await app.inject({
            method: 'PATCH',
            url: `/api/projects/p1/guardrails/${id}`,
            payload: { title: 'Updated Title' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ title: 'Updated Title' });
    });

    it('returns 404 for missing rule', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/projects/p1/guardrails/99999',
            payload: { title: 'x' },
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('PATCH /api/projects/:projectId/guardrails/:id/toggle', () => {
    it('toggles a project guardrail enabled state', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/projects/p1/guardrails',
            payload: VALID_RULE,
        });
        expect(created.statusCode).toBe(201);
        const { id } = JSON.parse(created.body) as { id: string };

        const res = await app.inject({
            method: 'PATCH',
            url: `/api/projects/p1/guardrails/${id}/toggle`,
            payload: { enabled: 0 },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ enabled: 0 });
    });

    it('returns 404 for missing rule', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/projects/p1/guardrails/99999/toggle',
            payload: { enabled: 1 },
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('DELETE /api/projects/:projectId/guardrails/:id', () => {
    it('deletes a project guardrail and returns 204', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/projects/p1/guardrails',
            payload: VALID_RULE,
        });
        expect(created.statusCode).toBe(201);
        const { id } = JSON.parse(created.body) as { id: string };

        const res = await app.inject({
            method: 'DELETE',
            url: `/api/projects/p1/guardrails/${id}`,
        });
        expect(res.statusCode).toBe(204);
    });

    it('returns 404 for missing rule', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/projects/p1/guardrails/99999',
        });
        expect(res.statusCode).toBe(404);
    });
});
