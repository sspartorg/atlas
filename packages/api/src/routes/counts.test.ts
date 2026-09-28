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
            type: 'task',
            project_id: 'p1',
            title: 'Task',
            status: 'ready',
        });

        const res = await app.inject({ method: 'GET', url: '/api/counts' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.tasks).toBe(1);
        expect(body.sub_tasks).toBe(0);
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

// The agent page's "Queue: N items". Counted here so the page no longer
// downloads every Task and sub-task in the workspace to count them.
describe('GET /api/counts/queue-by-agent', () => {
    it('counts ready and in-progress Tasks and sub-tasks per assignee, and nothing else', async () => {
        await insertProject('p1', 'ATL');
        await insertAgent({ id: 'agent-coder' });
        await insertAgent({ id: 'agent-writer' });
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'a', status: 'ready', assignee_agent_id: 'agent-coder' });
        await insertItem({ id: 'ATL-2', type: 'sub_task', project_id: 'p1', parent_id: 'ATL-1', title: 'b', status: 'in_progress', assignee_agent_id: 'agent-coder' });
        await insertItem({ id: 'ATL-3', type: 'task', project_id: 'p1', title: 'c', status: 'in_review', assignee_agent_id: 'agent-coder' });
        await insertItem({ id: 'ATL-4', type: 'task', project_id: 'p1', title: 'd', status: 'ready', assignee_agent_id: 'agent-writer' });
        await insertItem({ id: 'ATL-5', type: 'task', project_id: 'p1', title: 'e', status: 'ready' });

        const res = await app.inject({ method: 'GET', url: '/api/counts/queue-by-agent' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ 'agent-coder': 2, 'agent-writer': 1 });
    });
});
