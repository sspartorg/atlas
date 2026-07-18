import type { Knex } from 'knex';

// 2026-07-02 — DB audit (Batch 2) index repair.
//
// Two issues from the audit:
//
// 1. Migration 021 tried to `CREATE INDEX IF NOT EXISTS
//    idx_notifications_external_status ON notifications
//    (external_status, created_at DESC) WHERE external_status != 'none';`
//    BUT that name already existed — migration 010 had renamed the
//    baseline `idx_notifications_tg_status` (non-partial, from 001) to
//    `idx_notifications_external_status`. So 021's `IF NOT EXISTS` saw
//    the pre-existing index and silently skipped. The intended partial
//    index — which backs `routes/notifications.ts:86`'s
//    `WHERE external_status != 'none'` filter — was never created on
//    any DB migrated past 021.
//
//    Fix: create the partial index under a distinct name
//    (`idx_notifications_external_status_active`). Leaves the
//    baseline-renamed full index in place so 021's down step still
//    matches what 021's up believed it created.
//
// 2. Migration 020 added `item_external_links.created_by_run_id text
//    REFERENCES agent_runs(id) ON DELETE SET NULL` but only indexed
//    `item_id`. Every DELETE on `agent_runs` scans `item_external_links`
//    without an index — the same class of finding migration 002
//    explicitly fixed for five other FKs. Add the covering partial
//    index.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        -- Repair 021 index-name collision. This is the partial index the
        -- 021 up step intended to create.
        CREATE INDEX IF NOT EXISTS idx_notifications_external_status_active
            ON public.notifications USING btree (external_status, created_at DESC)
            WHERE external_status != 'none';

        -- Missing FK index for agent_runs -> item_external_links CASCADE.
        CREATE INDEX IF NOT EXISTS idx_item_external_links_created_by_run_id
            ON public.item_external_links (created_by_run_id)
            WHERE created_by_run_id IS NOT NULL;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        DROP INDEX IF EXISTS public.idx_item_external_links_created_by_run_id;
        DROP INDEX IF EXISTS public.idx_notifications_external_status_active;
    `);
}
