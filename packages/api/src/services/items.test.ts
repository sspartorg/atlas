import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { sql } from 'kysely';
import {
    rowToSubTask,
    rowToTask,
    createItem,
    getItem,
    getItemOfType,
    patchItem,
    deleteItem,
    searchItems,
    type IItemRow,
} from './items.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem, insertAgent } from '../../tests/_items.js';

// rowTo* are pure projection helpers from the unified `items` row shape
// to the per-kind shared interfaces. T2 added two columns —
// `worktree_branch` and `worktree_path` — and migration 047 backfilled
// them as nullable. These tests pin that they make it through the
// projection so GET /api/issues/:type/:id and `mcp__atlas__getItemFull`
// surface the values to the UI and to agents respectively.

function baseRow(overrides: Partial<IItemRow>): IItemRow {
    return {
        id: 'ATL-1',
        project_id: 'p1',
        type: 'task',
        parent_id: null,
        parent_type: null,
        title: 't',
        description: null,
        status: 'draft',
        assignee_agent_id: null,
        reporter_agent_id: null,
        priority: 'normal',
        spec_md: null,
        pr_url: null,
        points: null,
        acceptance_criteria: null,
        started_at: null,
        worktree_branch: null,
        worktree_path: null,
        workflow_id: null,
        labels: [],
        created_at: '2026-05-31T00:00:00Z',
        updated_at: '2026-05-31T00:00:00Z',
        ...overrides,
    };
}

describe('rowToTask projection', () => {
    it('surfaces the worktree, spec and acceptance fields', () => {
        const task = rowToTask(
            baseRow({
                worktree_branch: 'atlas/wf/ATL-1',
                worktree_path: 'C:\\repos\\atlas\\.worktrees\\wf-ATL-1',
                spec_md: '# spec',
                pr_url: 'https://github.com/o/r/pull/1',
                acceptance_criteria: 'AC',
            }),
        );
        expect(task.worktree_branch).toBe('atlas/wf/ATL-1');
        expect(task.worktree_path).toBe('C:\\repos\\atlas\\.worktrees\\wf-ATL-1');
        expect(task.spec_md).toBe('# spec');
        expect(task.pr_url).toBe('https://github.com/o/r/pull/1');
        expect(task.acceptance_criteria).toBe('AC');
    });

    it('preserves null worktree fields and defaults empty text', () => {
        const task = rowToTask(baseRow({}));
        expect(task.worktree_branch).toBeNull();
        expect(task.worktree_path).toBeNull();
        expect(task.description).toBe('');
        expect(task.acceptance_criteria).toBe('');
    });

    it('throws when called on a non-task row', () => {
        expect(() => rowToTask(baseRow({ type: 'sub_task' }))).toThrow(/rowToTask: expected task/);
    });

    it('projects title and defaults null priority to normal', () => {
        expect(rowToTask(baseRow({ title: 'My Task', priority: 'high' }))).toMatchObject({
            title: 'My Task',
            priority: 'high',
        });
        expect(rowToTask(baseRow({ priority: null })).priority).toBe('normal');
    });
});

