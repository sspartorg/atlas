import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { itemLinks } from './item-links.js';
import { eventsLog } from './events-log.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Upstream' });
    await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Downstream' });
});

afterAll(async () => {
    await closeTestDb();
});

describe('itemLinks.openBlockers — depends_on gating', () => {
    // Contract: a depends_on upstream only stops being a blocker when it
    // reaches `done`. Every other status — including `in_review` — must
    // still block the downstream.

    it('returns the upstream when it is in_review (in_review IS a blocker)', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');
        await testDb.updateTable('items').set({ status: 'in_review' }).where('id', '=', 'ATL-1').execute();

        const blockers = await itemLinks.openBlockers('ATL-2');
        expect(blockers).toHaveLength(1);
        expect(blockers[0]?.id).toBe('ATL-1');
        expect(blockers[0]?.status).toBe('in_review');
    });

    it.each(['draft', 'ready', 'in_progress', 'in_review', 'waiting_for_info'] as const)(
        'treats upstream status %s as still blocking',
        async (status) => {
            await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');
            await testDb.updateTable('items').set({ status }).where('id', '=', 'ATL-1').execute();

            const blockers = await itemLinks.openBlockers('ATL-2');
            expect(blockers).toHaveLength(1);
        },
    );

    it('returns an empty list once upstream reaches done', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');
        await testDb.updateTable('items').set({ status: 'done' }).where('id', '=', 'ATL-1').execute();

        const blockers = await itemLinks.openBlockers('ATL-2');
        expect(blockers).toEqual([]);
    });

    it('ignores relates_to links — only depends_on blocks', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'relates_to');
        await testDb.updateTable('items').set({ status: 'in_review' }).where('id', '=', 'ATL-1').execute();

        expect(await itemLinks.openBlockers('ATL-2')).toEqual([]);
    });
});

describe('itemLinks activity logging (Theme 05)', () => {
    it('records link_created on BOTH sides when a depends_on link is created', async () => {
        const result = await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');
        expect(result.ok).toBe(true);

        const fromEvents = await eventsLog.list('ATL-2');
        const toEvents = await eventsLog.list('ATL-1');
        const fromLink = fromEvents.find((e) => e.event_type === 'link_created');
        const toLink = toEvents.find((e) => e.event_type === 'link_created');
        expect(fromLink).toBeDefined();
        expect(toLink).toBeDefined();
        expect(fromLink?.to_value).toBe('ATL-1');
        expect(toLink?.to_value).toBe('ATL-2');
        // Direction encoded in detail so the renderer can tell which side
        expect(fromLink?.detail).toBe('depends_on → ATL-1');
        expect(toLink?.detail).toBe('depends_on ← ATL-2');
    });

    it('records link_created on both sides for relates_to (canonical from/to normalized)', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'relates_to');
        const fromEvents = await eventsLog.list('ATL-1');
        const toEvents = await eventsLog.list('ATL-2');
        const fromLink = fromEvents.find((e) => e.event_type === 'link_created');
        const toLink = toEvents.find((e) => e.event_type === 'link_created');
        expect(fromLink).toBeDefined();
        expect(toLink).toBeDefined();
    });

    it('records link_deleted on both sides when a link is removed', async () => {
        const created = await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');
        if (!created.ok || !created.link) throw new Error('seed failed');
        await itemLinks.delete(created.link.id);

        const fromEvents = await eventsLog.list('ATL-2');
        const toEvents = await eventsLog.list('ATL-1');
        const fromDel = fromEvents.find((e) => e.event_type === 'link_deleted');
        const toDel = toEvents.find((e) => e.event_type === 'link_deleted');
        expect(fromDel).toBeDefined();
        expect(toDel).toBeDefined();
        expect(fromDel?.to_value).toBe('ATL-1');
        expect(toDel?.to_value).toBe('ATL-2');
    });

    it('does not double-log when an existing link is "created" again (idempotent)', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on'); // idempotent re-call

        const events = await eventsLog.list('ATL-2');
        const linkCreatedEvents = events.filter((e) => e.event_type === 'link_created');
        expect(linkCreatedEvents).toHaveLength(1);
    });
});

describe('itemLinks.create — tested_by directionality', () => {
    // Migration 049 adds `tested_by` as a third relation type. Direction
    // matters: from = QA story, to = dev story. The service must NOT
    // apply the relates_to symmetric normalization here, or PO Writer's
    // contract that the QA story is the `from` endpoint silently breaks.

    it('preserves from→to direction (no swap)', async () => {
        // Pass the lexicographically LARGER id as `from` so the
        // relates_to normalizer would swap if it ran. It must not.
        const result = await itemLinks.create('ATL-2', 'ATL-1', 'tested_by');
        expect(result.ok).toBe(true);
        expect(result.link?.from_id).toBe('ATL-2');
        expect(result.link?.to_id).toBe('ATL-1');
        expect(result.link?.relation_type).toBe('tested_by');
    });

    it('is idempotent on the same (from, to, tested_by) tuple', async () => {
        const a = await itemLinks.create('ATL-2', 'ATL-1', 'tested_by');
        const b = await itemLinks.create('ATL-2', 'ATL-1', 'tested_by');
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        expect(b.link?.id).toBe(a.link?.id);
    });

    it('coexists with a relates_to link between the same two items', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'tested_by');
        const rel = await itemLinks.create('ATL-2', 'ATL-1', 'relates_to');
        expect(rel.ok).toBe(true);
        const list = await itemLinks.list('ATL-2');
        const kinds = new Set(list.map((l) => l.relation_type));
        expect(kinds.has('tested_by')).toBe(true);
        expect(kinds.has('relates_to')).toBe(true);
    });

    it('records link_created on both sides with direction encoded', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'tested_by');
        const fromEvents = await eventsLog.list('ATL-2');
        const toEvents = await eventsLog.list('ATL-1');
        const fromLink = fromEvents.find((e) => e.event_type === 'link_created');
        const toLink = toEvents.find((e) => e.event_type === 'link_created');
        expect(fromLink?.detail).toBe('tested_by → ATL-1');
        expect(toLink?.detail).toBe('tested_by ← ATL-2');
    });

    it('does not count as a depends_on blocker', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'tested_by');
        await testDb
            .updateTable('items')
            .set({ status: 'in_progress' })
            .where('id', '=', 'ATL-1')
            .execute();
        expect(await itemLinks.openBlockers('ATL-2')).toEqual([]);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// W2 backfill — cover the branches missed in the 89.3% pass:
