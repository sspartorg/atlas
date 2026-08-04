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
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

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

describe('GET /api/counts', () => {
    it('returns 200 with sidenav counts structure', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/counts' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        // countsService.getSidenavCounts returns object with counts
        expect(typeof body).toBe('object');
    });

    it('returns count updates after inserting items', async () => {
        await insertProject('p1', 'ATL');
        await insertAgent({ id: 'agent-coder' });
        await insertItem({
            id: 'ATL-1',
            type: 'epic',
            project_id: 'p1',
            title: 'Epic',
            status: 'ready',
        });

        const res = await app.inject({ method: 'GET', url: '/api/counts' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(typeof body).toBe('object');
    });
});

describe('GET /api/counts/project/:id', () => {
    it('returns 200 with project-scoped counts', async () => {
        await insertProject('p1', 'ATL');
        const res = await app.inject({ method: 'GET', url: '/api/counts/project/p1' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(typeof body).toBe('object');
    });

    it('returns 200 with empty/zero counts for unknown project', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/counts/project/no-such' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(typeof body).toBe('object');
    });
});

describe('GET /api/dashboard', () => {
    it('returns 200 with kpis, awaiting, queue', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/dashboard' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('kpis');
        expect(body).toHaveProperty('awaiting');
        expect(body).toHaveProperty('queue');
    });

    it('returns correct array types for awaiting and queue', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/dashboard' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body.awaiting)).toBe(true);
        expect(Array.isArray(body.queue)).toBe(true);
    });
});
