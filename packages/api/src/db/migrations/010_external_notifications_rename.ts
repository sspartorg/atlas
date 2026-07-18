import type { Knex } from 'knex';

// 2026-06-13 — Telegram → External Notification column rename.
//
// User-facing surfaces (UI labels, MCP tool, API routes, shared types) are
// switching from "Telegram" to channel-agnostic "Notifications" /
// "External Notification". The DB layer follows so a future channel swap is a
// single transport-adapter PR, not a cross-cutting rename.
//
// Telegram remains the actual transport — `services/transports/telegram.ts` still calls
// api.telegram.org and stays named that way. Only the column names above the
// transport change.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.notifications RENAME COLUMN sent_to_telegram TO sent_external;
        ALTER TABLE public.notifications RENAME COLUMN telegram_status TO external_status;
        ALTER INDEX public.idx_notifications_tg_status RENAME TO idx_notifications_external_status;
        ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_telegram_status_check;
        ALTER TABLE public.notifications ADD CONSTRAINT notifications_external_status_check
            CHECK (external_status IN ('none','pending','sent','failed'));

        ALTER TABLE public.settings RENAME COLUMN telegram_token TO external_notification_token;
        ALTER TABLE public.settings RENAME COLUMN telegram_chat_id TO external_notification_chat_id;
        ALTER TABLE public.settings RENAME COLUMN telegram_last_test_ok TO external_notification_last_test_ok;
        ALTER TABLE public.settings RENAME COLUMN telegram_bot_username TO external_notification_endpoint_label;
        ALTER TABLE public.settings RENAME COLUMN telegram_event_toggles TO external_notification_event_toggles;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.settings RENAME COLUMN external_notification_event_toggles TO telegram_event_toggles;
        ALTER TABLE public.settings RENAME COLUMN external_notification_endpoint_label TO telegram_bot_username;
        ALTER TABLE public.settings RENAME COLUMN external_notification_last_test_ok TO telegram_last_test_ok;
        ALTER TABLE public.settings RENAME COLUMN external_notification_chat_id TO telegram_chat_id;
        ALTER TABLE public.settings RENAME COLUMN external_notification_token TO telegram_token;

        ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_external_status_check;
        ALTER TABLE public.notifications ADD CONSTRAINT notifications_telegram_status_check
            CHECK (external_status IN ('none','pending','sent','failed'));
        ALTER INDEX public.idx_notifications_external_status RENAME TO idx_notifications_tg_status;
        ALTER TABLE public.notifications RENAME COLUMN external_status TO telegram_status;
        ALTER TABLE public.notifications RENAME COLUMN sent_external TO sent_to_telegram;
    `);
}
