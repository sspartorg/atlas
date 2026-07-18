import type { Knex } from 'knex';

// 2026-06-22 - Terminal v1.
//
// Web-hosted PTY-backed Claude Code sessions. A session is project-
// scoped (no item dependency), owns a per-branch worktree, and tracks
// a Claude CLI session_id assigned via `--session-id <uuid>` at spawn.
//
// Lifecycle:
//   active  - PTY is attached, browser may be connected or not (ring
//             buffer absorbs brief disconnects).
//   paused  - PTY killed, worktree + branch + claude_session_id kept on
//             disk so the user can re-attach later via `claude --resume`.
//   closed  - smart-staging finalize completed: optional commit, push,
//             worktree remove, branch -D. Terminal state.
//   errored - PTY died or spawn failed before any meaningful work.
//             Terminal state.
//
// The unique partial index `cli_sessions_one_active_per_project_branch`
// guarantees one live session per (project, branch) pair. It mirrors
// `agent_runs_one_live_per_item` (migration 003) so both worktree-
// authoring paths (agent runs and terminal sessions) compete safely on
// the same branch slot.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE TABLE IF NOT EXISTS public.cli_sessions (
            id                          text PRIMARY KEY,
            project_id                  text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
            title                       text NOT NULL,
            status                      text NOT NULL DEFAULT 'active'::text,
            worktree_path               text,
            worktree_branch             text,
            claude_session_id           text,
            model                       text NOT NULL,
            initial_prompt              text,
            total_cost_usd              double precision NOT NULL DEFAULT 0,
            total_input_tokens          integer NOT NULL DEFAULT 0,
            total_output_tokens         integer NOT NULL DEFAULT 0,
            total_cache_creation_tokens integer NOT NULL DEFAULT 0,
            total_cache_read_tokens     integer NOT NULL DEFAULT 0,
            created_at                  timestamp with time zone NOT NULL DEFAULT now(),
            updated_at                  timestamp with time zone NOT NULL DEFAULT now(),
            last_active_at              timestamp with time zone NOT NULL DEFAULT now(),
            closed_at                   timestamp with time zone,
            finalize_pr_url             text,
            CONSTRAINT cli_sessions_status_check
                CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'closed'::text, 'errored'::text]))
        );

        CREATE INDEX IF NOT EXISTS idx_cli_sessions_project_status
            ON public.cli_sessions (project_id, status);

        CREATE INDEX IF NOT EXISTS idx_cli_sessions_last_active
            ON public.cli_sessions (last_active_at DESC);

        CREATE UNIQUE INDEX IF NOT EXISTS cli_sessions_one_active_per_project_branch
            ON public.cli_sessions (project_id, worktree_branch)
            WHERE status IN ('active', 'paused') AND worktree_branch IS NOT NULL;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        DROP TABLE IF EXISTS public.cli_sessions;
    `);
}
