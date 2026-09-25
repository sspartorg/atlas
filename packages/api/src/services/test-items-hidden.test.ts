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

// One assertion, every surface (migration 016).
//
// A test run's item is real to the agent and invisible to the Owner. The list
// of places it must not appear is long and gets longer, so the check lives in
// one file rather than as a line buried in each service's own suite: a new
// listing that forgets `items_live` fails here, next to the reason why.

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
    it('is absent from the Task list and the sub-task lists', async () => {
        const { real, testTask, testParent, testSub } = await seed();
        expect((await tasksService.list()).map((t) => t.id)).toEqual([real]);
        expect((await tasksService.list('p1')).map((t) => t.id)).toEqual([real]);
        expect(await subTasksService.list(testParent)).toEqual([]);
        expect((await subTasksService.listAll()).map((s) => s.id)).not.toContain(testSub);
        expect([testTask, testParent]).not.toContain(real);
    });

    it('is absent from search', async () => {
        await seed();
        const hits = await searchItems({ q: 'test' });
        expect(hits.map((h) => h.title)).toEqual([]);
        const all = await searchItems({});
        expect(all.map((h) => h.title)).toEqual(['Ship the stats endpoint']);
    });

    it('is absent from every count', async () => {
        await seed();
        const sidenav = await countsService.getSidenavCounts();
        expect(sidenav.tasks).toBe(1);
        expect(sidenav.sub_tasks).toBe(0);

        const kpis = await countsService.getDashboardKpis();
        expect(kpis.tasks).toBe(1);

        // The Tasks page header reads this, and it is a different query from
        // the list right beside it — which is exactly how "44 tasks" sat above
        // a list of 43 until a browser showed the two disagreeing.
        expect(await tasksService.count()).toBe(1);
        expect(await tasksService.awaitingPickupCount()).toBe(1);

        const project = await countsService.getProjectCounts('p1');
        expect(project.open_tasks).toBe(1);
        expect(project.tasks_ready).toBe(1);
    });

    it('is absent from the queue', async () => {
        const { real } = await seed();
        const queue = await workflowQueueService.get('p1');
        expect(queue.unassigned.map((t) => t.id)).toEqual([real]);
    });

    it('is absent from the label facets', async () => {
        await seed();
        const res = await app.inject({ method: 'GET', url: '/api/labels' });
        expect(JSON.parse(res.body).labels).toEqual(['be']);
    });

    it('is absent from the issue tree', async () => {
        const { real } = await seed();
        const tree = await buildIssueTree({ projectId: 'p1' });
        expect(tree.tasks.map((t) => t.id)).toEqual([real]);
    });

    it('is absent from the project analytics rollup', async () => {
        await seed();
        const res = await app.inject({ method: 'GET', url: '/api/analytics/project/p1' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        const items = (body.byKind as Array<{ item_count: number }>).reduce((n, k) => n + k.item_count, 0);
        expect(items).toBe(1);
        expect(body.task_count).toBe(1);
        expect((body.topTasks as Array<{ id: string; title: string }>).map((r) => r.title)).toEqual([
            'Ship the stats endpoint',
        ]);
    });

    // Everything above is why the flag exists. This is why it is a flag and not
    // a delete: the run, the prompt builder and the workflow engine all fetch
    // the item they are working on by id, and a test whose own item had
    // vanished from under it would be a worse bug than the one this fixes.
    it('is still fetchable by id', async () => {
        const { testTask, testSub } = await seed();
        expect((await getItem(testTask))?.title).toBe('Scope a Task [test] po writer');
        expect((await getItem(testSub))?.title).toBe('Build it [test] coder');
    });
});
