import type { Knex } from 'knex';

// 2026-06-11 — Quiet hours opt-in toggle.
//
// Previously `quiet_hours_from` / `quiet_hours_to` were the sole signal:
// if both were non-null, the window was always honored. That collapsed
// "I'm not using quiet hours" with "I cleared the times to disable it"
// and offered no UI affordance to pause the feature without wiping the
// times. The new boolean column lets the UI render an explicit
// switch and lets the external-notification gating short-circuit cleanly.
//
// Backfill: any row that already had both times configured presumably
// wanted quiet hours active, so flip enabled=1 for those — preserves
// the Owner's existing intent through the upgrade. New installs default
// to 0 (off), letting the UI present the feature as opt-in.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.settings
            ADD COLUMN IF NOT EXISTS quiet_hours_enabled integer NOT NULL DEFAULT 0;

        UPDATE public.settings
            SET quiet_hours_enabled = 1
            WHERE quiet_hours_from IS NOT NULL AND quiet_hours_to IS NOT NULL;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.settings DROP COLUMN IF EXISTS quiet_hours_enabled;
    `);
}
