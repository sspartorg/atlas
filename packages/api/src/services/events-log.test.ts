import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { sql } from 'kysely';
import { eventsLog } from './events-log.js';
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

describe('eventsLog', () => {
    describe('record', () => {
        it('inserts an event with all required fields and returns the row', async () => {
            const row = await eventsLog.record({
                item_id: 'ATL-1',
                item_type: 'epic',
                event_type: 'created',
                to_value: 'Title',
            });
            expect(Number(row.id)).toBeGreaterThan(0);
            expect(row.issue_type).toBe('epic');
            expect(row.event_type).toBe('created');
            expect(row.to_value).toBe('Title');
            expect(row.actor_agent_id).toBeNull();
        });

        it('looks up item_type from DB when input.item_type is omitted (lookupItemType ?? arm)', async () => {
            // No item_type passed → fires `lookupItemType(item_id)` → returns 'epic' from DB
            const row = await eventsLog.record({
                item_id: 'ATL-1',
                event_type: 'created',
            });
            // Should resolve to 'epic' via DB lookup (not fallback 'story').
            expect(row.issue_type).toBe('epic');
        });

        it('truncates from_value, to_value, detail to 280 chars with ellipsis', async () => {
            const long = 'x'.repeat(500);
            const row = await eventsLog.record({
                item_id: 'ATL-1',
                item_type: 'epic',
                event_type: 'field_updated',
                from_value: long,
                to_value: long,
                detail: long,
            });
            expect(row.from_value!.length).toBe(280);
            expect(row.from_value!.endsWith('…')).toBe(true);
            expect(row.to_value!.length).toBe(280);
            expect(row.detail!.length).toBe(280);
        });

        it('passes nulls through without modification', async () => {
            const row = await eventsLog.record({
                item_id: 'ATL-1',
                item_type: 'epic',
                event_type: 'created',
            });
            expect(row.from_value).toBeNull();
            expect(row.to_value).toBeNull();
            expect(row.detail).toBeNull();
        });
    });

    describe('list', () => {
        it('returns events scoped to the item, ordered by created_at then id ASC', async () => {
            await insertItem({
                id: 'ATL-2',
                type: 'story',
                project_id: 'p1',
                parent_id: 'ATL-1',
                parent_type: 'epic',
                title: 'S',
            });
            await eventsLog.record({
                item_id: 'ATL-1',
                item_type: 'epic',
                event_type: 'created',
                to_value: 'a',
            });
            await eventsLog.record({
                item_id: 'ATL-1',
                item_type: 'epic',
                event_type: 'status_changed',
                from_value: 'draft',
                to_value: 'ready',
            });
            await eventsLog.record({
                item_id: 'ATL-2',
                item_type: 'story',
                event_type: 'created',
                to_value: 'other',
            });
            const list = await eventsLog.list('ATL-1', 'epic');
            expect(list).toHaveLength(2);
            expect(list[0]!.event_type).toBe('created');
            expect(list[1]!.event_type).toBe('status_changed');
        });
    });

    describe('logDispatchBlocked (B04)', () => {
        it('records a dispatch_blocked event with agent + comma-separated blocker list in detail', async () => {
            await eventsLog.logDispatchBlocked('ATL-1', 'agent-coder', [
                { id: 'ATL-42', status: 'in_progress' },
                { id: 'ATL-43', status: 'in_review' },
            ]);
            const list = await eventsLog.list('ATL-1', 'epic');
            expect(list).toHaveLength(1);
            expect(list[0]!.event_type).toBe('dispatch_blocked');
            expect(list[0]!.actor_agent_id).toBe('agent-coder');
            expect(list[0]!.detail).toBe('ATL-42 (in_progress), ATL-43 (in_review)');
        });

        it('records an empty detail string when blockers list is empty (defensive — caller should not call in this case)', async () => {
            await eventsLog.logDispatchBlocked('ATL-1', 'agent-coder', []);
            const list = await eventsLog.list('ATL-1', 'epic');
            expect(list).toHaveLength(1);
            expect(list[0]!.event_type).toBe('dispatch_blocked');
            expect(list[0]!.detail).toBe('');
        });
    });

    // A5 / 05-coverage-gap — logFieldUpdates was never test-covered. It's
    // the shared field-change logger every entity-service calls during an
    // update; the route-level tests exercise it indirectly but the unit
    // surface has zero direct coverage, dragging events-log.ts branches
    // below 90%.
    describe('logFieldUpdates', () => {
        it('records a field_updated event for each allowed field that actually changed', async () => {
            await eventsLog.logFieldUpdates(
                'epic',
                'ATL-1',
                { title: 'old', description: 'old body', priority: 'normal' },
                { title: 'new', description: 'new body' },
                ['title', 'description'],
            );
            const list = await eventsLog.list('ATL-1', 'epic');
            // One row per changed field — title and description.
            expect(list).toHaveLength(2);
            const titleEvent = list.find((e) => e.field === 'title');
            const descEvent = list.find((e) => e.field === 'description');
            expect(titleEvent?.from_value).toBe('old');
            expect(titleEvent?.to_value).toBe('new');
            expect(descEvent?.from_value).toBe('old body');
            expect(descEvent?.to_value).toBe('new body');
        });

        it('skips data keys that are undefined (no event)', async () => {
            await eventsLog.logFieldUpdates(
                'epic',
                'ATL-1',
                { title: 'a' },
                { title: undefined as never },
                ['title'],
            );
            const list = await eventsLog.list('ATL-1', 'epic');
            expect(list).toHaveLength(0);
        });

        it('skips data keys without a column → field mapping', async () => {
            await eventsLog.logFieldUpdates(
                'epic',
                'ATL-1',
                { unknown_col: 'a' },
                { unknown_col: 'b' },
                ['title'],
            );
            const list = await eventsLog.list('ATL-1', 'epic');
            expect(list).toHaveLength(0);
        });

        it('skips fields not present in allowedFields', async () => {
            await eventsLog.logFieldUpdates(
                'epic',
                'ATL-1',
                { title: 'a' },
                { title: 'b' },
                // empty allowlist
                [],
            );
            const list = await eventsLog.list('ATL-1', 'epic');
            expect(list).toHaveLength(0);
        });

        it('skips fields whose before === after (no actual change)', async () => {
            await eventsLog.logFieldUpdates(
                'epic',
                'ATL-1',
                { title: 'same' },
                { title: 'same' },
                ['title'],
            );
            const list = await eventsLog.list('ATL-1', 'epic');
            expect(list).toHaveLength(0);
        });

        it('serialises null before/after as null (not the string "null")', async () => {
            await eventsLog.logFieldUpdates(
                'epic',
                'ATL-1',
                { description: null },
                { description: 'something' },
                ['description'],
            );
            const list = await eventsLog.list('ATL-1', 'epic');
            expect(list).toHaveLength(1);
            expect(list[0]!.from_value).toBeNull();
            expect(list[0]!.to_value).toBe('something');
        });

        it('maps `reporter_agent_id` data key to the `reporter` event field', async () => {
            await eventsLog.logFieldUpdates(
                'epic',
                'ATL-1',
                { reporter_agent_id: 'old-agent' },
                { reporter_agent_id: 'new-agent' },
                ['reporter'],
            );
            const list = await eventsLog.list('ATL-1', 'epic');
            expect(list).toHaveLength(1);
            expect(list[0]!.field).toBe('reporter');
            expect(list[0]!.from_value).toBe('old-agent');
            expect(list[0]!.to_value).toBe('new-agent');
        });

        it('falls back to mapped field name when before object uses the mapped key (beforeKey = mapped arm)', async () => {
            // `reporter_agent_id` maps to `reporter`.
            // When `before` has key `reporter` (not `reporter_agent_id`),
            // the `k in before` check fails → `beforeKey = mapped = 'reporter'`.
            await eventsLog.logFieldUpdates(
                'epic',
                'ATL-1',
                { reporter: 'old-agent' },   // keyed as 'reporter' (the mapped name)
                { reporter_agent_id: 'new-agent' },  // data key is reporter_agent_id
                ['reporter'],
            );
            const list = await eventsLog.list('ATL-1', 'epic');
            expect(list).toHaveLength(1);
            expect(list[0]!.field).toBe('reporter');
            expect(list[0]!.from_value).toBe('old-agent');
            expect(list[0]!.to_value).toBe('new-agent');
        });
    });

    describe('list without issueType (lookupItemType branch)', () => {
        it('resolves issueType via lookupItemType when not passed (list ?? arm)', async () => {
            await eventsLog.record({
                item_id: 'ATL-1',
                item_type: 'epic',
                event_type: 'created',
            });
            // list called without issueType → fires lookupItemType
            const list = await eventsLog.list('ATL-1');
            expect(list).toHaveLength(1);
            expect(list[0]!.issue_type).toBe('epic');
        });
    });

    describe('activity', () => {
        it('merges events + comments sorted by created_at then id ASC', async () => {
            // Insert with explicit created_at via raw SQL, bypassing the
            // items_set_updated_at-style auto-stamp. issue_events doesn't
            // have such a trigger, so direct INSERT preserves the value.
            await sql`
                INSERT INTO issue_events (item_id, event_type, created_at)
                VALUES ('ATL-1', 'created', '2026-01-01T00:00:00Z')
            `.execute(testDb);
            await sql`
                INSERT INTO comments (author, item_id, body, created_at)
                VALUES ('owner', 'ATL-1', 'first', '2026-01-02T00:00:00Z')
            `.execute(testDb);
            await sql`
                INSERT INTO issue_events (item_id, event_type, created_at)
                VALUES ('ATL-1', 'status_changed', '2026-01-03T00:00:00Z')
            `.execute(testDb);

            const activity = await eventsLog.activity('ATL-1', 'epic');
            expect(activity).toHaveLength(3);
            expect(activity[0]!.kind).toBe('event');
            expect(activity[1]!.kind).toBe('comment');
            expect(activity[2]!.kind).toBe('event');
        });

        it('resolves issueType via lookupItemType when not passed to activity (activity ?? arm)', async () => {
            await sql`INSERT INTO issue_events (item_id, event_type) VALUES ('ATL-1', 'created')`.execute(testDb);
            // activity called without issueType → fires lookupItemType
            const activity = await eventsLog.activity('ATL-1');
            expect(activity).toHaveLength(1);
            expect((activity[0]!.data as { issue_type: string }).issue_type).toBe('epic');
        });

        it('sorts later created_at after earlier created_at (ta > tb → return 1 branch)', async () => {
            const t1 = '2026-01-01T00:00:00Z';
            const t2 = '2026-01-02T00:00:00Z';
            await sql`INSERT INTO issue_events (item_id, event_type, created_at) VALUES ('ATL-1', 'created', ${t2})`.execute(testDb);
            await sql`INSERT INTO issue_events (item_id, event_type, created_at) VALUES ('ATL-1', 'status_changed', ${t1})`.execute(testDb);
            const activity = await eventsLog.activity('ATL-1', 'epic');
            expect(activity).toHaveLength(2);
            // status_changed (t1 = earlier) should come first
            expect((activity[0]!.data as { event_type: string }).event_type).toBe('status_changed');
            expect((activity[1]!.data as { event_type: string }).event_type).toBe('created');
        });

        it('tie-breaks by id ascending when created_at is identical', async () => {
            const t = '2026-01-01T00:00:00Z';
            await sql`INSERT INTO issue_events (item_id, event_type, created_at) VALUES ('ATL-1', 'created', ${t})`.execute(
                testDb,
            );
            await sql`INSERT INTO issue_events (item_id, event_type, created_at) VALUES ('ATL-1', 'status_changed', ${t})`.execute(
                testDb,
            );
            const activity = await eventsLog.activity('ATL-1', 'epic');
            expect(activity).toHaveLength(2);
            expect(activity[0]!.kind).toBe('event');
            expect(activity[1]!.kind).toBe('event');
        });
    });
});
