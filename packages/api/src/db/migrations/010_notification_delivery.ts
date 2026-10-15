import type { Knex } from 'knex';

// Notification delivery.
// - notifications.external_deferred_at: set while quiet hours hold an outward
//   (Telegram/Teams) send. The row stays external_status='pending' until the
//   minute tick (`flushDeferredExternal`) claims and sends it after the window.
//   The partial index keeps that per-minute scan off the whole table.
// - Backfill link_url on rows that predate "every producer stamps link_url",
//   using the same chain as `notificationLinkUrl` in @atlas/shared. Workflow and
//   agent-run rows can't be derived (the run id was never stored) and stay null.
//   The backfill is not undone by `down` — the links are correct either way.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(
        'ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS external_deferred_at timestamptz'
    );
    await knex.raw(`
        CREATE INDEX IF NOT EXISTS notifications_external_deferred_idx
            ON public.notifications (external_deferred_at)
            WHERE external_deferred_at IS NOT NULL
    `);
    await knex.raw(`
        UPDATE public.notifications n
           SET link_url = CASE WHEN i.type = 'task' THEN '/tasks/' ELSE '/sub-tasks/' END || n.item_id
          FROM public.items i
         WHERE n.link_url IS NULL AND i.id = n.item_id
    `);
    await knex.raw(
        `UPDATE public.notifications SET link_url = '/reminders' WHERE link_url IS NULL AND event_type = 'reminder'`
    );
    await knex.raw(
        `UPDATE public.notifications SET link_url = '/settings?tab=jira' WHERE link_url IS NULL AND event_type = 'jira_sync'`
    );
    await knex.raw(`
        UPDATE public.notifications SET link_url = '/projects/' || project_id
         WHERE link_url IS NULL AND project_id IS NOT NULL
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw('DROP INDEX IF EXISTS public.notifications_external_deferred_idx');
    await knex.raw('ALTER TABLE public.notifications DROP COLUMN IF EXISTS external_deferred_at');
}
