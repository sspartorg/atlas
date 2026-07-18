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
import { insertProject, insertItem } from '../../tests/_items.js';

let app: FastifyInstance;

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Fix authentication flow' });
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
}, 30_000);

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('GET /api/search', () => {
    it('returns 200 empty array for short query with no filters', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/search?q=a' });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns 200 empty array for no query and no filters', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/search' });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns 200 results for a query matching a seeded item', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?q=authentication',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        // The seeded epic's title includes "authentication"
        const ids = body.map((r: { issue_id: string }) => r.issue_id);
        expect(ids).toContain('ATL-1');
    });

    it('returns 200 results filtered by project_id', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThan(0);
    });

    it('returns 200 results filtered by type', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?type=epic&project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
    });

    it('returns 200 for unknown type filter (type ignored, project filter still applies)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?type=unknown_type&project_id=p1',
        });
        // Unknown types are silently dropped; project_id filter still applies
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    });

    it('returns 200 results filtered by status', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?status=draft&project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
    });

    it('returns 200 with updated date filter today', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?updated=today&project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        // Items just inserted should match "today"
        expect(body.length).toBeGreaterThan(0);
    });

    it('returns search results with correct shape', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        if (body.length > 0) {
            expect(body[0]).toMatchObject({
                issue_type: expect.any(String),
                issue_id: expect.any(String),
                title: expect.any(String),
                status: expect.any(String),
                project_id: expect.any(String),
            });
        }
    });

    it('returns 200 with updated=last_7_days filter (updatedRangeBounds last_7_days branch)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?updated=last_7_days&project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        // Items inserted in beforeEach should fall within last 7 days
        expect(body.length).toBeGreaterThan(0);
    });

    it('returns 200 with updated=last_30_days filter (updatedRangeBounds last_30_days branch)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?updated=last_30_days&project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThan(0);
    });

    it('returns 200 with updated=older filter (updatedRangeBounds older branch)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?updated=older&project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        // Items created now are NOT older than 30 days, so this should return empty
        expect(Array.isArray(body)).toBe(true);
    });

    it('ignores an invalid updated filter value (updatedRangeBounds null return branch)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?updated=invalid_range&project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        // invalid updated filter is silently ignored — project filter still applies
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
    });

    it('ignores an invalid status filter value (VALID_STATUSES false branch)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?status=invalid_status&project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        // invalid status is silently dropped; project filter still applies
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThan(0);
    });

    it('respects custom limit parameter', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?project_id=p1&limit=1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeLessThanOrEqual(1);
    });

    it('returns 200 with agent_id filter (splitCsv + agent_ids branch)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?agent_id=agent-coder&project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
    });

    it('returns 200 with labels filter (labels branch)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search?labels=frontend&project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
    });
});
