import type { Knex } from 'knex';

// 2026-06-13 — Multi-provider external notifications.
//
// The previous abstraction layer (migration 010) renamed the Telegram-named
// columns to channel-agnostic names but the transport was still hardcoded
// Telegram. This migration adds the provider selector + a Teams webhook URL
// column so the Owner can switch transports from the Settings UI without a
// code change.
//
// Default `'telegram'` preserves existing-install behavior — current Owners
// keep their bot config; the new code reads the column and dispatches to
// the Telegram transport exactly as before.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.settings
            ADD COLUMN external_notification_provider text NOT NULL DEFAULT 'telegram'
                CHECK (external_notification_provider IN ('telegram','teams'));
        ALTER TABLE public.settings
            ADD COLUMN external_notification_webhook_url text;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.settings DROP COLUMN IF EXISTS external_notification_webhook_url;
        ALTER TABLE public.settings DROP COLUMN IF EXISTS external_notification_provider;
    `);
}
