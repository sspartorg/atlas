import type { Knex } from 'knex';

// 2026-06-12 — Web push notifications.
//
// Adds a `push_subscriptions` table keyed by the browser-supplied endpoint URL
// (guaranteed unique per subscription, naturally) plus two delivery-tracking
// columns on `notifications` mirroring the existing external_status pattern.
//
// `user_agent` is captured on subscribe to back a future "Registered devices"
// list in Settings; nothing reads it yet but the migration lands the column
// now so we don't need a second migration when that UI ships.
//
// `push_status='none'` is the default and the value left on rows where no
// subscriptions exist at publish time — distinct from `'failed'`, which only
// gets set when an actual delivery attempt failed.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE TABLE IF NOT EXISTS public.push_subscriptions (
            endpoint text PRIMARY KEY,
            p256dh text NOT NULL,
            auth text NOT NULL,
            user_agent text,
            created_at timestamptz NOT NULL DEFAULT now(),
            last_seen_at timestamptz NOT NULL DEFAULT now()
        );

        ALTER TABLE public.notifications
            ADD COLUMN IF NOT EXISTS push_status text NOT NULL DEFAULT 'none'
                CHECK (push_status IN ('none','pending','sent','failed'));

        ALTER TABLE public.notifications
            ADD COLUMN IF NOT EXISTS push_failure_reason text;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.notifications DROP COLUMN IF EXISTS push_failure_reason;
        ALTER TABLE public.notifications DROP COLUMN IF EXISTS push_status;
        DROP TABLE IF EXISTS public.push_subscriptions;
    `);
}
