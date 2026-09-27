import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';

// Migration 024 — the park / resume history `workflow_runs.park_reason` cannot
// keep (every resume nulls it).
//
// **Best-effort by design.** This is a record of what the engine did, written
// from inside the engine's park and resume paths. A failed insert must never
// turn a park into an unparked run or a resume into a stuck one, so every error
// is swallowed here, once, rather than at each call site.
//
// The row is filled from the run itself with INSERT … SELECT: callers only name
// the run, and `item_id` / `node_id` are whatever the run says at the moment of
// the event. `parked_node_id` wins over `current_node_id` because a Task run
// reopened by its sub-task has already cleared `parked_node_id` in the same
// statement, and `current_node_id` still names the Sub-tasks step it waited at.
export async function recordRunEvent(
    runId: string,
    kind: 'parked' | 'resumed',
    reason: string | null = null,
): Promise<void> {
    try {
        await sql`
            INSERT INTO workflow_run_events (id, workflow_run_id, item_id, kind, node_id, reason)
            SELECT ${randomUUID()}, id, item_id, ${kind}, COALESCE(parked_node_id, current_node_id), ${reason?.slice(0, 1000) ?? null}
            FROM workflow_runs WHERE id = ${runId}
        `.execute(db);
    } catch {
        /* the run's own status is the source of truth; this is only its history */
    }
}
