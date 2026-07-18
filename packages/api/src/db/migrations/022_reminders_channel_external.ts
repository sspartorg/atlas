import type { Knex } from 'knex';

// Reminder channel enum: 'telegram' → 'external'.
//
// The reminder's `channel` column was named after the (then only) external
// transport. After migrations 010/011 the transport is provider-agnostic; the
// value 'telegram' here was misleading — the reminder doesn't care which
// provider actually delivers, only that delivery goes *external* vs in-app.
// Rename the enum value to match the abstraction; the provider selector on
// `settings.external_notification_provider` still decides Telegram vs Teams.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.reminders DROP CONSTRAINT IF EXISTS reminders_channel_check;
        UPDATE public.reminders SET channel = 'external' WHERE channel = 'telegram';
        ALTER TABLE public.reminders ADD CONSTRAINT reminders_channel_check
            CHECK (channel = ANY (ARRAY['external'::text, 'notification'::text, 'both'::text]));
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.reminders DROP CONSTRAINT IF EXISTS reminders_channel_check;
        UPDATE public.reminders SET channel = 'telegram' WHERE channel = 'external';
        ALTER TABLE public.reminders ADD CONSTRAINT reminders_channel_check
            CHECK (channel = ANY (ARRAY['telegram'::text, 'notification'::text, 'both'::text]));
    `);
}
