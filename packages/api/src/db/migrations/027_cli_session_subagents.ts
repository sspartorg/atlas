import type { Knex } from 'knex';

// 2026-07-03 — Terminal v4 subagent breakdown.
//
// A Claude Code session spawned via the web-hosted PTY can invoke the
// `Agent` tool one or more times. Each invocation gets its OWN on-disk
// JSONL transcript under:
//
//   ~/.claude/projects/<encoded-cwd>/<parentSessionId>/subagents/
//       agent-<id>.jsonl        (per-turn assistant/user/tool events,
//                                each with a `usage` block)
//       agent-<id>.meta.json    ({ agentType, description,
//                                toolUseId, spawnDepth })
//
// Migration 019 added per-session token+cost columns to `cli_sessions`
// but only the PARENT `<sid>.jsonl` was ever parsed, so every subagent's
// tokens were silently missing from the roll-up. This table records one
// row per subagent invocation so the analytics UI can (a) surface a
// drill-down breakdown and (b) show accurate parent+children totals.
//
// `source = 'claude_jsonl'` rows carry precise per-file usage sums.
// `source = 'copilot_list'` rows come from `type:"subagent.selected"`
// events in Copilot's `events.jsonl`; that event records name + tools
// but NO per-agent token/cost data (confirmed via a 33-session sample of
// `~/.copilot/session-state/`). Copilot rows leave the token/cost
// columns null and set `is_estimate = true` for clarity.
//
// FK cascade mirrors the parent table's `ON DELETE CASCADE` semantics —
// dropping the session should drop the child rows.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE TABLE IF NOT EXISTS public.cli_session_subagents (
            id                      text PRIMARY KEY,
            cli_session_id          text NOT NULL REFERENCES public.cli_sessions(id) ON DELETE CASCADE,
            source                  text NOT NULL,
            subagent_key            text NOT NULL,
            agent_type              text,
            description             text,
            spawn_depth             integer,
            input_tokens            integer,
            output_tokens           integer,
            cache_creation_tokens   integer,
            cache_read_tokens       integer,
            cost_usd                double precision,
            is_estimate             boolean NOT NULL DEFAULT false,
            started_at              timestamp with time zone,
            ended_at                timestamp with time zone,
            created_at              timestamp with time zone NOT NULL DEFAULT now(),
            CONSTRAINT cli_session_subagents_source_check
                CHECK (source = ANY (ARRAY['claude_jsonl'::text, 'copilot_list'::text])),
            CONSTRAINT cli_session_subagents_session_key_unique
                UNIQUE (cli_session_id, subagent_key)
        );

        CREATE INDEX IF NOT EXISTS idx_cli_session_subagents_session
            ON public.cli_session_subagents (cli_session_id);
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        DROP TABLE IF EXISTS public.cli_session_subagents;
    `);
}
