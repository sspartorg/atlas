import type { Knex } from 'knex';

// Notification delivery hardening.
// - external_event_key: the event key a quiet-hours hold was raised under, so
//   the flush re-checks its toggle (off by then → `none`, "Skipped: …").
// - external_claimed_at / external_reclaimed: every in-flight send stamps a
//   claim. A send whose process died leaves `pending` + an old claim; the
//   minute sweep re-claims it once (`external_reclaimed`), then marks it failed.
//   The partial index keeps that sweep off the whole table.
// - in_app: false for rows that exist only to track an outward send
//   (external-only reminders, MCP send-external). They stay in the
//   Notification Log and the fire log, never in the feed or the unread count.
// - Rows already stuck in flight before this migration get a claim at their
//   created_at and count as re-claimed, so the first sweep marks them failed
//   (Retry on the log) instead of sending something hours old unasked.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE public.notifications
            ADD COLUMN IF NOT EXISTS external_event_key text,
            ADD COLUMN IF NOT EXISTS external_claimed_at timestamptz,
            ADD COLUMN IF NOT EXISTS external_reclaimed boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS in_app boolean NOT NULL DEFAULT true
    `);
    await knex.raw(`
        CREATE INDEX IF NOT EXISTS notifications_external_claimed_idx
            ON public.notifications (external_claimed_at)
            WHERE external_status = 'pending' AND external_claimed_at IS NOT NULL
    `);
    await knex.raw(`
        UPDATE public.notifications
           SET external_claimed_at = created_at, external_reclaimed = true
         WHERE external_status = 'pending' AND external_deferred_at IS NULL
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw('DROP INDEX IF EXISTS public.notifications_external_claimed_idx');
    await knex.raw(`
        ALTER TABLE public.notifications
            DROP COLUMN IF EXISTS in_app,
            DROP COLUMN IF EXISTS external_reclaimed,
            DROP COLUMN IF EXISTS external_claimed_at,
            DROP COLUMN IF EXISTS external_event_key
    `);
}
