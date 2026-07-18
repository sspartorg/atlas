import type { Knex } from 'knex';

// 2026-06-13 — VAPID keys move from env vars to the settings row.
//
// Web push needs a stable VAPID keypair. Asking the Owner to run a script
// and paste the output into .env was a manual step we can skip: the API
// generates a fresh keypair on first need and persists it here. Keys are
// stable across restarts (necessary — rotating them invalidates every
// browser subscription).
//
// Both columns nullable; the first subscribe / publish call generates and
// fills them. A future "Rotate keys" UI can null them out to force a fresh
// pair, accepting that every active sub is invalidated.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.settings
            ADD COLUMN IF NOT EXISTS vapid_public_key text;
        ALTER TABLE public.settings
            ADD COLUMN IF NOT EXISTS vapid_private_key text;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.settings DROP COLUMN IF EXISTS vapid_private_key;
        ALTER TABLE public.settings DROP COLUMN IF EXISTS vapid_public_key;
    `);
}
