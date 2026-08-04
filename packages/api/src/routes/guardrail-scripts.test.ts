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

let app: FastifyInstance;

beforeEach(async () => {
    await truncateAll();
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

// CreateGuardrailScriptSchema:
//   id: kebab-case slug (min1, max80, /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
//   name: string min1 max120
//   description: string max500 (default '')
//   body_sh: string min1 max20000
//   body_ps1: string min1 max20000
//   sort_order: int (default 0)
// UpdateGuardrailScriptSchema: partial (omits id); if either body is patched, both must be patched
const VALID_SCRIPT = {
    id: 'no-network-calls',
    name: 'No Network Calls',
    description: 'Prevent agents from making network calls',
    body_sh: '#!/bin/bash\necho "no network" >&2\nexit 1',
    body_ps1: 'Write-Error "no network"\nexit 1',
};

describe('GET /api/guardrail-scripts', () => {
    it('returns 200 with empty array when no scripts exist', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/guardrail-scripts' });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns 200 with created scripts', async () => {
        await app.inject({ method: 'POST', url: '/api/guardrail-scripts', payload: VALID_SCRIPT });
        const res = await app.inject({ method: 'GET', url: '/api/guardrail-scripts' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.length).toBe(1);
        expect(body[0]).toMatchObject({ id: VALID_SCRIPT.id, name: VALID_SCRIPT.name });
    });
});

describe('POST /api/guardrail-scripts', () => {
    it('creates a script and returns 201', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/guardrail-scripts',
            payload: VALID_SCRIPT,
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ id: VALID_SCRIPT.id, name: VALID_SCRIPT.name });
    });

    it('returns 400 for missing body_sh', async () => {
        const { body_sh: _, ...noSh } = VALID_SCRIPT;
        const res = await app.inject({
            method: 'POST',
            url: '/api/guardrail-scripts',
            payload: noSh,
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid slug (uppercase)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/guardrail-scripts',
            payload: { ...VALID_SCRIPT, id: 'Invalid-Slug' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 409 for duplicate script id', async () => {
        // Create the first one
        await app.inject({ method: 'POST', url: '/api/guardrail-scripts', payload: VALID_SCRIPT });
        // Try to create with the same id
        const res = await app.inject({
            method: 'POST',
            url: '/api/guardrail-scripts',
            payload: { ...VALID_SCRIPT, name: 'Duplicate Attempt' },
        });
        expect(res.statusCode).toBe(409);
    });
});

describe('PATCH /api/guardrail-scripts/:id', () => {
    it('updates a script name and returns 200', async () => {
        await app.inject({ method: 'POST', url: '/api/guardrail-scripts', payload: VALID_SCRIPT });
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/guardrail-scripts/${VALID_SCRIPT.id}`,
            payload: { name: 'Updated Name' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ name: 'Updated Name' });
    });

    it('returns 400 when patching only body_sh (both bodies must be updated together)', async () => {
        await app.inject({ method: 'POST', url: '/api/guardrail-scripts', payload: VALID_SCRIPT });
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/guardrail-scripts/${VALID_SCRIPT.id}`,
            payload: { body_sh: '#!/bin/bash\necho ok' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 404 for missing script', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/guardrail-scripts/does-not-exist',
            payload: { name: 'x' },
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('DELETE /api/guardrail-scripts/:id', () => {
    it('deletes a script and returns 204', async () => {
        await app.inject({ method: 'POST', url: '/api/guardrail-scripts', payload: VALID_SCRIPT });
        const res = await app.inject({
            method: 'DELETE',
            url: `/api/guardrail-scripts/${VALID_SCRIPT.id}`,
        });
        expect(res.statusCode).toBe(204);
    });
});
