import type { Knex } from 'knex';

// 2026-06-10 — Foundation for DB-backed secrets + setup runner.
//
// Three changes:
//   1. `environment_secrets` table — the global tier of the new
//      two-scope secrets model. Per-project secrets stay in
//      `project_env_vars`; this new table holds keys shared across
//      every project (org-wide registry tokens, etc.). Value is
//      encrypted with the same AES-256-GCM helper used by
//      `services/crypto.ts`.
//   2. `agent_runs.setup_output_text` column — captures stdout+stderr
//      from the user-authored setup script when it fails. NULL on
//      runs that never invoked the setup step or where it succeeded.
//   3. Widen `agent_runs_status_check` to include `'setup_failed'` —
//      the new `RunStatus` value emitted when the setup script exits
//      non-zero, times out, or references an unknown secret.
//
// The partial unique index `agent_runs_one_live_per_item` (migration
// 003) is intentionally NOT touched — its predicate is the explicit
// `status IN ('queued','in_progress')` form, so a `setup_failed` row
// sits outside the lock set and retries are not blocked.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE TABLE IF NOT EXISTS public.environment_secrets (
            id text PRIMARY KEY,
            key text NOT NULL,
            value_encrypted text NOT NULL,
            updated_at timestamp with time zone NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS environment_secrets_key_unique
            ON public.environment_secrets (key);

        ALTER TABLE public.agent_runs
            ADD COLUMN IF NOT EXISTS setup_output_text text;

        ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
        ALTER TABLE public.agent_runs
            ADD CONSTRAINT agent_runs_status_check
            CHECK (status = ANY (ARRAY[
                'queued'::text,
                'in_progress'::text,
                'completed'::text,
                'error'::text,
                'cancelled'::text,
                'setup_failed'::text
            ]));
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
        ALTER TABLE public.agent_runs
            ADD CONSTRAINT agent_runs_status_check
            CHECK (status = ANY (ARRAY[
                'queued'::text,
                'in_progress'::text,
                'completed'::text,
                'error'::text,
                'cancelled'::text
            ]));

        ALTER TABLE public.agent_runs DROP COLUMN IF EXISTS setup_output_text;

        DROP INDEX IF EXISTS public.environment_secrets_key_unique;
        DROP TABLE IF EXISTS public.environment_secrets;
    `);
}
