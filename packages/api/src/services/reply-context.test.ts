import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { assembleReplyContext } from './reply-context.js';
import { commentsService } from './comments.js';
import { itemLinks } from './item-links.js';
import {
    DEFAULT_LINKED_ITEM_RECENT_COMMENTS,
    DEFAULT_THREAD_HEAD_COMMENTS,
    DEFAULT_THREAD_TAIL_COMMENTS,
} from './context-budget.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertItem, insertProject, seedFullTree } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('assembleReplyContext', () => {
    it('returns null for a missing item', async () => {
        await seedFullTree();
        expect(await assembleReplyContext('story', 'nope-404')).toBeNull();
    });

    it('returns item core + project + empty thread for a fresh story', async () => {
        await seedFullTree();
        const ctx = (await assembleReplyContext('story', 'ATL-2'))!;
        expect(ctx).not.toBeNull();
        expect(ctx.item.kind).toBe('story');
        expect(ctx.item.id).toBe('ATL-2');
        expect(ctx.item.title).toBe('Story One');
        expect(ctx.project!.id).toBe('p1');
        expect(ctx.thread.comments).toHaveLength(0);
        expect(ctx.thread.total_count).toBe(0);
        expect(ctx.thread.elided_count).toBe(0);
        expect(ctx.linked_items).toHaveLength(0);
        expect(ctx.budget_cap).toBeGreaterThan(0);
        expect(ctx.token_estimate).toBeGreaterThanOrEqual(0);
    });

    it('returns the full thread when it fits under head + tail', async () => {
        await seedFullTree();
        const N = 5; // < HEAD + TAIL (3 + 12)
        for (let i = 0; i < N; i++) {
            await commentsService.create({
                author: 'owner',
                agent_id: null,
                issue_type: 'story',
                issue_id: 'ATL-2',
                body: `comment ${i + 1}`,
            });
        }
        const ctx = (await assembleReplyContext('story', 'ATL-2'))!;
        expect(ctx.thread.total_count).toBe(N);
        expect(ctx.thread.elided_count).toBe(0);
        expect(ctx.thread.comments).toHaveLength(N);
    });

    it('elides the middle when thread > head + tail', async () => {
        await seedFullTree();
        const total = DEFAULT_THREAD_HEAD_COMMENTS + DEFAULT_THREAD_TAIL_COMMENTS + 7;
        for (let i = 0; i < total; i++) {
            await commentsService.create({
                author: 'owner',
                agent_id: null,
                issue_type: 'story',
                issue_id: 'ATL-2',
                body: `c${i + 1}`,
            });
        }
        const ctx = (await assembleReplyContext('story', 'ATL-2'))!;
        expect(ctx.thread.total_count).toBe(total);
        expect(ctx.thread.elided_count).toBe(7);
        expect(ctx.thread.comments).toHaveLength(
            DEFAULT_THREAD_HEAD_COMMENTS + DEFAULT_THREAD_TAIL_COMMENTS,
        );
        // First HEAD = oldest 3 comments
        expect(ctx.thread.comments.slice(0, DEFAULT_THREAD_HEAD_COMMENTS).map((c) => c.body)).toEqual([
            'c1',
            'c2',
            'c3',
        ]);
        // Last TAIL = newest 12 comments
        expect(ctx.thread.comments.slice(DEFAULT_THREAD_HEAD_COMMENTS).map((c) => c.body)).toEqual(
            Array.from({ length: DEFAULT_THREAD_TAIL_COMMENTS }, (_, i) => `c${total - DEFAULT_THREAD_TAIL_COMMENTS + i + 1}`),
        );
    });

    it('inlines description + acceptance_criteria + recent comments for depends_on linked items', async () => {
        await insertProject('p1');
        await insertItem({
            id: 'ATL-101',
            type: 'epic',
            project_id: 'p1',
            title: 'Epic',
        });
        await insertItem({
            id: 'ATL-102',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-101',
            parent_type: 'epic',
            title: 'Caller',
            description: 'caller description',
        });
        await insertItem({
            id: 'ATL-103',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-101',
            parent_type: 'epic',
            title: 'Dependency',
            description: 'dep description',
            acceptance_criteria: 'AC of dep',
        });
        // Caller depends on Dependency
        await itemLinks.create('ATL-102', 'ATL-103', 'depends_on');
        // Dependency has 5 comments; recent 3 should be inlined
        for (let i = 0; i < 5; i++) {
            await commentsService.create({
                author: 'owner',
                agent_id: null,
                issue_type: 'story',
                issue_id: 'ATL-103',
                body: `dep-c${i + 1}`,
            });
        }

        const ctx = (await assembleReplyContext('story', 'ATL-102'))!;
        expect(ctx.linked_items).toHaveLength(1);
        const li = ctx.linked_items[0]!;
        expect(li.relation_type).toBe('depends_on');
        expect(li.direction).toBe('outgoing');
        expect(li.item_id).toBe('ATL-103');
        expect(li.description).toBe('dep description');
        expect(li.acceptance_criteria).toBe('AC of dep');
        expect(li.recent_comments).toHaveLength(DEFAULT_LINKED_ITEM_RECENT_COMMENTS);
        expect(li.recent_comments.map((c) => c.body)).toEqual(['dep-c3', 'dep-c4', 'dep-c5']);
    });

    it('keeps relates_to linked items shallow (no description, no recent_comments)', async () => {
        await insertProject('p1');
        await insertItem({ id: 'ATL-201', type: 'epic', project_id: 'p1', title: 'Epic' });
        await insertItem({
            id: 'ATL-202',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-201',
            parent_type: 'epic',
            title: 'A',
            description: 'a desc',
        });
        await insertItem({
            id: 'ATL-203',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-201',
            parent_type: 'epic',
            title: 'B',
            description: 'b desc',
            acceptance_criteria: 'AC b',
        });
        await itemLinks.create('ATL-202', 'ATL-203', 'relates_to');
        // Add a comment to B; the envelope must NOT inline it for a relates_to link
        await commentsService.create({
            author: 'owner',
            agent_id: null,
            issue_type: 'story',
            issue_id: 'ATL-203',
            body: 'should-not-leak',
        });

        const ctx = (await assembleReplyContext('story', 'ATL-202'))!;
        expect(ctx.linked_items).toHaveLength(1);
        const li = ctx.linked_items[0]!;
        expect(li.relation_type).toBe('relates_to');
        expect(li.description).toBeNull();
        expect(li.acceptance_criteria).toBeNull();
        expect(li.recent_comments).toEqual([]);
    });

    it('exposes incoming depends_on as direction="incoming"', async () => {
        await insertProject('p1');
        await insertItem({ id: 'ATL-301', type: 'epic', project_id: 'p1', title: 'Epic' });
        await insertItem({
            id: 'ATL-302',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-301',
            parent_type: 'epic',
            title: 'Upstream',
            description: 'I block another item',
        });
        await insertItem({
            id: 'ATL-303',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-301',
            parent_type: 'epic',
            title: 'Downstream',
            description: 'I depend on Upstream',
            acceptance_criteria: 'AC down',
        });
        // Downstream depends_on Upstream → upstream sees the link as incoming
        await itemLinks.create('ATL-303', 'ATL-302', 'depends_on');

        const ctx = (await assembleReplyContext('story', 'ATL-302'))!;
        expect(ctx.linked_items).toHaveLength(1);
        const li = ctx.linked_items[0]!;
        expect(li.relation_type).toBe('depends_on');
        expect(li.direction).toBe('incoming');
        expect(li.item_id).toBe('ATL-303');
        // Even an incoming depends_on inlines description + AC of the linked item;
        // the LLM benefits equally from either direction.
        expect(li.description).toBe('I depend on Upstream');
        expect(li.acceptance_criteria).toBe('AC down');
    });

    it('honours custom budget options', async () => {
        await seedFullTree();
        for (let i = 0; i < 20; i++) {
            await commentsService.create({
                author: 'owner',
                agent_id: null,
                issue_type: 'story',
                issue_id: 'ATL-2',
                body: `c${i + 1}`,
            });
        }
        const ctx = (await assembleReplyContext('story', 'ATL-2', {
            head_comments: 1,
            tail_comments: 2,
            budget_cap: 999,
        }))!;
        expect(ctx.thread.comments).toHaveLength(3);
        expect(ctx.thread.elided_count).toBe(17);
        expect(ctx.budget_cap).toBe(999);
    });

    it('works for every issue type', async () => {
        await seedFullTree();
        expect((await assembleReplyContext('epic', 'ATL-1'))!.item.kind).toBe('epic');
        expect((await assembleReplyContext('story', 'ATL-2'))!.item.kind).toBe('story');
        expect((await assembleReplyContext('sub_task', 'ATL-3'))!.item.kind).toBe('sub_task');
        expect((await assembleReplyContext('sub_bug', 'ATL-4'))!.item.kind).toBe('sub_bug');
        expect((await assembleReplyContext('bug', 'ATL-5'))!.item.kind).toBe('bug');
    });

    it('returns null for every issue type when the id is missing', async () => {
        expect(await assembleReplyContext('epic', 'nope')).toBeNull();
        expect(await assembleReplyContext('sub_task', 'nope')).toBeNull();
        expect(await assembleReplyContext('sub_bug', 'nope')).toBeNull();
        expect(await assembleReplyContext('bug', 'nope')).toBeNull();
    });

    it('maps empty description to null via the || null arm (story with empty description)', async () => {
        // Exercises the `r.story.description || null` false arm when description is '' (empty string).
        // The item must exist but have an empty description so the `|| null` converts to null.
        await insertProject('p1');
        await insertItem({ id: 'ATL-401', type: 'epic', project_id: 'p1', title: 'Epic' });
        await insertItem({
            id: 'ATL-402',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-401',
            parent_type: 'epic',
            title: 'Empty Desc Story',
            description: '',   // <-- empty string → || null → summary: null
        });
        const ctx = (await assembleReplyContext('story', 'ATL-402'))!;
        expect(ctx.item.summary).toBeNull();
    });

    it('maps empty description to null for linked depends_on item (row?.description || null arm)', async () => {
        // Exercises `row?.description || null` when the linked item has an empty description.
        // This is the false arm of the linked-item description fetch in assembleReplyContext.
        await insertProject('p1');
        await insertItem({ id: 'ATL-501', type: 'epic', project_id: 'p1', title: 'Epic' });
        await insertItem({
            id: 'ATL-502',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-501',
            parent_type: 'epic',
            title: 'Caller',
        });
        await insertItem({
            id: 'ATL-503',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-501',
            parent_type: 'epic',
            title: 'Dep',
            description: '',               // empty string → || null
            acceptance_criteria: '',       // empty string → || null
        });
        await itemLinks.create('ATL-502', 'ATL-503', 'depends_on');

        const ctx = (await assembleReplyContext('story', 'ATL-502'))!;
        const li = ctx.linked_items[0]!;
        expect(li.description).toBeNull();
        expect(li.acceptance_criteria).toBeNull();
    });

    it('counts non-comment activity highlights against the token estimate (event branch)', async () => {
        await seedFullTree();
        // Insert a status-change event directly. The activity highlights are
        // capped to the most recent N events and the token-estimator's
        // `a.kind === 'event'` branch only fires when this kind of row exists.
        const { eventsLog } = await import('./events-log.js');
        await eventsLog.record({
            item_id: 'ATL-2',
            item_type: 'story',
            event_type: 'status_changed',
            actor_agent_id: null,
            detail: 'moved from ready to in_progress',
            from_value: 'ready',
            to_value: 'in_progress',
        });
        const ctx = (await assembleReplyContext('story', 'ATL-2'))!;
        expect(ctx.activity_highlights.length).toBeGreaterThan(0);
        // event-kind row contributes to token estimate.
        expect(ctx.token_estimate).toBeGreaterThan(0);
    });
});
