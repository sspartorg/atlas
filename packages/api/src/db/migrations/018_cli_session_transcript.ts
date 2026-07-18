import type { Knex } from 'knex';

// Terminal v2 — persist CLI session transcripts.
//
// Once a session reaches a terminal state (`closed` or `errored`), Atlas
// slurps the CLI's own on-disk JSONL transcript so the Owner can re-open
// the session history later — same model as `agent_runs.output_text` for
// automatic runs, just sourced from the CLI's state dir instead of from
// our own --output-format=stream-json capture.
//
//   - claude  : `~/.claude/projects/<encoded-cwd>/<claude_session_id>.jsonl`
//   - copilot : `~/.copilot/session-state/<id>/events.jsonl`
//
// Single column on `cli_sessions` (not a separate table) — there's no
// other transcript metadata that would justify a 1:1 sibling table, and
// mirroring `agent_runs.output_text` keeps the read path trivial.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.cli_sessions
            ADD COLUMN IF NOT EXISTS transcript_jsonl text;

        ALTER TABLE public.cli_sessions
            ADD COLUMN IF NOT EXISTS transcript_ingested_at timestamptz;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.cli_sessions DROP COLUMN IF EXISTS transcript_ingested_at;
        ALTER TABLE public.cli_sessions DROP COLUMN IF EXISTS transcript_jsonl;
    `);
}
