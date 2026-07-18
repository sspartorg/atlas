import type { Knex } from 'knex';

// Terminal v2 — multi-CLI support.
//
// `cli_sessions` previously assumed every session ran `claude` in a PTY.
// We now also support `copilot` (GitHub Copilot CLI's interactive REPL).
// The two diverge in two places that the host + routes branch on:
//   - argv shape: claude uses `--session-id`/`--resume`; copilot has no
//     resume primitive and uses `--allow-all-tools`.
//   - lifecycle on PTY exit: claude transcripts persist on disk so we
//     keep the row in `paused` and offer Resume; copilot has no transcript,
//     so its PTY exits go straight to `closed`. Pause/Resume routes 409
//     for copilot sessions.
//
// `claude_session_id` stays nullable — copilot rows simply omit it.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.cli_sessions
            ADD COLUMN IF NOT EXISTS cli text NOT NULL DEFAULT 'claude';

        ALTER TABLE public.cli_sessions
            DROP CONSTRAINT IF EXISTS cli_sessions_cli_check;

        ALTER TABLE public.cli_sessions
            ADD CONSTRAINT cli_sessions_cli_check
                CHECK (cli IN ('claude', 'copilot'));
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.cli_sessions DROP CONSTRAINT IF EXISTS cli_sessions_cli_check;
        ALTER TABLE public.cli_sessions DROP COLUMN IF EXISTS cli;
    `);
}
