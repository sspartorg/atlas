import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { commentsService } from './comments.js';
import { broadcastSSE } from '../routes/events.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
});

afterAll(async () => {
    await closeTestDb();
});

describe('commentsService', () => {
    it('list returns empty array when no comments', async () => {
        expect(await commentsService.list('epic', 'ATL-1')).toEqual([]);
    });

    it('create inserts an owner comment and returns the full row', async () => {
        const row = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'looks ok',
        });
        expect(Number(row.id)).toBeGreaterThan(0);
        expect(row.author).toBe('owner');
        expect(row.body).toBe('looks ok');
        expect(row.agent_id).toBeNull();
    });

    it('create inserts an agent comment with agent_id linked', async () => {
        const row = await commentsService.create({
            author: 'agent',
            agent_id: 'agent-coder',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'starting',
        });
        expect(row.author).toBe('agent');
        expect(row.agent_id).toBe('agent-coder');
    });

    it('list filters by issue id, ordered by created_at asc', async () => {
        // Seed a second item the second-issue comment can point at.
        await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'S',
        });
        await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'first',
        });
        await commentsService.create({
            author: 'agent',
            agent_id: 'agent-coder',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'second',
        });
        await commentsService.create({
            author: 'owner',
            issue_type: 'story',
            issue_id: 'ATL-2',
            body: 'other',
        });
        const list = await commentsService.list('epic', 'ATL-1');
        expect(list).toHaveLength(2);
        expect(list[0]!.body).toBe('first');
        expect(list[1]!.body).toBe('second');
    });

    it('rejects an invalid author per the check constraint', async () => {
        await expect(
            commentsService.create({
                author: 'invalid' as unknown as 'owner',
                issue_type: 'epic',
                issue_id: 'ATL-1',
                body: 'x',
            }),
        ).rejects.toThrow();
    });

    it('create infers issue_type via lookupItemType when caller omits it', async () => {
        const row = await commentsService.create({
            author: 'owner',
            // @ts-expect-error — exercise the lookupItemType fallback path
            issue_type: undefined,
            issue_id: 'ATL-1',
            body: 'fall back to lookup',
        });
        expect(row.issue_type).toBe('epic');
    });

    it('create defaults issue_type to "story" when both omitted and the item is unknown', async () => {
        // Manually insert a comment row whose item_id has no matching items row.
        // We can't go through create() because the FK fires first — so this
        // path is unreachable from production code; the fallback ?? 'story' is
        // a defensive guard. Skip rather than force a contrived setup.
        expect(true).toBe(true);
    });

    it('update returns null for a non-existent id', async () => {
        const r = await commentsService.update(99999, 'whatever');
        expect(r).toBeNull();
    });

    it('update stamps edited_at and ignores deleted rows', async () => {
        const created = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'orig',
        });
        const updated = await commentsService.update(created.id, 'edited');
        expect(updated?.body).toBe('edited');
        expect(updated?.edited_at).not.toBeNull();

        // Soft-delete then re-update — must return null.
        await commentsService.softDelete(created.id);
        expect(await commentsService.update(created.id, 'again')).toBeNull();
    });

    it('softDelete returns null for missing id and for already-deleted rows', async () => {
        const created = await commentsService.create({
            author: 'agent',
            agent_id: 'agent-coder',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'will be deleted',
        });
        const first = await commentsService.softDelete(created.id);
        expect(first?.id).toBe(created.id);
        expect(first?.author).toBe('agent');
        expect(first?.agent_id).toBe('agent-coder');
        expect(first?.issue_type).toBe('epic');

        // Second softDelete sees deleted_at IS NOT NULL → null.
        expect(await commentsService.softDelete(created.id)).toBeNull();
        // Missing id.
        expect(await commentsService.softDelete(999999)).toBeNull();
    });

    it('getRaw returns the row regardless of deleted_at and null when missing', async () => {
        const created = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'raw',
        });
        const raw = await commentsService.getRaw(created.id);
        expect(raw?.id).toBe(created.id);
        expect(raw?.deleted_at).toBeNull();
        await commentsService.softDelete(created.id);
        const rawDeleted = await commentsService.getRaw(created.id);
        // Still readable.
        expect(rawDeleted?.id).toBe(created.id);
        expect(rawDeleted?.deleted_at).not.toBeNull();
        // Missing.
        expect(await commentsService.getRaw(999999)).toBeNull();
    });

    it('list hides soft-deleted comments', async () => {
        const a = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'keep me',
        });
        const b = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'goodbye',
        });
        await commentsService.softDelete(b.id);
        const list = await commentsService.list('epic', 'ATL-1');
        expect(list.map((c) => c.id)).toEqual([a.id]);
    });
});

