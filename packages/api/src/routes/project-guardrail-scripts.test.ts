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
}, 30_000);

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

// CreateProjectGuardrailScriptSchema = CreateGuardrailScriptSchema:
//   id: kebab-case slug, name, description (opt), body_sh (min1), body_ps1 (min1), sort_order
const VALID_SCRIPT = {
    id: 'proj-no-network',
    name: 'No Network (project)',
    description: 'Block network from within project context',
    body_sh: '#!/bin/bash\necho "blocked" >&2\nexit 1',
    body_ps1: 'Write-Error "blocked"\nexit 1',
};

describe('GET /api/projects/:projectId/guardrail-scripts', () => {
    it('returns 200 with empty array for existing project', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/projects/p1/guardrail-scripts',
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns 404 for missing project', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/projects/no-such/guardrail-scripts',
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('POST /api/projects/:projectId/guardrail-scripts', () => {
    it('creates a script and returns 201', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/projects/p1/guardrail-scripts',
            payload: VALID_SCRIPT,
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ id: VALID_SCRIPT.id, name: VALID_SCRIPT.name });
    });

    it('returns 400 for missing body_ps1', async () => {
        const { body_ps1: _, ...noPs1 } = VALID_SCRIPT;
        const res = await app.inject({
            method: 'POST',
            url: '/api/projects/p1/guardrail-scripts',
            payload: noPs1,
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 404 for missing project', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/projects/no-such/guardrail-scripts',
            payload: VALID_SCRIPT,
        });
        expect(res.statusCode).toBe(404);
    });

    it('returns 409 for duplicate script id within project', async () => {
        await app.inject({
            method: 'POST',
            url: '/api/projects/p1/guardrail-scripts',
            payload: VALID_SCRIPT,
        });
        const res = await app.inject({
            method: 'POST',
            url: '/api/projects/p1/guardrail-scripts',
            payload: { ...VALID_SCRIPT, name: 'Duplicate' },
        });
        expect(res.statusCode).toBe(409);
    });
});

describe('PATCH /api/projects/:projectId/guardrail-scripts/:id', () => {
    it('updates a script name and returns 200', async () => {
        await app.inject({
            method: 'POST',
            url: '/api/projects/p1/guardrail-scripts',
            payload: VALID_SCRIPT,
        });
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/projects/p1/guardrail-scripts/${VALID_SCRIPT.id}`,
            payload: { name: 'Updated Name' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ name: 'Updated Name' });
    });

    it('returns 404 for missing script', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/projects/p1/guardrail-scripts/no-such-script',
            payload: { name: 'x' },
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('DELETE /api/projects/:projectId/guardrail-scripts/:id', () => {
    it('deletes a script and returns 204', async () => {
        await app.inject({
            method: 'POST',
            url: '/api/projects/p1/guardrail-scripts',
            payload: VALID_SCRIPT,
        });
        const res = await app.inject({
            method: 'DELETE',
            url: `/api/projects/p1/guardrail-scripts/${VALID_SCRIPT.id}`,
        });
        expect(res.statusCode).toBe(204);
    });

    it('returns 404 for missing script', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/projects/p1/guardrail-scripts/no-such-script',
        });
        expect(res.statusCode).toBe(404);
    });
});
