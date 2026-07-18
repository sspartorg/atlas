import type { Knex } from 'knex';

// Terminal v2 — strip cost/token tracking.
//
// Interactive Claude doesn't expose per-session cost or per-turn usage in
// a parseable form (the transcript at `~/.claude/projects/<encoded>/<sid>.jsonl`
// has no `type:"result"` events; `total_cost_usd` is absent everywhere).
// The poller / SSE event / UI chip that read these columns have been
// removed; the columns themselves go now so the schema matches reality.
// When we add cost tracking back (likely a per-CLI adapter pattern), the
// shape will be redesigned from scratch.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.cli_sessions
            DROP COLUMN IF EXISTS total_cost_usd,
            DROP COLUMN IF EXISTS total_input_tokens,
            DROP COLUMN IF EXISTS total_output_tokens,
            DROP COLUMN IF EXISTS total_cache_creation_tokens,
            DROP COLUMN IF EXISTS total_cache_read_tokens;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.cli_sessions
            ADD COLUMN IF NOT EXISTS total_cost_usd              double precision NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS total_input_tokens          integer          NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS total_output_tokens         integer          NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS total_cache_creation_tokens integer          NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS total_cache_read_tokens     integer          NOT NULL DEFAULT 0;
    `);
}
