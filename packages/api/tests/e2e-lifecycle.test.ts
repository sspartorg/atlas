import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../src/services/notifications.js', () => ({
    notificationsService: {
        create: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        markAllRead: vi.fn(),
        markRead: vi.fn(),
        updateExternalStatus: vi.fn(),
    },
}));
vi.mock('../src/routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op route registration; SSE not under test */
    },
    broadcastSSE: vi.fn(),
}));

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { testDb, truncateAll, closeTestDb } from './_pg-db.js';
import { seedFullTree } from './_items.js';

let app: FastifyInstance;

async function countItems(typeOrParent: { type?: string; parent_id?: string; id?: string }): Promise<number> {
    let q = testDb.selectFrom('items').select(({ fn }) => fn.countAll<string>().as('n'));
    if (typeOrParent.id) q = q.where('id', '=', typeOrParent.id);
    if (typeOrParent.type) q = q.where('type', '=', typeOrParent.type as 'epic');
    if (typeOrParent.parent_id) q = q.where('parent_id', '=', typeOrParent.parent_id);
    const row = await q.executeTakeFirstOrThrow();
    return Number(row.n);
}

beforeEach(async () => {
    await truncateAll();
    await seedFullTree();
    // Cross-cutting rows that exercise the cleanup triggers.
    await testDb
        .insertInto('comments')
        .values({ author: 'agent', agent_id: 'agent-coder', item_id: 'ATL-1', body: 'looks good' })
        .execute();
    await testDb
        .insertInto('item_links')
        .values({ from_id: 'ATL-2', to_id: 'ATL-3', relation_type: 'relates_to' })
        .execute();

    app = await buildApp({ logger: false });
    await app.ready();
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('E2E lifecycle — epic', () => {
    it('full epic cascade: assign → transitions → DELETE wipes story + sub-tree + bugs + logs', async () => {
        expect(await countItems({ id: 'ATL-1' })).toBe(1);
        expect(await countItems({ parent_id: 'ATL-1', type: 'story' })).toBe(1);
        expect(await countItems({ parent_id: 'ATL-2', type: 'sub_task' })).toBe(1);
        expect(await countItems({ parent_id: 'ATL-2', type: 'sub_bug' })).toBe(1);
        expect(await countItems({ parent_id: 'ATL-1', type: 'bug' })).toBe(1);

        const assignRes = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1/assign',
            payload: { assignee_agent_id: 'agent-coder' },
        });
        expect(assignRes.statusCode).toBe(200);

        const draftToReady = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1/status',
            payload: { status: 'ready' },
        });
        expect(draftToReady.statusCode).toBe(200);

        const readyToInProgress = await app.inject({
            method: 'PATCH',
            url: '/api/epics/ATL-1/status',
            payload: { status: 'in_progress' },
        });
        expect(readyToInProgress.statusCode).toBe(200);

        const deleteRes = await app.inject({ method: 'DELETE', url: '/api/epics/ATL-1' });
        expect(deleteRes.statusCode).toBe(204);

        // Cascade verification — every dependent row is gone.
        expect(await countItems({ id: 'ATL-1' })).toBe(0);
        expect(await countItems({ parent_id: 'ATL-1' })).toBe(0);
        expect(await countItems({ parent_id: 'ATL-2' })).toBe(0);
        // Comments + item_links cascade via the items FK ON DELETE CASCADE.
        const commentCount = await testDb
            .selectFrom('comments')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('item_id', '=', 'ATL-1')
            .executeTakeFirstOrThrow();
        expect(Number(commentCount.n)).toBe(0);
        const linkCount = await testDb
            .selectFrom('item_links')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where((eb) => eb.or([eb('from_id', '=', 'ATL-2'), eb('to_id', '=', 'ATL-3')]))
            .executeTakeFirstOrThrow();
        expect(Number(linkCount.n)).toBe(0);
    });
});

describe('E2E lifecycle — story', () => {
    it('story DELETE cascades to its sub-tasks and sub-bugs', async () => {
        expect(await countItems({ parent_id: 'ATL-2', type: 'sub_task' })).toBe(1);
        expect(await countItems({ parent_id: 'ATL-2', type: 'sub_bug' })).toBe(1);

        const res = await app.inject({ method: 'DELETE', url: '/api/stories/ATL-2' });
        expect(res.statusCode).toBe(204);

        expect(await countItems({ id: 'ATL-2' })).toBe(0);
        expect(await countItems({ parent_id: 'ATL-2' })).toBe(0);
        // Parent epic and sibling bug survive.
        expect(await countItems({ id: 'ATL-1' })).toBe(1);
        expect(await countItems({ id: 'ATL-5' })).toBe(1);
    });
});

describe('E2E lifecycle — sub-task', () => {
    it('sub-task DELETE removes just the row', async () => {
        const res = await app.inject({ method: 'DELETE', url: '/api/sub-tasks/ATL-3' });
        expect(res.statusCode).toBe(204);
        expect(await countItems({ id: 'ATL-3' })).toBe(0);
        expect(await countItems({ id: 'ATL-4' })).toBe(1);
        expect(await countItems({ id: 'ATL-2' })).toBe(1);
    });
});

describe('E2E lifecycle — sub-bug', () => {
    it('sub-bug DELETE removes just the row', async () => {
        const res = await app.inject({ method: 'DELETE', url: '/api/sub-bugs/ATL-4' });
        expect(res.statusCode).toBe(204);
        expect(await countItems({ id: 'ATL-4' })).toBe(0);
        expect(await countItems({ id: 'ATL-3' })).toBe(1);
        expect(await countItems({ id: 'ATL-2' })).toBe(1);
    });
});

describe('E2E lifecycle — bug', () => {
    it('bug DELETE removes just the row; parent epic survives', async () => {
        const res = await app.inject({ method: 'DELETE', url: '/api/bugs/ATL-5' });
        expect(res.statusCode).toBe(204);
        expect(await countItems({ id: 'ATL-5' })).toBe(0);
        expect(await countItems({ id: 'ATL-1' })).toBe(1);
        expect(await countItems({ id: 'ATL-2' })).toBe(1);
    });
});