// list(), dependents(), create() self/missing_from/cycle guards.
// ──────────────────────────────────────────────────────────────────────────────

describe('itemLinks.list — outgoing + incoming combined view', () => {
    it('returns an empty array when no links exist', async () => {
        expect(await itemLinks.list('ATL-1')).toEqual([]);
    });

    it('returns outgoing depends_on link with direction=outgoing', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');
        const list = await itemLinks.list('ATL-2');
        expect(list).toHaveLength(1);
        expect(list[0]!.direction).toBe('outgoing');
        expect(list[0]!.item_id).toBe('ATL-1');
        expect(list[0]!.relation_type).toBe('depends_on');
    });

    it('returns incoming depends_on link with direction=incoming', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');
        // From ATL-1's perspective, ATL-2 is incoming (ATL-2 depends on ATL-1)
        const list = await itemLinks.list('ATL-1');
        expect(list).toHaveLength(1);
        expect(list[0]!.direction).toBe('incoming');
        expect(list[0]!.item_id).toBe('ATL-2');
    });

    it('returns both outgoing and incoming links when item is in the middle', async () => {
        await insertItem({ id: 'ATL-3', type: 'epic', project_id: 'p1', title: 'Third' });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on'); // ATL-2 depends on ATL-1
        await itemLinks.create('ATL-3', 'ATL-2', 'depends_on'); // ATL-3 depends on ATL-2

        // ATL-2 is both: a target for ATL-3 (incoming) and a source to ATL-1 (outgoing)
        const list = await itemLinks.list('ATL-2');
        expect(list).toHaveLength(2);
        const directions = new Set(list.map((l) => l.direction));
        expect(directions.has('outgoing')).toBe(true);
        expect(directions.has('incoming')).toBe(true);
    });

    it('includes link id, title, status and short_id on each row', async () => {
        await testDb.updateTable('items').set({ status: 'in_progress' }).where('id', '=', 'ATL-1').execute();
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');
        const list = await itemLinks.list('ATL-2');
        expect(list[0]!.title).toBe('Upstream');
        expect(list[0]!.status).toBe('in_progress');
        expect(list[0]!.short_id).toBe('ATL-1');
        // BIGINT id comes back as string from pg driver; just verify it's defined
        expect(list[0]!.id).toBeTruthy();
    });
});

describe('itemLinks.dependents', () => {
    it('returns empty array when no items depend on this item', async () => {
        expect(await itemLinks.dependents('ATL-1')).toEqual([]);
    });

    it('returns the from_id of items that depend on this item', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');
        const deps = await itemLinks.dependents('ATL-1');
        expect(deps).toContain('ATL-2');
    });

    it('does not return relates_to links as dependents', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'relates_to');
        const deps = await itemLinks.dependents('ATL-1');
        expect(deps).not.toContain('ATL-2');
    });
});

describe('itemLinks.create — error paths', () => {
    it('returns { ok: false, reason: "self" } when from === to', async () => {
        const result = await itemLinks.create('ATL-1', 'ATL-1', 'depends_on');
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('self');
    });

    it('returns { ok: false, reason: "missing_from" } when from item does not exist', async () => {
        const result = await itemLinks.create('DOES-NOT-EXIST', 'ATL-1', 'depends_on');
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('missing_from');
    });

    it('returns { ok: false, reason: "not_found" } when to item does not exist', async () => {
        const result = await itemLinks.create('ATL-1', 'DOES-NOT-EXIST', 'depends_on');
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('not_found');
    });

    it('returns { ok: false, reason: "cycle" } when adding a depends_on would create a cycle', async () => {
        // ATL-1 depends on ATL-2
        await itemLinks.create('ATL-1', 'ATL-2', 'depends_on');
        // Now adding ATL-2 depends on ATL-1 would create a cycle
        const result = await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('cycle');
    });

    it('relates_to is idempotent — re-creating returns the existing link', async () => {
        const a = await itemLinks.create('ATL-1', 'ATL-2', 'relates_to');
        const b = await itemLinks.create('ATL-1', 'ATL-2', 'relates_to');
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        // Same underlying link row
        expect(b.link?.id).toBe(a.link?.id);
    });

    it('relates_to normalizes direction — reverse creates same row', async () => {
        const forward = await itemLinks.create('ATL-1', 'ATL-2', 'relates_to');
        const reverse = await itemLinks.create('ATL-2', 'ATL-1', 'relates_to');
        expect(forward.ok).toBe(true);
        expect(reverse.ok).toBe(true);
        expect(reverse.link?.id).toBe(forward.link?.id);
    });
});

describe('itemLinks.delete — event emission', () => {
    it('does not throw when link id does not exist', async () => {
        await expect(itemLinks.delete(99999)).resolves.toBeUndefined();
    });
});
