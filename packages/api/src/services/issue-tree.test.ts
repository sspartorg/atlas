import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'kysely';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { buildIssueTree } from './issue-tree.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { seedFullTree, insertProject, insertAgent, insertItem } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('buildIssueTree', () => {
    it('returns empty tree with no data', async () => {
        const r = await buildIssueTree();
        expect(r.tree).toEqual([]);
        expect(r.projects).toEqual([]);
        expect(r.agents).toEqual([]);
    });

    it('builds tasks as roots with their sub-tasks as children', async () => {
        await seedFullTree();
        const r = await buildIssueTree();
        expect(r.projects).toHaveLength(1);
        expect(r.agents).toHaveLength(1);
        expect(r.tasks.map((t) => t.id)).toEqual(['ATL-1']);
        expect(r.tree).toHaveLength(1);
        const task = r.tree[0]!;
        expect(task).toMatchObject({ id: 'ATL-1', kind: 'task', task_id: null, task_title: null, project_name: 'Project p1' });
        expect(task.children.map((c) => c.id).sort()).toEqual(['ATL-2', 'ATL-3']);
        expect(task.children[0]).toMatchObject({ kind: 'sub_task', task_id: 'ATL-1', task_title: 'Task One', children: [] });
    });

    it('scopes to one project when projectId provided', async () => {
        await seedFullTree();
        await insertProject('p2', 'BBB');
        await insertItem({ id: 'BBB-1', type: 'task', project_id: 'p2', title: 'Other task' });

        const all = await buildIssueTree();
        expect(all.tree.map((n) => n.id).sort()).toEqual(['ATL-1', 'BBB-1']);
        const p1Only = await buildIssueTree({ projectId: 'p1' });
        expect(p1Only.tree.map((n) => n.id)).toEqual(['ATL-1']);
        expect(p1Only.tasks.map((t) => t.id)).toEqual(['ATL-1']);
    });

    // Exercise the `includeArchived: true` arm (default is false). A
    // sub-task whose task is archived drops out of the tree with it.
    it('includes old done items when includeArchived = true', async () => {
        await insertProject('p1', 'ATL');
        await insertAgent();
        // Plant an old `done` task (older than 7 days) with a live sub-task.
        await sql`
            ALTER TABLE items DISABLE TRIGGER items_set_updated_at;
            INSERT INTO items (id, type, project_id, title, status, priority, updated_at, created_at)
            VALUES ('old-done', 'task', 'p1', 'old done', 'done', 'normal', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z');
            INSERT INTO items (id, type, project_id, parent_id, title, status, priority)
            VALUES ('old-sub', 'sub_task', 'p1', 'old-done', 'live sub', 'draft', 'normal');
            ALTER TABLE items ENABLE TRIGGER items_set_updated_at;
        `.execute(testDb);
        const filtered = await buildIssueTree();
        expect(filtered.tree).toEqual([]);
        const archived = await buildIssueTree({ includeArchived: true });
        const task = archived.tree.find((n) => n.id === 'old-done')!;
        expect(task.children.map((c) => c.id)).toEqual(['old-sub']);
    });

    it('top level sorted by updated_at desc', async () => {
        await insertProject('p1', 'ATL');
        await insertAgent();
        // Use raw SQL with the trigger disabled to plant deterministic
        // updated_at values for the sort assertion.
        await sql`
            ALTER TABLE items DISABLE TRIGGER items_set_updated_at;
            INSERT INTO items (id, type, project_id, title, status, priority, updated_at, created_at)
            VALUES
                ('t-old', 'task', 'p1', 'old', 'draft', 'normal', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z'),
                ('t-new', 'task', 'p1', 'new', 'draft', 'normal', '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z');
            ALTER TABLE items ENABLE TRIGGER items_set_updated_at;
        `.execute(testDb);
        const r = await buildIssueTree();
        expect(r.tree[0]!.id).toBe('t-new');
        expect(r.tree[1]!.id).toBe('t-old');
    });
});
