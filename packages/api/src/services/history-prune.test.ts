import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { sql } from 'kysely';
import { historyPruneService } from './history-prune.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

// Fixed anchor timestamps used across tests. All test data is inserted
// with an explicit `created_at`, so we don't depend on wall-clock time.
const T_OLD = '2026-06-01T00:00:00.000Z'; // strictly before cutoff → deleted
const T_CUTOFF = '2026-06-15T00:00:00.000Z'; // boundary → preserved (created_at < before_time)
const T_NEW = '2026-06-20T00:00:00.000Z'; // strictly after cutoff → preserved

async function seedComment(input: {
    itemId: string;
    author: 'owner' | 'agent';
    agentId?: string | null;
    createdAt: string;
    body?: string;
}): Promise<number> {
    const row = await testDb
        .insertInto('comments')
        .values({
            item_id: input.itemId,
            author: input.author,
            agent_id: input.agentId ?? null,
            body: input.body ?? 'x',
            created_at: input.createdAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    return row.id;
}

async function seedEvent(input: {
    itemId: string;
    eventType: 'created' | 'status_changed' | 'assigned' | 'comment_added';
    actorAgentId: string | null;
    createdAt: string;
}): Promise<number> {
    const row = await testDb
        .insertInto('issue_events')
        .values({
            item_id: input.itemId,
            event_type: input.eventType,
            actor_agent_id: input.actorAgentId,
            created_at: input.createdAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    return row.id;
}

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
});

afterAll(async () => {
    await closeTestDb();
});

describe('historyPruneService.pruneBefore', () => {
    it('no-op returns zeros when the item has no rows (writes only the audit event)', async () => {
        const result = await historyPruneService.pruneBefore('ATL-1', 'epic', T_CUTOFF, 'agent-coder');
        expect(result).toEqual({ comments_deleted: 0, events_deleted: 0, owner_comments_preserved: 0 });
        // The audit event is still written (visible after the transaction
        // commits) so the destructive call is always traceable.
        const audit = await testDb
            .selectFrom('issue_events')
            .selectAll()
            .where('item_id', '=', 'ATL-1')
            .where('event_type', '=', 'history_pruned')
            .execute();
        expect(audit).toHaveLength(1);
        expect(audit[0]!.actor_agent_id).toBe('agent-coder');
        expect(audit[0]!.from_value).toBe(T_CUTOFF);
        expect(audit[0]!.to_value).toBe('0');
    });

    it('deletes only comments with created_at strictly < before_time', async () => {
        await seedComment({ itemId: 'ATL-1', author: 'agent', agentId: 'agent-coder', createdAt: T_OLD });
        await seedComment({ itemId: 'ATL-1', author: 'owner', createdAt: T_CUTOFF }); // boundary — preserved
        await seedComment({ itemId: 'ATL-1', author: 'agent', agentId: 'agent-coder', createdAt: T_NEW });

        const result = await historyPruneService.pruneBefore('ATL-1', 'epic', T_CUTOFF, 'agent-coder');
        expect(result.comments_deleted).toBe(1);

        const remaining = await testDb
            .selectFrom('comments')
            .select(['created_at'])
            .where('item_id', '=', 'ATL-1')
            .orderBy('created_at', 'asc')
            .execute();
        expect(remaining.map((r) => r.created_at)).toEqual([T_CUTOFF, T_NEW]);
    });

    it('deletes only issue_events with created_at strictly < before_time', async () => {
        await seedEvent({ itemId: 'ATL-1', eventType: 'created', actorAgentId: null, createdAt: T_OLD });
        await seedEvent({ itemId: 'ATL-1', eventType: 'status_changed', actorAgentId: 'agent-coder', createdAt: T_CUTOFF });
        await seedEvent({ itemId: 'ATL-1', eventType: 'assigned', actorAgentId: null, createdAt: T_NEW });

        const result = await historyPruneService.pruneBefore('ATL-1', 'epic', T_CUTOFF, 'agent-coder');
        expect(result.events_deleted).toBe(1);

        // The audit `history_pruned` event is appended at commit time so
        // it shows up alongside the seeded status_changed + assigned rows.
        const remaining = await testDb
            .selectFrom('issue_events')
            .select(['event_type', 'created_at'])
            .where('item_id', '=', 'ATL-1')
            .orderBy('created_at', 'asc')
            .execute();
        expect(remaining.map((r) => r.event_type)).toEqual([
            'status_changed',
            'assigned',
            'history_pruned',
        ]);
    });

    it('deletes across both tables in one call — response counts match', async () => {
        await seedComment({ itemId: 'ATL-1', author: 'agent', agentId: 'agent-coder', createdAt: T_OLD });
        await seedComment({ itemId: 'ATL-1', author: 'agent', agentId: 'agent-coder', createdAt: T_OLD });
        await seedComment({ itemId: 'ATL-1', author: 'owner', createdAt: T_NEW });
        await seedEvent({ itemId: 'ATL-1', eventType: 'created', actorAgentId: null, createdAt: T_OLD });
        await seedEvent({ itemId: 'ATL-1', eventType: 'status_changed', actorAgentId: 'agent-coder', createdAt: T_OLD });
        await seedEvent({ itemId: 'ATL-1', eventType: 'status_changed', actorAgentId: null, createdAt: T_OLD });
        await seedEvent({ itemId: 'ATL-1', eventType: 'comment_added', actorAgentId: null, createdAt: T_NEW });

        const result = await historyPruneService.pruneBefore('ATL-1', 'epic', T_CUTOFF, 'agent-coder');
        expect(result).toEqual({ comments_deleted: 2, events_deleted: 3, owner_comments_preserved: 0 });

        const cCount = await sql<{ n: string }>`SELECT COUNT(*)::text AS n FROM comments WHERE item_id = 'ATL-1'`.execute(testDb);
        const eCount = await sql<{ n: string }>`SELECT COUNT(*)::text AS n FROM issue_events WHERE item_id = 'ATL-1'`.execute(testDb);
        expect(Number(cCount.rows[0]!.n)).toBe(1); // the T_NEW comment
        // The T_NEW event PLUS the audit `history_pruned` event = 2.
        expect(Number(eCount.rows[0]!.n)).toBe(2);
    });

    it('preserves owner-authored comments — the destructive path spares Owner content (2026-07-03 audit)', async () => {
        // Under the pre-audit shape, owner comments were hard-deleted too
        // (any MCP client with the write token could nuke Owner content).
        // The fix filters `author != 'owner'` in the comments delete and
        // reports the preserved count so the audit event can note it.
        await seedComment({ itemId: 'ATL-1', author: 'owner', createdAt: T_OLD });
        await seedComment({ itemId: 'ATL-1', author: 'owner', createdAt: T_OLD });
        await seedComment({ itemId: 'ATL-1', author: 'agent', agentId: 'agent-coder', createdAt: T_OLD });
        await seedEvent({ itemId: 'ATL-1', eventType: 'created', actorAgentId: null, createdAt: T_OLD });
        await seedEvent({ itemId: 'ATL-1', eventType: 'status_changed', actorAgentId: 'agent-coder', createdAt: T_OLD });

        const result = await historyPruneService.pruneBefore('ATL-1', 'epic', T_CUTOFF, 'agent-coder');
        expect(result).toEqual({
            comments_deleted: 1,
            events_deleted: 2,
            owner_comments_preserved: 2,
        });

        // Verify the two Owner comments survive.
        const owners = await testDb
            .selectFrom('comments')
            .select(['author'])
            .where('item_id', '=', 'ATL-1')
            .execute();
        expect(owners).toHaveLength(2);
        expect(owners.every((r) => r.author === 'owner')).toBe(true);

        // Verify the audit event mentions the preserved count.
        const audit = await testDb
            .selectFrom('issue_events')
            .selectAll()
            .where('item_id', '=', 'ATL-1')
            .where('event_type', '=', 'history_pruned')
            .execute();
        expect(audit).toHaveLength(1);
        expect(audit[0]!.detail).toContain('2 owner comment');
    });

    it('scoped to the target item — rows on other items are untouched', async () => {
        await insertItem({ id: 'ATL-2', type: 'story', project_id: 'p1', parent_id: 'ATL-1', parent_type: 'epic', title: 'S' });
        await seedComment({ itemId: 'ATL-1', author: 'agent', agentId: 'agent-coder', createdAt: T_OLD });
        await seedComment({ itemId: 'ATL-2', author: 'agent', agentId: 'agent-coder', createdAt: T_OLD });
        await seedEvent({ itemId: 'ATL-1', eventType: 'created', actorAgentId: null, createdAt: T_OLD });
        await seedEvent({ itemId: 'ATL-2', eventType: 'created', actorAgentId: null, createdAt: T_OLD });

        const result = await historyPruneService.pruneBefore('ATL-1', 'epic', T_CUTOFF, 'agent-coder');
        expect(result).toEqual({ comments_deleted: 1, events_deleted: 1, owner_comments_preserved: 0 });

        const cOther = await testDb.selectFrom('comments').selectAll().where('item_id', '=', 'ATL-2').execute();
        const eOther = await testDb.selectFrom('issue_events').selectAll().where('item_id', '=', 'ATL-2').execute();
        expect(cOther).toHaveLength(1);
        expect(eOther).toHaveLength(1);
    });

    it('runs in one transaction — both deletes are visible only after the call returns', async () => {
        // Weak proof (no easy way to fault-inject a partial failure without
        // additional infra), but at least confirms the successful path
        // commits both sides atomically. Concurrent readers between the
        // two DELETEs would see either both-still-present or both-gone,
        // never a half-state.
        await seedComment({ itemId: 'ATL-1', author: 'agent', agentId: 'agent-coder', createdAt: T_OLD });
        await seedEvent({ itemId: 'ATL-1', eventType: 'created', actorAgentId: null, createdAt: T_OLD });

        const result = await historyPruneService.pruneBefore('ATL-1', 'epic', T_CUTOFF, 'agent-coder');
        expect(result).toEqual({ comments_deleted: 1, events_deleted: 1, owner_comments_preserved: 0 });

        const cCount = await sql<{ n: string }>`SELECT COUNT(*)::text AS n FROM comments WHERE item_id = 'ATL-1'`.execute(testDb);
        const eCount = await sql<{ n: string }>`SELECT COUNT(*)::text AS n FROM issue_events WHERE item_id = 'ATL-1'`.execute(testDb);
        expect(Number(cCount.rows[0]!.n)).toBe(0);
        // 1 audit `history_pruned` event remains (created_at is NOW,
        // strictly greater than the T_CUTOFF filter, so it doesn't
        // consume its own prune).
        expect(Number(eCount.rows[0]!.n)).toBe(1);
    });
});
