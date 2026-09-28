import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';
import { getItem, searchItems } from './items.js';
import { countsService } from './counts.js';
import { tasksService } from './tasks.js';
import { subTasksService } from './sub-tasks.js';
import { workflowQueueService } from './workflow-queue.js';
import { buildIssueTree } from './issue-tree.js';

// One assertion, every surface (migration 002 — the reverse of 016).
//
// A test run's item used to be real to the agent and invisible to the Owner.
// The Owner reversed that: "the test created EXI-2 and I can't see it" is a
// bug, not a feature. So a test item now shows up everywhere a real one does,
// carrying `is_test` so the web can tag it. The check stays in one file so a
// listing that starts filtering test items again fails here, next to the reason.

let app: FastifyInstance;

/** A real Task, plus a test Task and a test sub-task under its throwaway parent. */
async function seed(): Promise<{ real: string; testTask: string; testParent: string; testSub: string }> {
    const real = (await tasksService.create({ project_id: 'p1', title: 'Ship the stats endpoint', labels: ['be'] })).id;

    const testTask = (
        await tasksService.create({ project_id: 'p1', title: 'Scope a Task [test] po writer', labels: ['probe'], is_test: true })
    ).id;

    const testParent = (
        await tasksService.create({ project_id: 'p1', title: 'Parent [test] coder', is_test: true })
    ).id;
    const testSub = (
        await subTasksService.create({ task_id: testParent, title: 'Build it [test] coder', is_test: true })
    ).id;

    // `ready` so it would otherwise reach the queue and the queue badge.
    await testDb.updateTable('items').set({ status: 'ready' }).where('id', 'in', [real, testTask]).execute();
    return { real, testTask, testParent, testSub };
}

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

describe('a test run’s item', () => {
    it('is in the Task list and the sub-task lists, tagged is_test', async () => {
        const { real, testTask, testParent, testSub } = await seed();
        const tasks = await tasksService.list('p1');
        expect(tasks.map((t) => t.id).sort()).toEqual([real, testTask, testParent].sort());
        expect(tasks.find((t) => t.id === real)?.is_test).toBe(false);
        expect(tasks.find((t) => t.id === testTask)?.is_test).toBe(true);
        const subs = await subTasksService.list(testParent);
        expect(subs.map((s) => [s.id, s.is_test])).toEqual([[testSub, true]]);
        expect((await subTasksService.listAll()).map((s) => s.id)).toContain(testSub);
    });

    it('is in search', async () => {
        await seed();
        const hits = await searchItems({ q: 'test' });
        expect(hits.length).toBeGreaterThan(0);
        expect((await searchItems({})).length).toBe(4);
    });

    it('is in every count', async () => {
        await seed();
        expect((await countsService.getSidenavCounts()).tasks).toBe(3);
        expect((await countsService.getDashboardKpis()).tasks).toBe(3);
        // The Tasks page header and the list beside it must agree.
        expect(await tasksService.count()).toBe(3);
        expect((await countsService.getProjectCounts('p1')).open_tasks).toBe(3);
    });

    it('is in the queue', async () => {
        const { real, testTask } = await seed();
        const queue = (await workflowQueueService.get('p1')).unassigned.map((t) => t.id);
        expect(queue).toEqual(expect.arrayContaining([real, testTask]));
    });

    it('is in the label facets', async () => {
        await seed();
        const res = await app.inject({ method: 'GET', url: '/api/labels' });
        expect(JSON.parse(res.body).labels).toEqual(['be', 'probe']);
    });

    it('is in the issue tree', async () => {
        const { testTask } = await seed();
        const tree = await buildIssueTree({ projectId: 'p1' });
        expect(tree.tasks.map((t) => t.id)).toContain(testTask);
    });

    it('is fetchable by id', async () => {
        const { testTask, testSub } = await seed();
        expect((await getItem(testTask))?.title).toBe('Scope a Task [test] po writer');
        expect((await getItem(testSub))?.title).toBe('Build it [test] coder');
    });
});
