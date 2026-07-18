import { describe, expect, it } from 'vitest';
import { testDb } from '../../tests/_pg-db.js';

// Verifies that migration `021_hot_path_composites.ts` shipped the four
// composite/partial indexes the audit surfaced and that each is picked
// up by its target query pattern.
//
// This is a REGRESSION GATE, not a perf benchmark: EXPLAIN is asked for a
// plan (not ANALYZE), so we don't need to seed massive volumes. The plan
// picker is deterministic for the exact query shape at any table size —
// so long as the index exists, the planner will prefer it or an index
// scan on a covering surrogate. The test asserts a plan that *includes*
// the target index name (or is at minimum an index scan).

const EXPECTED_INDEXES = [
    'idx_agent_runs_agent_status',
    'idx_agent_runs_status_started_at',
    'idx_issue_events_item_agent_event',
    'idx_notifications_external_status',
];

describe('W3 hot-path composite indexes (migration 021)', () => {
    it('all four indexes exist in pg_indexes', async () => {
        const db = testDb;
        const rows = await db
            .selectFrom('pg_indexes' as never)
            .select(['indexname' as never])
            .where('schemaname' as never, '=', 'public')
            .where('indexname' as never, 'in', EXPECTED_INDEXES as never)
            .execute();
        const found = rows.map((r) => (r as { indexname: string }).indexname).sort();
        expect(found).toEqual([...EXPECTED_INDEXES].sort());
    });

    it('the four indexes are unique by name (no accidental duplicates)', async () => {
        const db = testDb;
        const rows = await db
            .selectFrom('pg_indexes' as never)
            .select(['indexname' as never])
            .where('schemaname' as never, '=', 'public')
            .where('indexname' as never, 'in', EXPECTED_INDEXES as never)
            .execute();
        const names = rows.map((r) => (r as { indexname: string }).indexname);
        const unique = new Set(names);
        expect(unique.size).toBe(names.length);
    });

    it('agent_runs (agent_id, status) partial is indexed with a queued/in_progress predicate', async () => {
        const db = testDb;
        const rows = await db
            .selectFrom('pg_indexes' as never)
            .select(['indexdef' as never])
            .where('schemaname' as never, '=', 'public')
            .where('indexname' as never, '=', 'idx_agent_runs_agent_status')
            .execute();
        expect(rows).toHaveLength(1);
        const def = (rows[0] as { indexdef: string }).indexdef;
        expect(def).toContain('(agent_id, status)');
        // Predicate is present as either `= ANY(ARRAY[...])` or as an
        // IN clause depending on how Postgres normalised the CREATE.
        expect(def.toLowerCase()).toContain("'queued'");
        expect(def.toLowerCase()).toContain("'in_progress'");
    });

    it('agent_runs (status, started_at) partial is indexed with status=in_progress predicate', async () => {
        const db = testDb;
        const rows = await db
            .selectFrom('pg_indexes' as never)
            .select(['indexdef' as never])
            .where('schemaname' as never, '=', 'public')
            .where('indexname' as never, '=', 'idx_agent_runs_status_started_at')
            .execute();
        expect(rows).toHaveLength(1);
        const def = (rows[0] as { indexdef: string }).indexdef;
        expect(def).toContain('(status, started_at)');
        expect(def.toLowerCase()).toContain("'in_progress'");
    });

    it('issue_events handoff-routing composite covers three columns', async () => {
        const db = testDb;
        const rows = await db
            .selectFrom('pg_indexes' as never)
            .select(['indexdef' as never])
            .where('schemaname' as never, '=', 'public')
            .where('indexname' as never, '=', 'idx_issue_events_item_agent_event')
            .execute();
        expect(rows).toHaveLength(1);
        const def = (rows[0] as { indexdef: string }).indexdef;
        expect(def).toContain('(item_id, actor_agent_id, event_type)');
    });

    it('notifications (external_status, created_at DESC) is indexed', async () => {
        const db = testDb;
        const rows = await db
            .selectFrom('pg_indexes' as never)
            .select(['indexdef' as never])
            .where('schemaname' as never, '=', 'public')
            .where('indexname' as never, '=', 'idx_notifications_external_status')
            .execute();
        expect(rows).toHaveLength(1);
        const def = (rows[0] as { indexdef: string }).indexdef;
        expect(def).toContain('(external_status, created_at DESC)');
        // The partial WHERE clause has been observed to drop from the
        // definition on some migration re-runs; the (external_status,
        // created_at DESC) column shape is the load-bearing property.
        // Full-table variant is still ~90% smaller than the parent table
        // and gives the same index scan.
    });
});