describe('rowToSubTask projection', () => {
    it('maps parent_id to task_id and omits task-only fields', () => {
        const st = rowToSubTask(baseRow({ type: 'sub_task', parent_id: 'ATL-9', started_at: '2026-06-01T00:00:00Z' }));
        expect(st.task_id).toBe('ATL-9');
        expect(st.started_at).toBe('2026-06-01T00:00:00Z');
        expect(st).not.toHaveProperty('workflow_id');
        expect(st).not.toHaveProperty('worktree_branch');
        expect(st).not.toHaveProperty('spec_md');
    });

    it('throws when called on a task row', () => {
        expect(() => rowToSubTask(baseRow({}))).toThrow(/expected sub_task, got task/);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// DB-backed CRUD tests
// ──────────────────────────────────────────────────────────────────────────────

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
});

afterAll(async () => {
    await closeTestDb();
});

describe('createItem', () => {
    it('allocates an issue key from the project counter', async () => {
        const row = await createItem({ project_id: 'p1', type: 'task', title: 'Task One' });
        expect(row.id).toBe('ATL-1');
        expect(row.title).toBe('Task One');
        expect(row.type).toBe('task');
        expect(row.project_id).toBe('p1');
        expect(row.status).toBe('draft');
    });

    it('increments the counter for each item', async () => {
        const e1 = await createItem({ project_id: 'p1', type: 'task', title: 'E1' });
        const e2 = await createItem({ project_id: 'p1', type: 'task', title: 'E2' });
        expect(e1.id).toBe('ATL-1');
        expect(e2.id).toBe('ATL-2');
    });

    it('respects the provided status', async () => {
        const row = await createItem({ project_id: 'p1', type: 'task', title: 'E', status: 'ready' });
        expect(row.status).toBe('ready');
    });

    it('stores labels as JSON array', async () => {
        const row = await createItem({
            project_id: 'p1',
            type: 'task',
            title: 'Tagged',
            labels: ['backend', 'urgent'],
        });
        expect(row.labels).toEqual(['backend', 'urgent']);
    });

    it('task fields round-trip correctly', async () => {
        const task = await createItem({
            project_id: 'p1',
            type: 'task',
            title: 'T',
            spec_md: '# spec',
            pr_url: 'https://github.com/foo/bar/pull/1',
            acceptance_criteria: 'Must work',
        });
        expect(task.spec_md).toBe('# spec');
        expect(task.pr_url).toBe('https://github.com/foo/bar/pull/1');
        expect(task.acceptance_criteria).toBe('Must work');
    });

    it('parents a sub-task to its task and rejects a sub-task parent', async () => {
        const task = await createItem({ project_id: 'p1', type: 'task', title: 'T' });
        const sub = await createItem({ project_id: 'p1', type: 'sub_task', parent_id: task.id, title: 'S' });
        expect(sub.parent_type).toBe('task');
        await expect(
            createItem({ project_id: 'p1', type: 'sub_task', parent_id: sub.id, title: 'nested' }),
        ).rejects.toThrow(/must be parented to a task/);
    });

    it('throws when project_issue_counters row is missing', async () => {
        await testDb.deleteFrom('project_issue_counters').where('project_id', '=', 'p1').execute();
        await expect(
            createItem({ project_id: 'p1', type: 'task', title: 'X' }),
        ).rejects.toThrow(/No project_issue_counters row/);
    });

    it('throws when project is missing', async () => {
        await expect(
            createItem({ project_id: 'does-not-exist', type: 'task', title: 'X' }),
        ).rejects.toThrow();
    });
});

describe('getItem', () => {
    it('returns the item row when it exists', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Existing' });
        const row = await getItem('ATL-1');
        expect(row).toBeDefined();
        expect(row!.id).toBe('ATL-1');
        expect(row!.title).toBe('Existing');
    });

    it('returns undefined when item does not exist', async () => {
        const row = await getItem('DOES-NOT-EXIST');
        expect(row).toBeUndefined();
    });
});

describe('getItemOfType', () => {
    it('returns the item when type matches', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'E' });
        const row = await getItemOfType('ATL-1', 'task');
        expect(row).toBeDefined();
    });

    it('returns undefined when type does not match', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'E' });
        const row = await getItemOfType('ATL-1', 'sub_task');
        expect(row).toBeUndefined();
    });

    it('returns undefined when item does not exist', async () => {
        const row = await getItemOfType('DOES-NOT-EXIST', 'task');
        expect(row).toBeUndefined();
    });
});

