import type { Knex } from 'knex';

// Agent test items are visible, and tests run in a sandbox project.
//
// Migration 016 hid every `is_test` item behind `items_live`. The Owner reversed
// that: a test's Task is real work someone may want to open, and hiding it made
// "EXI-2 was created but I can't see it" a bug report. The view keeps its name
// so its ~40 readers do not change; it simply stops filtering. `is_test` stays
// on the row — it tags the item "Test", scopes the cleanup when a test is
// deleted, and keeps test PRs out of fleet delivery stats.
//
// `projects.is_test_sandbox` marks the one project agent tests default to
// (`test-project.ts`), so a test never spends a real project's issue key unless
// the Owner picks that project on purpose.

const ITEM_COLUMNS = `id, project_id, type, parent_id, parent_type, title, description, status,
    assignee_agent_id, reporter_agent_id, priority, spec_md, pr_url, points,
    acceptance_criteria, started_at, created_at, updated_at, search_tsv,
    worktree_branch, worktree_path, labels, workflow_id, sort_order, repo_ids, is_test`;

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`CREATE OR REPLACE VIEW public.items_live AS SELECT ${ITEM_COLUMNS} FROM public.items`);
    await knex.raw('DROP INDEX IF EXISTS public.items_not_test_idx');
    await knex.raw('ALTER TABLE public.projects ADD COLUMN is_test_sandbox boolean NOT NULL DEFAULT false');
    await knex.raw(
        'CREATE UNIQUE INDEX projects_one_test_sandbox ON public.projects (is_test_sandbox) WHERE is_test_sandbox',
    );
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw('DROP INDEX IF EXISTS public.projects_one_test_sandbox');
    await knex.raw('ALTER TABLE public.projects DROP COLUMN IF EXISTS is_test_sandbox');
    await knex.raw(
        'CREATE INDEX IF NOT EXISTS items_not_test_idx ON public.items USING btree (project_id, type) WHERE (NOT is_test)',
    );
    await knex.raw(
        `CREATE OR REPLACE VIEW public.items_live AS SELECT ${ITEM_COLUMNS} FROM public.items WHERE (NOT is_test)`,
    );
}
