import type { Knex } from 'knex';

// 2026-06-10 — Item-level run lock (DB-backed, race-free).
//
// `agent_runs_one_live_per_item` — UNIQUE partial index on `item_id`
// WHERE the run is live (`queued` or `in_progress`) AND it's an item-
// scoped run (freedom-mode runs with `item_id IS NULL` are exempt;
// multiple concurrent freedom runs are fine).
//
// Combined with `findLiveRunOnItem` in `agent-dispatcher.ts` (called
// from both the auto-dispatcher and the manual `POST /api/run` route),
// this guarantees at most one active run per item across both trigger
// paths. The dispatcher check is the first line of defence; the DB
// index is the race-free fallback when two near-simultaneous dispatches
// both see "no live run" and both try to insert. The losing insert
// hits SQLSTATE 23505 and `spawnAgentRun` surfaces it as
// `LiveRunOnItemError` → HTTP 409.
//
// Stale-lock recovery: the existing `failOrphanedRuns` boot sweep
// (main.ts:98 + main.ts:260) handles zombie rows from a crashed
// previous orchestrator — every `in_progress` row not registered in
// the current process's `runOutputRegistry` AND older than 60s is
// marked `error`. That implicitly releases the lock for the next
// dispatch attempt. No `boot_id` column needed.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_one_live_per_item
            ON public.agent_runs (item_id)
            WHERE status IN ('queued', 'in_progress') AND item_id IS NOT NULL;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        DROP INDEX IF EXISTS public.agent_runs_one_live_per_item;
    `);
}
