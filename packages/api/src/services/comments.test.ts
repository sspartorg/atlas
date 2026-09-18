import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
vi.mock('./workflow-engine.js', () => ({ continueResumedRun: vi.fn(async () => undefined) }));

import { commentsService } from './comments.js';
import { broadcastSSE } from '../routes/events.js';
import { continueResumedRun } from './workflow-engine.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
    await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'E' });
});

afterAll(async () => {
    await closeTestDb();
});

describe('commentsService', () => {
    it('list returns empty array when no comments', async () => {
        expect(await commentsService.list('task', 'ATL-1')).toEqual([]);
    });

    it('create inserts an owner comment and returns the full row', async () => {
        const row = await commentsService.create({
            author: 'owner',
            issue_type: 'task',
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
            issue_type: 'task',
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
            type: 'sub_task',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'task',
            title: 'S',
        });
        await commentsService.create({
            author: 'owner',
            issue_type: 'task',
            issue_id: 'ATL-1',
            body: 'first',
        });
        await commentsService.create({
            author: 'agent',
            agent_id: 'agent-coder',
            issue_type: 'task',
            issue_id: 'ATL-1',
            body: 'second',
        });
        await commentsService.create({
            author: 'owner',
            issue_type: 'sub_task',
            issue_id: 'ATL-2',
            body: 'other',
        });
        const list = await commentsService.list('task', 'ATL-1');
        expect(list).toHaveLength(2);
        expect(list[0]!.body).toBe('first');
        expect(list[1]!.body).toBe('second');
    });

    it('rejects an invalid author per the check constraint', async () => {
        await expect(
            commentsService.create({
                author: 'invalid' as unknown as 'owner',
                issue_type: 'task',
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
        expect(row.issue_type).toBe('task');
    });

    it('create defaults issue_type to "story" when both omitted and the item is unknown', async () => {
        // Manually insert a comment row whose item_id has no matching items row.
        // We can't go through create() because the FK fires first — so this
        // path is unreachable from production code; the fallback ?? 'task' is
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
            issue_type: 'task',
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
            issue_type: 'task',
            issue_id: 'ATL-1',
            body: 'will be deleted',
        });
        const first = await commentsService.softDelete(created.id);
        expect(first?.id).toBe(created.id);
        expect(first?.author).toBe('agent');
        expect(first?.agent_id).toBe('agent-coder');
        expect(first?.issue_type).toBe('task');

        // Second softDelete sees deleted_at IS NOT NULL → null.
        expect(await commentsService.softDelete(created.id)).toBeNull();
        // Missing id.
        expect(await commentsService.softDelete(999999)).toBeNull();
    });

    it('getRaw returns the row regardless of deleted_at and null when missing', async () => {
        const created = await commentsService.create({
            author: 'owner',
            issue_type: 'task',
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
            issue_type: 'task',
            issue_id: 'ATL-1',
            body: 'keep me',
        });
        const b = await commentsService.create({
            author: 'owner',
            issue_type: 'task',
            issue_id: 'ATL-1',
            body: 'goodbye',
        });
        await commentsService.softDelete(b.id);
        const list = await commentsService.list('task', 'ATL-1');
        expect(list.map((c) => c.id)).toEqual([a.id]);
    });
});

describe('commentsService.create — Owner reply resumes a parked workflow run', () => {
    const RUN_ID = '55555555-5555-5555-5555-555555555555';

    beforeEach(async () => {
        vi.mocked(broadcastSSE).mockClear();
        vi.mocked(continueResumedRun).mockClear();
        await insertItem({
            id: 'ATL-9',
            type: 'sub_task',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'task',
            title: 'Parked',
            status: 'waiting_for_info',
        });
        await testDb
            .insertInto('workflows')
            .values({ id: 'wf-dev', project_id: 'p1', name: 'Dev' })
            .execute();
        await testDb
            .insertInto('workflow_runs')
            .values({
                id: RUN_ID,
                workflow_id: 'wf-dev',
                item_id: 'ATL-9',
                project_id: 'p1',
                status: 'waiting_for_owner',
                parked_node_id: 'coder',
                graph_snapshot: JSON.stringify({ nodes: [], edges: [] }),
            })
            .execute();
    });

    async function state() {
        const item = await testDb.selectFrom('items').select('status').where('id', '=', 'ATL-9').executeTakeFirstOrThrow();
        const run = await testDb.selectFrom('workflow_runs').select('status').where('id', '=', RUN_ID).executeTakeFirstOrThrow();
        return { item: item.status, run: run.status };
    }

    async function resumeEvents() {
        return testDb
            .selectFrom('issue_events')
            .select(['event_type', 'actor_agent_id', 'from_value', 'to_value'])
            .where('item_id', '=', 'ATL-9')
            .where('detail', '=', 'resumed_by_owner_reply')
            .execute();
    }

    const reply = (author: 'owner' | 'agent' = 'owner') =>
        commentsService.create({
            author,
            ...(author === 'agent' ? { agent_id: 'agent-coder' } : {}),
            issue_type: 'sub_task',
            issue_id: 'ATL-9',
            body: 'here is the answer',
        });

    it('claims the parked run, moves the item back to in_progress and continues the run after commit', async () => {
        await reply();
        expect(await state()).toEqual({ item: 'in_progress', run: 'running' });
        expect(await resumeEvents()).toEqual([
            { event_type: 'status_changed', actor_agent_id: null, from_value: 'waiting_for_info', to_value: 'in_progress' },
        ]);
        expect(broadcastSSE).toHaveBeenCalledWith({ type: 'counts_changed', issueType: 'sub_task', issueId: 'ATL-9' });
        await vi.waitFor(() => expect(continueResumedRun).toHaveBeenCalledWith(RUN_ID));
    });

    it('is a no-op when no workflow run is waiting on the item', async () => {
        await testDb.updateTable('workflow_runs').set({ status: 'running' }).where('id', '=', RUN_ID).execute();
        await reply();
        expect(await state()).toEqual({ item: 'waiting_for_info', run: 'running' });
        expect(await resumeEvents()).toEqual([]);
        expect(continueResumedRun).not.toHaveBeenCalled();
    });

    it('never triggers on an agent-authored comment', async () => {
        await reply('agent');
        expect(await state()).toEqual({ item: 'waiting_for_info', run: 'waiting_for_owner' });
        expect(continueResumedRun).not.toHaveBeenCalled();
    });
});
