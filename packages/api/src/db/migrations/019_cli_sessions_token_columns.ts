import type { Knex } from 'knex';

// Terminal v3 — re-add token/cost columns to cli_sessions.
//
// Migration 014_cli_sessions_drop_cost_columns.ts dropped these because at
// the time atlas had no way to compute cost for PTY-mode Claude sessions
// (no `type:"result"` event in the on-disk JSONL, unlike `agent_runs`'
// stream-json output). What's changed:
//
//   1. Migration 018 (transcript_jsonl) — we now ingest the full PTY
//      JSONL into the row at session close.
//   2. Inspection of real PTY sessions shows every `type:"assistant"`
//      event carries a complete `usage` block (`input_tokens`,
//      `output_tokens`, `cache_creation_input_tokens`,
//      `cache_read_input_tokens`, plus a `cache_creation.{ephemeral_5m,
//      ephemeral_1h}_input_tokens` split for cost-tier-aware billing).
//
// Atlas can now sum these per-event usage blocks and multiply by a
// hardcoded Anthropic pricing table (see `claude-model-pricing.ts`) —
// exactly what status-line tools like `ccusage` do. Cost is captured at
// close time inside `ingestTranscript()`, same call site that already
// persists `transcript_jsonl`.
//
// All five columns are nullable. Copilot sessions leave them null (the
// copilot `events.jsonl` format does not carry equivalent per-event token
// data; cost for copilot terminals is a separate follow-up).

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.cli_sessions
            ADD COLUMN IF NOT EXISTS total_cost_usd        double precision,
            ADD COLUMN IF NOT EXISTS input_tokens          integer,
            ADD COLUMN IF NOT EXISTS output_tokens         integer,
            ADD COLUMN IF NOT EXISTS cache_creation_tokens integer,
            ADD COLUMN IF NOT EXISTS cache_read_tokens     integer;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.cli_sessions
            DROP COLUMN IF EXISTS total_cost_usd,
            DROP COLUMN IF EXISTS input_tokens,
            DROP COLUMN IF EXISTS output_tokens,
            DROP COLUMN IF EXISTS cache_creation_tokens,
            DROP COLUMN IF EXISTS cache_read_tokens;
    `);
}
