import type { Knex } from 'knex';

// An agent test run gets a real checkout, and keeps what the agent changed.
//
// Agent-only tests used to run in an empty `mkdtemp` folder, so a Coder test
// found "not a git repository" and could only ask a question — and a test that
// asserted "does not edit CI" passed because the agent could edit nothing.
// `worktree_path` is the throwaway checkout while the run is live (cleared when
// it is collected); `evidence` is what was collected: the base commit, the
// files changed and the diff, for the checks that assert on real changes.

export async function up(knex: Knex): Promise<void> {
    await knex.raw('ALTER TABLE public.agent_test_runs ADD COLUMN worktree_path text');
    await knex.raw('ALTER TABLE public.agent_test_runs ADD COLUMN evidence jsonb');
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw('ALTER TABLE public.agent_test_runs DROP COLUMN IF EXISTS evidence');
    await knex.raw('ALTER TABLE public.agent_test_runs DROP COLUMN IF EXISTS worktree_path');
}
