import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import {
    incrementRound,
    getRound,
    resetRoundsForItem,
    resetRoundsForIssue,
    resetRoundsUnlessBounceBack,
} from './agent-rounds.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem, insertAgent } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'A' });
    await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'B' });
});

afterAll(async () => {
    await closeTestDb();
});

describe('agent-rounds — per-(item, performer) round counter', () => {
    it('returns 0 when no counter row exists yet', async () => {
        expect(await getRound('ATL-1', 'agent-coder')).toBe(0);
    });

    it('incrementRound inserts a row with count=1 on first call', async () => {
        const count = await incrementRound('ATL-1', 'agent-coder');
        expect(count).toBe(1);
        expect(await getRound('ATL-1', 'agent-coder')).toBe(1);
    });

    it('incrementRound bumps the count on subsequent calls', async () => {
        await incrementRound('ATL-1', 'agent-coder');
        await incrementRound('ATL-1', 'agent-coder');
        const count = await incrementRound('ATL-1', 'agent-coder');
        expect(count).toBe(3);
        expect(await getRound('ATL-1', 'agent-coder')).toBe(3);
    });

    it('keys on (item_id, performer_agent_id) — separate items keep separate counters', async () => {
        await incrementRound('ATL-1', 'agent-coder');
        await incrementRound('ATL-1', 'agent-coder');
        await incrementRound('ATL-2', 'agent-coder');
        expect(await getRound('ATL-1', 'agent-coder')).toBe(2);
        expect(await getRound('ATL-2', 'agent-coder')).toBe(1);
    });

    it('keys on (item_id, performer_agent_id) — same item different performers keep separate counters', async () => {
        await incrementRound('ATL-1', 'agent-coder');
        await incrementRound('ATL-1', 'agent-po-writer');
        await incrementRound('ATL-1', 'agent-po-writer');
        expect(await getRound('ATL-1', 'agent-coder')).toBe(1);
        expect(await getRound('ATL-1', 'agent-po-writer')).toBe(2);
    });

    it('resetRoundsForItem clears every counter row for an item', async () => {
        await incrementRound('ATL-1', 'agent-coder');
        await incrementRound('ATL-1', 'agent-po-writer');
        await incrementRound('ATL-2', 'agent-coder');
        await resetRoundsForItem('ATL-1');
        expect(await getRound('ATL-1', 'agent-coder')).toBe(0);
        expect(await getRound('ATL-1', 'agent-po-writer')).toBe(0);
        // Other item's counter survives.
        expect(await getRound('ATL-2', 'agent-coder')).toBe(1);
    });

    it('cascades cleanup when the underlying item is deleted (FK ON DELETE CASCADE)', async () => {
        await incrementRound('ATL-1', 'agent-coder');
        await testDb.deleteFrom('items').where('id', '=', 'ATL-1').execute();
        const rows = await testDb
            .selectFrom('agent_round_counts')
            .selectAll()
            .where('item_id', '=', 'ATL-1')
            .execute();
        expect(rows).toEqual([]);
    });
});

describe('resetRoundsForIssue — Owner escape hatch', () => {
    beforeEach(async () => {
        await insertAgent({ id: 'agent-coder' });
        await testDb
            .updateTable('items')
            .set({ assignee_agent_id: 'agent-coder' })
            .where('id', '=', 'ATL-1')
            .execute();
    });

    it('clears the (item, current-assignee) counter and reports the count-before snapshot', async () => {
        await incrementRound('ATL-1', 'agent-coder');
        await incrementRound('ATL-1', 'agent-coder');
        await incrementRound('ATL-1', 'agent-coder');

        const result = await resetRoundsForIssue('ATL-1');

        expect(result.previousCount).toBe(3);
        expect(result.assigneeAgentId).toBe('agent-coder');
        expect(result.itemType).toBe('epic');
        expect(await getRound('ATL-1', 'agent-coder')).toBe(0);
    });

    it('writes a rounds_reset event to the activity log', async () => {
        await incrementRound('ATL-1', 'agent-coder');
        await incrementRound('ATL-1', 'agent-coder');

        await resetRoundsForIssue('ATL-1');

        const events = await testDb
            .selectFrom('issue_events')
            .selectAll()
            .where('item_id', '=', 'ATL-1')
            .where('event_type', '=', 'rounds_reset')
            .execute();
        expect(events).toHaveLength(1);
        expect(events[0]?.actor_agent_id).toBeNull(); // Owner-initiated
        expect(events[0]?.from_value).toBe('2'); // previous count
        expect(events[0]?.to_value).toBe('agent-coder'); // current assignee
    });

    it('throws when the item id does not resolve (so the route can 404)', async () => {
        await expect(resetRoundsForIssue('ATL-does-not-exist')).rejects.toThrow(
            /Item not found/,
        );
    });

    it('handles items with no current assignee gracefully (previousCount=0, to_value=null)', async () => {
        await testDb
            .updateTable('items')
            .set({ assignee_agent_id: null })
            .where('id', '=', 'ATL-1')
            .execute();

        const result = await resetRoundsForIssue('ATL-1');
        expect(result.previousCount).toBe(0);
        expect(result.assigneeAgentId).toBeNull();
    });
});

// Loop guard — a self-routed run only wipes the item's counters on forward
// progress. Handing the item back to an agent that already ran on it (a
// writer↔reviewer bounce) must keep them so the dispatcher's max_rounds cap
// can eventually park the item with the Owner.
describe('resetRoundsUnlessBounceBack', () => {
    beforeEach(async () => {
        await insertAgent({ id: 'agent-writer' });
        await insertAgent({ id: 'agent-reviewer' });
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'run-writer-1', agent_id: 'agent-writer', item_id: 'ATL-1', status: 'completed' })
            .execute();
        await incrementRound('ATL-1', 'agent-writer');
    });

    async function assign(assignee: string | null): Promise<void> {
        await testDb.updateTable('items').set({ assignee_agent_id: assignee }).where('id', '=', 'ATL-1').execute();
    }

    it('resets on forward progress — the new assignee has never run on this item', async () => {
        await assign('agent-reviewer');
        await resetRoundsUnlessBounceBack('ATL-1');
        expect(await getRound('ATL-1', 'agent-writer')).toBe(0);
    });

    it('keeps the counters on a bounce-back to an agent that already ran on this item', async () => {
        await assign('agent-writer');
        await resetRoundsUnlessBounceBack('ATL-1');
        expect(await getRound('ATL-1', 'agent-writer')).toBe(1);
    });

    it('resets when the item lands with the Owner', async () => {
        await assign(null);
        await resetRoundsUnlessBounceBack('ATL-1');
        expect(await getRound('ATL-1', 'agent-writer')).toBe(0);
    });
});