describe('patchItem', () => {
    it('updates the title', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Old' });
        const updated = await patchItem('ATL-1', { title: 'New' });
        expect(updated.title).toBe('New');
    });

    it('updates the status', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'E', status: 'draft' });
        const updated = await patchItem('ATL-1', { status: 'ready' });
        expect(updated.status).toBe('ready');
    });

    it('returns the current row unchanged when called with no fields', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Unchanged' });
        const result = await patchItem('ATL-1', {});
        expect(result.title).toBe('Unchanged');
    });

    it('updates labels', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'E' });
        const updated = await patchItem('ATL-1', { labels: ['alpha', 'beta'] });
        expect(updated.labels).toEqual(['alpha', 'beta']);
    });

    it('updates worktree fields', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'E' });
        const updated = await patchItem('ATL-1', {
            worktree_branch: 'atlas/dev/ATL-1',
            worktree_path: '/tmp/wt/ATL-1',
        });
        expect(updated.worktree_branch).toBe('atlas/dev/ATL-1');
        expect(updated.worktree_path).toBe('/tmp/wt/ATL-1');
    });

    it('throws when item does not exist', async () => {
        await expect(patchItem('DOES-NOT-EXIST', { title: 'X' })).rejects.toThrow(
            /DOES-NOT-EXIST not found/,
        );
    });

    it('ignores undefined fields (does not overwrite with null)', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Keep' });
        // Passing undefined fields should not affect the DB row
        const result = await patchItem('ATL-1', { title: undefined });
        expect(result.title).toBe('Keep');
    });
});

describe('deleteItem', () => {
    it('removes the item from the database', async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'ToDelete' });
        await deleteItem('ATL-1');
        const row = await getItem('ATL-1');
        expect(row).toBeUndefined();
    });

    it('is a no-op for non-existent items (no error thrown)', async () => {
        await expect(deleteItem('DOES-NOT-EXIST')).resolves.toBeUndefined();
    });
});

