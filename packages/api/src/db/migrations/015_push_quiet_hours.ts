import type { Knex } from 'knex';

// Web push follows the same rules as the outward channel: a push raised inside
// quiet hours is held (`push_deferred_at`) and the minute flush sends it once
// the window ends. The partial index keeps that flush off the whole table.

export async function up(knex: Knex): Promise<void> {
    await knex.raw('ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS push_deferred_at timestamptz');
    await knex.raw(`
        CREATE INDEX IF NOT EXISTS notifications_push_deferred_idx
            ON public.notifications (push_deferred_at)
            WHERE push_deferred_at IS NOT NULL
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw('DROP INDEX IF EXISTS public.notifications_push_deferred_idx');
    await knex.raw('ALTER TABLE public.notifications DROP COLUMN IF EXISTS push_deferred_at');
}
