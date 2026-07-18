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

describe('GET /api/issues/tree', () => {
    it('returns 200 with empty tree on fresh DB', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/tree',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as {
            projects: unknown[];
            agents: unknown[];
            tree: unknown[];
            epics: unknown[];
            stories: unknown[];
            bugs: unknown[];
        };
        expect(Array.isArray(body.tree)).toBe(true);
        expect(Array.isArray(body.projects)).toBe(true);
        expect(Array.isArray(body.epics)).toBe(true);
        expect(Array.isArray(body.stories)).toBe(true);
        expect(Array.isArray(body.bugs)).toBe(true);
    });

    it('returns 200 filtered by project_id query param', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/tree?project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { tree: unknown[] };
        expect(Array.isArray(body.tree)).toBe(true);
    });

    it('returns 200 with include_archived=true', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/tree?include_archived=true',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { tree: unknown[] };
        expect(Array.isArray(body.tree)).toBe(true);
    });

    it('returns 200 for an unknown project_id (no items, not 404)', async () => {
        // The route does not validate project existence — it returns an empty tree.
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/tree?project_id=no-such-project',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { tree: unknown[] };
        expect(body.tree).toHaveLength(0);
    });

    it('returns 200 with include_archived=1 (line 13 — include_archived === "1" branch)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/tree?include_archived=1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { tree: unknown[] };
        expect(Array.isArray(body.tree)).toBe(true);
    });
});