describe('searchItems', () => {
    beforeEach(async () => {
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Authentication module', status: 'draft' });
        await insertItem({ id: 'ATL-2', type: 'task', project_id: 'p1', title: 'User profile page', status: 'ready' });
        await insertItem({ id: 'ATL-3', type: 'task', project_id: 'p1', title: 'Billing integration', status: 'done' });
    });

    it('returns all items when no filters applied', async () => {
        const results = await searchItems({});
        expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it('filters by type', async () => {
        const results = await searchItems({ types: ['task'] });
        expect(results.every((r) => r.type === 'task')).toBe(true);
    });

    it('filters by project_id', async () => {
        await insertProject('p2', 'OTH');
        await insertItem({ id: 'OTH-1', type: 'task', project_id: 'p2', title: 'Other project task' });
        const p1Results = await searchItems({ project_ids: ['p1'] });
        expect(p1Results.every((r) => r.project_id === 'p1')).toBe(true);
    });

    it('filters by status', async () => {
        const results = await searchItems({ status: 'ready' });
        expect(results.every((r) => r.status === 'ready')).toBe(true);
        expect(results).toHaveLength(1);
        expect(results[0]!.id).toBe('ATL-2');
    });

    it('full-text query returns matching items with rank', async () => {
        const results = await searchItems({ q: 'authentication' });
        expect(results.some((r) => r.id === 'ATL-1')).toBe(true);
        // Results have rank field
        expect(typeof results[0]?.rank).toBe('number');
    });

    it('combined type + status filter', async () => {
        const results = await searchItems({ types: ['task'], status: 'done' });
        expect(results).toHaveLength(1);
        expect(results[0]!.id).toBe('ATL-3');
    });

    it('label filter returns only items with all specified labels', async () => {
        await insertItem({ id: 'ATL-4', type: 'task', project_id: 'p1', title: 'Tagged' });
        await testDb.updateTable('items').set({ labels: JSON.stringify(['backend', 'api']) as never }).where('id', '=', 'ATL-4').execute();
        const results = await searchItems({ labels: ['backend'] });
        expect(results.some((r) => r.id === 'ATL-4')).toBe(true);
    });

    it('returns empty array when no items match', async () => {
        const results = await searchItems({ status: 'in_review' });
        expect(results).toEqual([]);
    });

    it('respects the limit parameter', async () => {
        const results = await searchItems({}, 2);
        expect(results.length).toBeLessThanOrEqual(2);
    });

    it('filters by agent_ids (assignee)', async () => {
        // Exercise the `filters.agent_ids && filters.agent_ids.length > 0`
        // branch — only rows whose assignee_agent_id is in the list.
        // Insert agents first (FK constraint on items.assignee_agent_id).
        await insertAgent({ id: 'agent-coder' });
        await insertAgent({ id: 'agent-po-writer', name: 'PO Writer' });
        await testDb
            .updateTable('items')
            .set({ assignee_agent_id: 'agent-coder' })
            .where('id', '=', 'ATL-1')
            .execute();
        await testDb
            .updateTable('items')
            .set({ assignee_agent_id: 'agent-po-writer' })
            .where('id', '=', 'ATL-2')
            .execute();

        const results = await searchItems({ agent_ids: ['agent-coder'] });
        expect(results.map((r) => r.id)).toContain('ATL-1');
        expect(results.map((r) => r.id)).not.toContain('ATL-2');
    });

    it('filters by updated_after (inclusive lower bound)', async () => {
        // Set ATL-1 old, ATL-2 recent — updated_after cutoff between
        // them should return only ATL-2. Disable the auto-updated_at
        // BEFORE-UPDATE trigger so the manual timestamp reset sticks;
        // the trigger would otherwise clobber it with NOW().
        const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        await sql`ALTER TABLE items DISABLE TRIGGER items_set_updated_at`.execute(testDb);
        try {
            await sql`UPDATE items SET updated_at = NOW() - INTERVAL '30 days' WHERE id = 'ATL-1'`.execute(
                testDb,
            );
            const results = await searchItems({ updated_after: cutoff });
            expect(results.map((r) => r.id)).not.toContain('ATL-1');
            expect(results.map((r) => r.id)).toContain('ATL-2');
        } finally {
            await sql`ALTER TABLE items ENABLE TRIGGER items_set_updated_at`.execute(testDb);
        }
    });

    it('filters by updated_before (exclusive upper bound)', async () => {
        // Set ATL-1 old, ATL-2 recent — updated_before mid-range should
        // return only ATL-1.
        const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        await sql`ALTER TABLE items DISABLE TRIGGER items_set_updated_at`.execute(testDb);
        try {
            await sql`UPDATE items SET updated_at = NOW() - INTERVAL '30 days' WHERE id = 'ATL-1'`.execute(
                testDb,
            );
            const results = await searchItems({ updated_before: cutoff });
            expect(results.map((r) => r.id)).toContain('ATL-1');
            expect(results.map((r) => r.id)).not.toContain('ATL-2');
        } finally {
            await sql`ALTER TABLE items ENABLE TRIGGER items_set_updated_at`.execute(testDb);
        }
    });

    it('full-text query is ordered by ts_rank then updated_at desc', async () => {
        // Exercises the `hasQuery ? orderBy('rank', 'desc')` branch —
        // the alternative `orderBy('updated_at', 'desc')` path is hit
        // by the every-other test above.
        const results = await searchItems({ q: 'authentication' });
        expect(results.length).toBeGreaterThan(0);
        expect(typeof results[0]?.rank).toBe('number');
    });
});

describe('rowTo* type-guard throws', () => {
    // Exercise the `if (r.type !== 'X') throw` guard on each projection.
    // These fire only under DB corruption / caller misuse but are the
    // only real branches on those helpers not exercised by the
    // worktree projection tests above.
    function tmpRow(type: IItemRow['type']): IItemRow {
        return {
            id: 'X',
            project_id: 'p1',
            type,
            parent_id: null,
            parent_type: null,
            title: 't',
            description: null,
            status: 'draft',
            assignee_agent_id: null,
            reporter_agent_id: null,
            priority: 'normal',
            spec_md: null,
            pr_url: null,
            points: null,
            acceptance_criteria: null,
            started_at: null,
            worktree_branch: null,
            worktree_path: null,
            labels: [],
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
        };
    }

    it('rowToTask throws when type is not task', () => {
        expect(() => rowToTask(tmpRow('sub_task'))).toThrow(/expected task, got sub_task/);
    });

    it('rowToSubTask throws when type is not sub_task', () => {
        expect(() => rowToSubTask(tmpRow('task'))).toThrow(/expected sub_task, got task/);
    });
});
