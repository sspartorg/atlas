import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem } from '../../tests/_items.js';

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

describe('GET /api/labels', () => {
    it('returns 200 with empty labels array when no items', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/labels' });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ labels: [] });
    });

    it('returns labels from seeded items', async () => {
        // Insert an item with labels via direct DB (items table stores labels as jsonb)
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Epic One' });
        // Update labels directly since insertItem doesn't support labels param
        await testDb
            .updateTable('items')
            .set({ labels: JSON.stringify(['frontend', 'backend', 'api']) })
            .where('id', '=', 'ATL-1')
            .execute();

        const res = await app.inject({ method: 'GET', url: '/api/labels' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.labels).toContain('frontend');
        expect(body.labels).toContain('backend');
        expect(body.labels).toContain('api');
        // Labels are sorted alphabetically
        const sorted = [...body.labels].sort();
        expect(body.labels).toEqual(sorted);
    });

    it('returns labels filtered by project_id', async () => {
        await insertProject('p2', 'ALT');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'P1 Epic' });
        await insertItem({ id: 'ALT-1', type: 'epic', project_id: 'p2', title: 'P2 Epic' });
        await testDb
            .updateTable('items')
            .set({ labels: JSON.stringify(['p1-only']) })
            .where('id', '=', 'ATL-1')
            .execute();
        await testDb
            .updateTable('items')
            .set({ labels: JSON.stringify(['p2-only']) })
            .where('id', '=', 'ALT-1')
            .execute();

        const res = await app.inject({ method: 'GET', url: '/api/labels?project_id=p1' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.labels).toContain('p1-only');
        expect(body.labels).not.toContain('p2-only');
    });
});
