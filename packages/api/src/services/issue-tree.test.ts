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

    it('builds nested tree from full graph: story → sub_task + sub_bug, plus bug', async () => {
        await seedFullTree();
        const r = await buildIssueTree();
        expect(r.projects).toHaveLength(1);
        expect(r.agents).toHaveLength(1);
        expect(r.tree).toHaveLength(2);
        const story = r.tree.find((n) => n.kind === 'story')!;
        const bug = r.tree.find((n) => n.kind === 'bug')!;
        expect(story.children).toHaveLength(2);
        expect(story.children.map((c) => c.kind).sort()).toEqual(['sub_bug', 'sub_task']);
        expect(bug.children).toHaveLength(0);
        expect(story.project_name).toBe('Project p1');
        expect(story.epic_id).toBe('ATL-1');
    });

    it('scopes to one project when projectId provided', async () => {
        await seedFullTree();
        await insertProject('p2', 'BBB');
        await insertItem({ id: 'BBB-1', type: 'epic', project_id: 'p2', title: 'Other epic' });
        await insertItem({
            id: 'BBB-2',
            type: 'story',
            project_id: 'p2',
            parent_id: 'BBB-1',
            parent_type: 'epic',
            title: 'Other story',
        });

        const all = await buildIssueTree();
        expect(all.tree.length).toBeGreaterThan(2);
        const p1Only = await buildIssueTree({ projectId: 'p1' });
        expect(p1Only.tree.find((n) => n.id === 'BBB-2')).toBeUndefined();
    });

    // A5 / 05-coverage-gap — exercise the `includeArchived: true` arm
    // (default is false). Without coverage of both arms the conditional
    // `if (!includeArchived)` branch stays half-tested.
    it('includes old done items when includeArchived = true', async () => {
        await insertProject('p1', 'ATL');
        await insertAgent();
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        // Plant an old `done` story (older than 7 days). Default
        // buildIssueTree filters it out; { includeArchived: true } restores it.
        await sql`
            ALTER TABLE items DISABLE TRIGGER items_set_updated_at;
            INSERT INTO items (id, type, project_id, parent_id, parent_type, title, status, priority, updated_at, created_at)
            VALUES ('old-done', 'story', 'p1', 'ATL-1', 'epic', 'old done', 'done', 'normal', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z');
            ALTER TABLE items ENABLE TRIGGER items_set_updated_at;
        `.execute(testDb);
        const filtered = await buildIssueTree();
        expect(filtered.tree.find((n) => n.id === 'old-done')).toBeUndefined();
        const archived = await buildIssueTree({ includeArchived: true });
        expect(archived.tree.find((n) => n.id === 'old-done')).toBeDefined();
    });

    // R1 coverage — the sub_bug loop's `childrenByStory.get(story.id) ?? []`
    // fallback only fires when a sub_bug is the FIRST child processed for a
    // story (i.e. no sub_task ran first to seed the map entry). seedFullTree
    // always inserts a sub_task before the sub_bug on the same story, so a
    // dedicated story with a sub_bug-only child is needed to hit it.
    it('sub_bug is the only child of its story (childrenByStory map miss)', async () => {
        await insertProject('p1', 'ATL');
        await insertAgent();
        const epicId = await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        const storyId = await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: epicId,
            parent_type: 'epic',
            title: 'Story with only a sub_bug',
        });
        await insertItem({
            id: 'ATL-3',
            type: 'sub_bug',
            project_id: 'p1',
            parent_id: storyId,
            parent_type: 'story',
            title: 'Lone sub-bug',
            acceptance_criteria: '',
            steps_to_reproduce: '',
            expected: '',
            actual: '',
            frequency: 'sometimes',
            failure_scope: 'cosmetic',
        });

        const r = await buildIssueTree();
        const story = r.tree.find((n) => n.id === storyId)!;
        expect(story.children).toHaveLength(1);
        expect(story.children[0]!.kind).toBe('sub_bug');
    });

    it('top level sorted by updated_at desc', async () => {
        await insertProject('p1', 'ATL');
        await insertAgent();
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        // Use raw SQL with the trigger disabled to plant deterministic
        // updated_at values for the sort assertion.
        await sql`
            ALTER TABLE items DISABLE TRIGGER items_set_updated_at;
            INSERT INTO items (id, type, project_id, parent_id, parent_type, title, status, priority, updated_at, created_at)
            VALUES
                ('s-old', 'story', 'p1', 'ATL-1', 'epic', 'old', 'draft', 'normal', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z'),
                ('s-new', 'story', 'p1', 'ATL-1', 'epic', 'new', 'draft', 'normal', '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z');
            ALTER TABLE items ENABLE TRIGGER items_set_updated_at;
        `.execute(testDb);
        const r = await buildIssueTree();
        expect(r.tree[0]!.id).toBe('s-new');
        expect(r.tree[1]!.id).toBe('s-old');
    });

});
