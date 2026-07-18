import type { Knex } from 'knex';

// Audit 2026-07-01 — hot-path composite / partial indexes.
//
// Follow-up to 002_perf_indexes.ts. That migration covered the five
// FK columns the baseline left single-column-indexed. This one adds the
// four composite/partial indexes the full-workload audit surfaced —
// each backs a query pattern that runs on every scheduler tick or every
// handoff decision.
//
// 1. `idx_agent_runs_agent_status` — composite (agent_id, status)
//    partial WHERE status IN ('queued', 'in_progress'). Backs the
//    scheduler heartbeat count of live runs per agent at
//    `agent-schedule-registry.ts:296,346`. Runs every 60s cron tick
//    across every active agent; without this it forces a status-only
//    scan of the whole `agent_runs` table.
//
// 2. `idx_agent_runs_status_started_at` — composite (status,
//    started_at) partial WHERE status='in_progress'. Backs the
//    stuck-run detector at `agent-schedule-registry.ts:502` that scans
//    every in_progress run for a time-threshold. Partial keeps the
//    index tiny (~10-100 rows in practice) while removing the
//    time-comparison scan.
//
// 3. `idx_issue_events_item_agent_event` — composite (item_id,
//    actor_agent_id, event_type). Backs the handoff self-routing check
//    at `agent-self-routing.ts:38-41` which asks "has this agent just
//    modified this item?" once per handoff decision. Existing
//    (item_id, created_at) does not cover the three-column filter.
//
// 4. `idx_notifications_external_status` — composite (external_status,
//    created_at DESC) partial WHERE external_status <> 'none'. Backs
//    the delivery-status filter at `routes/notifications.ts:86`
//    listing pending / failed notifications. Existing indexes covered
//    (project_id) and (kind, created_at) — external_status was
//    unindexed.
//
// Deliberately NOT included:
//   - `(project_id, status)` composite on items. Search already has
//     the tighter (project_id, type, status). Adding a weaker variant
//     didn't move the needle on the query profile.
//
// All B-tree. No GIN/GIST needed. No data migration.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_status
            ON public.agent_runs USING btree (agent_id, status)
            WHERE status IN ('queued', 'in_progress');

        CREATE INDEX IF NOT EXISTS idx_agent_runs_status_started_at
            ON public.agent_runs USING btree (status, started_at)
            WHERE status = 'in_progress';

        CREATE INDEX IF NOT EXISTS idx_issue_events_item_agent_event
            ON public.issue_events USING btree (item_id, actor_agent_id, event_type);

        CREATE INDEX IF NOT EXISTS idx_notifications_external_status
            ON public.notifications USING btree (external_status, created_at DESC)
            WHERE external_status != 'none';
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        DROP INDEX IF EXISTS public.idx_agent_runs_agent_status;
        DROP INDEX IF EXISTS public.idx_agent_runs_status_started_at;
        DROP INDEX IF EXISTS public.idx_issue_events_item_agent_event;
        DROP INDEX IF EXISTS public.idx_notifications_external_status;
    `);
}