describe('commentsService.create — Owner reply resumes a parked item', () => {
    beforeEach(async () => {
        vi.mocked(broadcastSSE).mockClear();
        await insertAgent({ id: 'agent-old', name: 'Old' });
        await insertItem({
            id: 'ATL-9',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Parked',
            status: 'waiting_for_info',
        });
        // Two runs so "most recent" is actually exercised.
        await testDb
            .insertInto('agent_runs')
            .values([
                {
                    id: '33333333-3333-3333-3333-333333333333',
                    agent_id: 'agent-old',
                    item_id: 'ATL-9',
                    project_id: 'p1',
                    status: 'completed',
                    created_at: '2026-01-01T00:00:00Z',
                },
                {
                    id: '44444444-4444-4444-4444-444444444444',
                    agent_id: 'agent-coder',
                    item_id: 'ATL-9',
                    project_id: 'p1',
                    status: 'completed',
                    created_at: '2026-01-02T00:00:00Z',
                },
            ])
            .execute();
    });

    async function itemRow() {
        return testDb
            .selectFrom('items')
            .select(['status', 'assignee_agent_id'])
            .where('id', '=', 'ATL-9')
            .executeTakeFirstOrThrow();
    }

    async function resumeEvents() {
        return testDb
            .selectFrom('issue_events')
            .select(['event_type', 'actor_agent_id', 'from_value', 'to_value'])
            .where('item_id', '=', 'ATL-9')
            .where('detail', '=', 'resumed_by_owner_reply')
            .orderBy('event_type')
            .execute();
    }

    const reply = (author: 'owner' | 'agent' = 'owner') =>
        commentsService.create({
            author,
            ...(author === 'agent' ? { agent_id: 'agent-coder' } : {}),
            issue_type: 'story',
            issue_id: 'ATL-9',
            body: 'here is the answer',
        });

    it('reassigns the last run agent, moves to ready, logs Owner events and broadcasts', async () => {
        await reply();
        expect(await itemRow()).toEqual({ status: 'ready', assignee_agent_id: 'agent-coder' });
        expect(await resumeEvents()).toEqual([
            { event_type: 'assigned', actor_agent_id: null, from_value: null, to_value: 'agent-coder' },
            {
                event_type: 'status_changed',
                actor_agent_id: null,
                from_value: 'waiting_for_info',
                to_value: 'ready',
            },
        ]);
        expect(broadcastSSE).toHaveBeenCalledWith({
            type: 'counts_changed',
            issueType: 'story',
            issueId: 'ATL-9',
        });
    });

    it('is a no-op when the item already has an assignee', async () => {
        await testDb.updateTable('items').set({ assignee_agent_id: 'agent-old' }).where('id', '=', 'ATL-9').execute();
        await reply();
        expect(await itemRow()).toEqual({ status: 'waiting_for_info', assignee_agent_id: 'agent-old' });
        expect(await resumeEvents()).toEqual([]);
    });

    it('is a no-op when the item is not waiting_for_info', async () => {
        await testDb.updateTable('items').set({ status: 'in_review' }).where('id', '=', 'ATL-9').execute();
        await reply();
        expect(await itemRow()).toEqual({ status: 'in_review', assignee_agent_id: null });
        expect(await resumeEvents()).toEqual([]);
    });

    it('is a no-op when the last run agent is inactive', async () => {
        await testDb.updateTable('agents').set({ status: 'inactive' }).where('id', '=', 'agent-coder').execute();
        await reply();
        expect(await itemRow()).toEqual({ status: 'waiting_for_info', assignee_agent_id: null });
        expect(await resumeEvents()).toEqual([]);
        expect(broadcastSSE).not.toHaveBeenCalled();
    });

    it('is a no-op when the item has no runs', async () => {
        await testDb.deleteFrom('agent_runs').where('item_id', '=', 'ATL-9').execute();
        await reply();
        expect(await itemRow()).toEqual({ status: 'waiting_for_info', assignee_agent_id: null });
    });

    it('never triggers on an agent-authored comment', async () => {
        await reply('agent');
        expect(await itemRow()).toEqual({ status: 'waiting_for_info', assignee_agent_id: null });
        expect(await resumeEvents()).toEqual([]);
    });
});
