import type { Knex } from 'knex';

// Terminal v2 — idle-notification threshold.
//
// When a terminal session has no PTY output AND no user keystrokes for
// `terminal_idle_notify_seconds` consecutive seconds, the server fires a
// 'needs_you' notification (in-app + web push, plus Teams if the user
// opted into 'terminal.waiting_for_input'). Default 300 (5 minutes) is
// long enough that genuinely silent stretches of long-running commands
// rarely trip a false positive, but short enough to be useful for
// permission prompts and end-of-response moments. The Owner can tune in
// Settings → Notifications.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.settings
            ADD COLUMN IF NOT EXISTS terminal_idle_notify_seconds integer NOT NULL DEFAULT 300;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.settings DROP COLUMN IF EXISTS terminal_idle_notify_seconds;
    `);
}
