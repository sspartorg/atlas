import type { Knex } from 'knex';

// Reminder fire log + list index.
// - notifications.reminder_id: the reminder whose fire produced the row
//   (`fireOne`). ON DELETE SET NULL so a hard-deleted reminder leaves its
//   notifications in the feed/log. The partial index serves the fire log
//   (`GET /api/reminders/:id/fires`) and the list's fire_count subquery.
// - reminders (status, next_fire_at): the Reminders page lists by status
//   (active+paused, then history on demand) instead of the whole table.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE public.notifications
            ADD COLUMN IF NOT EXISTS reminder_id bigint
            REFERENCES public.reminders(id) ON DELETE SET NULL
    `);
    await knex.raw(`
        CREATE INDEX IF NOT EXISTS notifications_reminder_id_idx
            ON public.notifications (reminder_id, created_at DESC)
            WHERE reminder_id IS NOT NULL
    `);
    await knex.raw(
        'CREATE INDEX IF NOT EXISTS reminders_status_next_fire_idx ON public.reminders (status, next_fire_at)'
    );
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw('DROP INDEX IF EXISTS public.reminders_status_next_fire_idx');
    await knex.raw('DROP INDEX IF EXISTS public.notifications_reminder_id_idx');
    await knex.raw('ALTER TABLE public.notifications DROP COLUMN IF EXISTS reminder_id');
}
